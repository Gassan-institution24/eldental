import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { PerformedProcedureModel } from '@/modules/clinical/clinical.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Phase 3b slice 5: post-treatment instructions and the portal's "My documents" (07 §14–15). */
useTestDb();
let c: TestClinic;
let reception: Session;
let dentist: Session;
let patientId: string;

type Template = { id: string; systemKey?: string; name: string | null; procedureCodes: string[] };

async function patientAccount(phone: string): Promise<Session> {
  const person = { firstName: 'Hala', lastName: 'Odeh', phone, email: `p${phone.slice(-6)}@example.com` };
  const start = await api().post('/auth/patient/register/start').send(person);
  const done = await api().post('/auth/patient/register').send({ ...person, code: start.body.data.devCode, password: 'MySmile2026' });
  return { token: done.body.data.accessToken, cookie: '', userId: done.body.data.user.id };
}

beforeEach(async () => {
  resetState();
  c = await makeClinic('in');
  reception = await login(c.staff.reception!.email);
  dentist = await login(c.staff.dentist!.email);
  const p = await api(reception).post('/patients').send({ name: { first: 'Hala', family: 'Odeh' }, phone: '0791234565', preferredDentistId: c.staff.dentist!.staffId });
  patientId = p.body.data.id;
});

describe('instructions', () => {
  it('seeds the default templates and suggests the ones matching today’s procedures', async () => {
    const templates = (await api(dentist).get('/instruction-templates')).body.data as Template[];
    expect(templates.map((t) => t.systemKey).sort()).toEqual(['braces', 'dentures', 'extraction', 'filling', 'root_canal', 'scaling', 'whitening']);
    expect(templates.every((t) => t.name === null)).toBe(true);

    expect((await api(dentist).get(`/patients/${patientId}/instructions/suggestions`)).body.data).toEqual({ codes: [], templateIds: [] });
    await runInTenant(c.clinicId, () =>
      PerformedProcedureModel.create({ patientId, clinicProcedureId: new Types.ObjectId(), code: 'D7140', dentistId: c.staff.dentist!.staffId, performedAt: new Date() }),
    );
    const sug = (await api(dentist).get(`/patients/${patientId}/instructions/suggestions`)).body.data;
    expect(sug.codes).toEqual(['D7140']);
    expect(sug.templateIds).toEqual([templates.find((t) => t.systemKey === 'extraction')!.id]);
  });

  it('lets the clinic manage templates with settings permission only', async () => {
    const owner = await login(c.ownerEmail);
    const made = await api(owner).post('/instruction-templates').send({ name: 'Implant care', body: 'Avoid chewing on the implant side for a week.', procedureCodes: ['d6010'] });
    expect(made.status).toBe(201);
    expect(made.body.data.procedureCodes).toEqual(['D6010']);
    expect((await api(dentist).post('/instruction-templates').send({ name: 'X', body: 'Y' })).status).toBe(403);
    expect((await api(owner).post('/instruction-templates').send({ name: '', body: '', procedureCodes: ['bad code!'] })).status).toBe(422);
  });

  it('gives instructions as a text snapshot, scoped like the rest of the record', async () => {
    const templates = (await api(dentist).get('/instruction-templates')).body.data as Template[];
    const ext = templates.find((t) => t.systemKey === 'extraction')!;
    const given = await api(dentist).post(`/patients/${patientId}/instructions`).send({ templateId: ext.id, title: 'After your extraction', body: 'Bite on the gauze for 30 minutes.' });
    expect(given.status).toBe(201);
    expect(given.body.data).toMatchObject({ title: 'After your extraction', givenByName: 'Dentist One', templateId: ext.id });
    expect((await api(dentist).post(`/patients/${patientId}/instructions`).send({ title: 'x', body: '' })).status).toBe(422);
    expect((await api(dentist).post(`/patients/${patientId}/instructions`).send({ templateId: '64b000000000000000000001', title: 'Care', body: 'Text' })).body.error.details.fields[0]).toMatchObject({ path: 'templateId', code: 'not_found' });

    expect((await api(reception).get(`/patients/${patientId}/instructions`)).body.data).toHaveLength(1);
    expect((await api(reception).post(`/patients/${patientId}/instructions`).send({ title: 'Care', body: 'Text' })).status).toBe(403);
    const other = await login(c.staff.dentist2!.email);
    expect((await api(other).get(`/patients/${patientId}/instructions`)).status).toBe(404);
    const print = await api(reception).get(`/patient-instructions/${given.body.data.id}/print`);
    expect(print.body.data).toMatchObject({ instruction: { body: 'Bite on the gauze for 30 minutes.' }, patient: { fullName: 'Hala Odeh' } });

    const timeline = await api(reception).get(`/patients/${patientId}/timeline`);
    expect(timeline.body.data.map((e: { kind: string }) => e.kind)).toContain('instruction.given');
  });
});

describe('portal: my documents', () => {
  it('lists and prints only the account’s own certificates and instructions', async () => {
    const cert = (await api(dentist).post(`/patients/${patientId}/certificates`).send({ type: 'attendance', from: '2026-05-04', body: 'Attended today.' })).body.data;
    const ins = (await api(dentist).post(`/patients/${patientId}/instructions`).send({ title: 'After your filling', body: 'No chewing for 2 hours.' })).body.data;
    const someoneElse = (await api(reception).post('/patients').send({ name: { first: 'Sami', family: 'Nasser' }, phone: '0791234566', preferredDentistId: c.staff.dentist!.staffId })).body.data;
    const foreign = (await api(dentist).post(`/patients/${someoneElse.id}/instructions`).send({ title: 'Other', body: 'Other text' })).body.data;
    expect(foreign.id).toBeTruthy();

    const me = await patientAccount('0791119988');
    await runInTenant(c.clinicId, () => PatientModel.updateOne({ _id: patientId }, { $set: { userId: new Types.ObjectId(me.userId) } }));

    const docs = (await api(me).get('/portal/documents')).body.data;
    expect(docs.certificates).toEqual([expect.objectContaining({ id: cert.id, number: cert.number, type: 'attendance', dentistName: 'Dentist One', patient: { id: patientId, fullName: 'Hala Odeh' } })]);
    expect(docs.instructions).toEqual([expect.objectContaining({ id: ins.id, title: 'After your filling' })]);

    const print = await api(me).get(`/portal/certificates/${cert.id}/print`);
    expect(print.status).toBe(200);
    expect(print.body.data).toMatchObject({ certificate: { number: cert.number }, dentist: { name: 'Dentist One' } });
    expect((await api(me).get(`/portal/instructions/${ins.id}`)).body.data.instruction.body).toBe('No chewing for 2 hours.');
    // Another patient's documents are invisible (404), and staff tokens are refused.
    expect((await api(me).get(`/portal/instructions/${foreign.id}`)).status).toBe(404);
    expect((await api(reception).get('/portal/documents')).status).toBe(403);
  });
});
