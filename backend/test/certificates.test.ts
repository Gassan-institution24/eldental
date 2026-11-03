import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { CertificateModel } from '@/modules/clinical/certificate.model';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Phase 3b slice 4: medical certificates — immutable, void only (07 §14). */
useTestDb();
let c: TestClinic;
let reception: Session;
let dentist: Session;
let patientId: string;

const sick = { type: 'sick_leave', from: '2026-05-01', to: '2026-05-03', diagnosis: 'Acute pulpitis', body: 'The patient needs rest after the extraction.', recommendations: 'Soft food' };

beforeEach(async () => {
  resetState();
  c = await makeClinic('mc');
  reception = await login(c.staff.reception!.email);
  dentist = await login(c.staff.dentist!.email);
  const p = await api(reception).post('/patients').send({ name: { first: 'Hala', family: 'Odeh' }, phone: '0791234564', preferredDentistId: c.staff.dentist!.staffId });
  patientId = p.body.data.id;
});

const issue = (b: Record<string, unknown> = {}, s = dentist, id = patientId) => api(s).post(`/patients/${id}/certificates`).send({ ...sick, ...b });

describe('medical certificates', () => {
  it('issues numbered certificates with derived days; reception reads and prints them', async () => {
    const res = await issue();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'sick_leave', days: 3, status: 'issued', dentistName: 'Dentist One' });
    expect(res.body.data.number).toMatch(/^MC-/);
    const one = await issue({ type: 'attendance', to: undefined, from: '2026-05-04', diagnosis: undefined, recommendations: undefined });
    expect(one.body.data).toMatchObject({ to: '2026-05-04', days: 1 });
    expect(one.body.data.number).not.toBe(res.body.data.number);

    const list = await api(reception).get(`/patients/${patientId}/certificates`);
    expect(list.body.data).toHaveLength(2);
    const print = await api(reception).get(`/certificates/${res.body.data.id}/print`);
    expect(print.status).toBe(200);
    expect(print.body.data).toMatchObject({ certificate: { number: res.body.data.number }, patient: { fullName: 'Hala Odeh' }, dentist: { name: 'Dentist One' } });
    expect(print.body.data.clinic.name).toBeTruthy();

    const timeline = await api(reception).get(`/patients/${patientId}/timeline`);
    expect(timeline.body.data.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['certificate.sick_leave', 'certificate.attendance']));
  });

  it('validates like the issue drawer and only lets dentists issue', async () => {
    const bad = await issue({ from: '2026-05-10', to: '2026-05-01', body: '' });
    expect(bad.status).toBe(422);
    const codes = (bad.body.error.details.fields as { path: string; code: string }[]).map((f) => `${f.path}:${f.code}`);
    expect(codes).toEqual(expect.arrayContaining(['to:range_invalid', 'body:required']));
    expect((await issue({ to: '2026-08-01' })).body.error.details.fields[0]).toMatchObject({ path: 'to', code: 'range_too_long' });
    expect((await issue({ appointmentId: '64b000000000000000000001' })).body.error.details.fields[0]).toMatchObject({ path: 'appointmentId', code: 'not_found' });
    expect((await issue({}, reception)).status).toBe(403);
  });

  it('is immutable: no edit route, a guard on the model, and void with a reason only once', async () => {
    const cert = (await issue()).body.data;
    expect((await api(dentist).patch(`/certificates/${cert.id}`).send({ body: 'changed' })).status).toBe(404);
    await expect(
      runInTenant(c.clinicId, async () => {
        const doc = await CertificateModel.findById(cert.id);
        doc!.body = 'tampered';
        await doc!.save();
      }),
    ).rejects.toThrow(/immutable/);

    expect((await api(dentist).post(`/certificates/${cert.id}/void`).send({ reason: '' })).status).toBe(422);
    expect((await api(reception).post(`/certificates/${cert.id}/void`).send({ reason: 'Wrong dates' })).status).toBe(403);
    const voided = await api(dentist).post(`/certificates/${cert.id}/void`).send({ reason: 'Wrong dates' });
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({ status: 'void', voidReason: 'Wrong dates', body: sick.body });
    expect((await api(dentist).post(`/certificates/${cert.id}/void`).send({ reason: 'Again' })).body.error.code).toBe('CERTIFICATE_VOID');
  });

  it('own scope: a dentist sees and voids only what they issued, and only for their patients', async () => {
    const cert = (await issue()).body.data;
    const other = await login(c.staff.dentist2!.email);
    expect((await api(other).get(`/patients/${patientId}/certificates`)).status).toBe(404);
    expect((await api(other).get(`/certificates/${cert.id}/print`)).status).toBe(404);
    expect((await api(other).post(`/certificates/${cert.id}/void`).send({ reason: 'x' })).status).toBe(404);
    const accountant = await login(c.staff.accountant!.email);
    expect((await api(accountant).get(`/patients/${patientId}/certificates`)).status).toBe(403);
  });
});
