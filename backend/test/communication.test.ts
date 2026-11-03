import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommunicationModel } from '@/modules/patients/communication.model';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Phase 3b slice 3: patient communication log with follow-ups (03 §4). */
useTestDb();
let c: TestClinic;
let reception: Session;
let patientId: string;

const entry = { channel: 'call', direction: 'out', summary: 'Reminded about the cleaning visit', outcome: 'reached' };
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString();

beforeEach(async () => {
  resetState();
  c = await makeClinic('cm');
  reception = await login(c.staff.reception!.email);
  const p = await api(reception).post('/patients').send({ name: { first: 'Omar', family: 'Khalil' }, phone: '0791234561' });
  patientId = p.body.data.id;
});

const log = (body: Record<string, unknown> = {}, s = reception, id = patientId) => api(s).post(`/patients/${id}/communications`).send({ ...entry, ...body });

describe('communication log', () => {
  it('logs entries newest first with the author, and counts due follow-ups', async () => {
    const a = await log({ at: new Date(Date.now() - 3600_000).toISOString() });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ ...entry, staffName: 'Reception Person', editable: true });
    const b = await log({ channel: 'whatsapp', outcome: 'no_answer', followUpAt: tomorrow() });
    expect(b.status).toBe(201);
    // A follow-up that is already due (moved into the past directly in the DB).
    await CommunicationModel.collection.updateOne({ _id: new Types.ObjectId(b.body.data.id) }, { $set: { followUpAt: new Date(Date.now() - 60_000) } });

    const list = await api(reception).get(`/patients/${patientId}/communications`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { channel: string }) => x.channel)).toEqual(['whatsapp', 'call']);
    expect(list.body.meta).toMatchObject({ total: 2, dueCount: 1 });
    expect((await api(reception).get(`/patients/${patientId}/communications?due=true`)).body.data).toHaveLength(1);

    const timeline = await api(reception).get(`/patients/${patientId}/timeline`);
    expect(timeline.body.data.map((e: { kind: string }) => e.kind)).toEqual(expect.arrayContaining(['communication.call', 'communication.whatsapp']));
  });

  it('validates like the quick-add drawer', async () => {
    const res = await log({ summary: '', channel: 'fax', followUpAt: '2020-01-01T09:00:00Z', at: '2999-01-01T00:00:00Z' });
    expect(res.status).toBe(422);
    const codes = (res.body.error.details.fields as { path: string; code: string }[]).map((f) => `${f.path}:${f.code}`);
    expect(codes).toEqual(expect.arrayContaining(['summary:required', 'channel:invalid_option', 'followUpAt:date_in_past', 'at:date_in_future']));
    expect((await log({ summary: 'x'.repeat(1001) })).status).toBe(422);
  });

  it('lets only the author edit within 24 h, and anyone with write close the follow-up', async () => {
    const created = (await log({ followUpAt: tomorrow() })).body.data;
    const owner = await login(c.ownerEmail);
    expect((await api(owner).patch(`/patient-communications/${created.id}`).send({ summary: 'Changed' })).body.error.code).toBe('COMMUNICATION_LOCKED');

    const edited = await api(reception).patch(`/patient-communications/${created.id}`).send({ summary: 'Reminded; will call back', outcome: 'left_message' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ summary: 'Reminded; will call back', outcome: 'left_message' });

    const done = await api(owner).patch(`/patient-communications/${created.id}`).send({ followUpDone: true });
    expect(done.status).toBe(200);
    expect(done.body.data.followUpDoneAt).toBeTruthy();
    expect(done.body.data.editable).toBe(false);

    await CommunicationModel.collection.updateOne({ _id: new Types.ObjectId(created.id) }, { $set: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const late = await api(reception).patch(`/patient-communications/${created.id}`).send({ summary: 'Too late' });
    expect(late.status).toBe(403);
    expect(late.body.error.code).toBe('COMMUNICATION_LOCKED');
  });

  it('applies own scope and permissions', async () => {
    const dentist = await login(c.staff.dentist!.email);
    const accountant = await login(c.staff.accountant!.email);
    const created = (await log()).body.data;
    // The dentist does not treat this patient → 404 everywhere.
    expect((await api(dentist).get(`/patients/${patientId}/communications`)).status).toBe(404);
    expect((await log({}, dentist)).status).toBe(404);
    expect((await api(dentist).patch(`/patient-communications/${created.id}`).send({ followUpDone: true })).status).toBe(404);
    expect((await api(accountant).get(`/patients/${patientId}/communications`)).status).toBe(403);
    const timeline = await api(accountant).get(`/patients/${patientId}/timeline`);
    expect(timeline.body.data.some((e: { kind: string }) => e.kind.startsWith('communication.'))).toBe(false);

    // Their own patient (preferred dentist) is in scope.
    const own = await api(reception).post('/patients').send({ name: { first: 'Sami', family: 'Nasser' }, phone: '0791234562', preferredDentistId: c.staff.dentist!.staffId });
    expect((await log({}, dentist, own.body.data.id)).status).toBe(201);
    expect((await api(dentist).get(`/patients/${own.body.data.id}/communications`)).body.data).toHaveLength(1);
  });

  it('moves entries on merge', async () => {
    const other = await api(reception).post('/patients').send({ name: { first: 'Omar', family: 'Khalil' }, phone: '0791234563' });
    await log({}, reception, other.body.data.id);
    const owner = await login(c.ownerEmail);
    const merged = await api(owner).post(`/patients/${patientId}/merge`).send({ sourceId: other.body.data.id, reason: 'Duplicate file' });
    expect(merged.status).toBe(200);
    expect((await api(owner).get(`/patients/${patientId}/communications`)).body.meta.total).toBe(1);
  });
});
