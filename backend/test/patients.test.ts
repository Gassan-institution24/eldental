import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let reception: Session;

const base = { name: { first: 'Lina', family: 'Haddad' }, phone: '0791234567', gender: 'female', dateOfBirth: '1990-04-12', nationalId: '9871234567' };

beforeEach(async () => {
  resetState();
  c = await makeClinic('pt');
  reception = await login(c.staff.reception!.email);
});

describe('patients', () => {
  it('registers with a sequential file number, normalised phone and search name', async () => {
    const res = await api(reception).post('/patients').send({ ...base, phone: '٠٧٩١٢٣٤٥٦٧' });
    expect(res.status).toBe(201);
    expect(res.body.data.fileNumber).toBe('P-000001');
    expect(res.body.data.phone).toBe('+962791234567');
    expect(res.body.data.fullName).toBe('Lina Haddad');
    const second = await api(reception).post('/patients').send({ ...base, name: { first: 'سارة', family: 'أحمد' }, phone: '0791234568' });
    expect(second.body.data.fileNumber).toBe('P-000002');
    const search = await api(reception).get('/patients/search?q=احمد');
    expect(search.body.data[0].fullName).toBe('سارة أحمد');
  });

  it('receptionist sees the national id masked and cannot search by it', async () => {
    const created = await api(reception).post('/patients').send(base);
    expect(created.body.data.nationalId).toBe('•••• 4567');
    const owner = await login(c.ownerEmail);
    const full = await api(owner).get(`/patients/${created.body.data.id}`);
    expect(full.body.data.nationalId).toBe('9871234567');
    const byId = await api(owner).get('/patients?q=9871234567');
    expect(byId.body.data).toHaveLength(1);
    const recSearch = await api(reception).get('/patients?q=9871234567');
    expect(recSearch.body.data).toHaveLength(0);
  });

  it('requires a guardian for minors', async () => {
    const res = await api(reception).post('/patients').send({ ...base, dateOfBirth: '2015-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields[0]).toMatchObject({ path: 'guardian.name', code: 'guardian_required' });
    const ok = await api(reception).post('/patients').send({ ...base, dateOfBirth: '2015-01-01', guardian: { name: 'Sami Haddad', relation: 'father', phone: '0791111111' } });
    expect(ok.status).toBe(201);
  });

  it('warns about duplicates by phone', async () => {
    await api(reception).post('/patients').send(base);
    const dup = await api(reception).get('/patients/check-duplicate?phone=0791234567');
    expect(dup.body.data).toHaveLength(1);
  });

  it('a dentist with own scope cannot see untreated patients (404)', async () => {
    const created = await api(reception).post('/patients').send(base);
    const dentist = await login(c.staff.dentist!.email);
    expect((await api(dentist).get(`/patients/${created.body.data.id}`)).status).toBe(404);
    expect((await api(dentist).get('/patients')).body.data).toHaveLength(0);
    // Preferred dentist counts as "own".
    await api(reception).patch(`/patients/${created.body.data.id}`).send({ version: created.body.data.version, preferredDentistId: c.staff.dentist!.staffId });
    expect((await api(dentist).get(`/patients/${created.body.data.id}`)).status).toBe(200);
  });

  it('medical history is versioned and raises alerts', async () => {
    const p = (await api(reception).post('/patients').send(base)).body.data;
    await api(reception).post(`/patients/${p.id}/medical-history`).send({ conditions: ['diabetes'], allergies: [] });
    const v2 = await api(reception).post(`/patients/${p.id}/medical-history`).send({ conditions: ['diabetes', 'anticoagulants'], allergies: [{ substance: 'Penicillin', severity: 'severe' }] });
    expect(v2.body.data.version).toBe(2);
    const versions = await api(reception).get(`/patients/${p.id}/medical-history/versions`);
    expect(versions.body.data).toHaveLength(2);
    const after = await api(reception).get(`/patients/${p.id}`);
    expect(after.body.data.medicalAlerts).toEqual(expect.arrayContaining(['condition:anticoagulants', 'allergy:Penicillin']));
  });

  it('uploads documents by magic bytes and serves them only through the authorised endpoint', async () => {
    const p = (await api(reception).post('/patients').send(base)).body.data;
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const up = await api(reception).post(`/patients/${p.id}/documents`).attach('file', pdf, 'id-card.pdf').field('category', 'id');
    expect(up.status).toBe(201);
    expect(up.body.data.mime).toBe('application/pdf');
    expect(up.body.data.storageKey).toBeUndefined();
    const fake = await api(reception).post(`/patients/${p.id}/documents`).attach('file', Buffer.from('MZ not a pdf'), 'evil.pdf');
    expect(fake.body.error.details.fields[0].code).toBe('file_type_not_allowed');
    const dl = await api(reception).get(`/files/${up.body.data.id}`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    const dentist = await login(c.staff.dentist!.email);
    expect((await api(dentist).get(`/files/${up.body.data.id}`)).status).toBe(404);
  });

  it('merges duplicates', async () => {
    const a = (await api(reception).post('/patients').send(base)).body.data;
    const b = (await api(reception).post('/patients').send({ ...base, phone: '0791234569', nationalId: undefined })).body.data;
    const owner = await login(c.ownerEmail);
    const merged = await api(owner).post(`/patients/${a.id}/merge`).send({ sourceId: b.id, reason: 'duplicate' });
    expect(merged.status).toBe(200);
    const src = await api(owner).get(`/patients/${b.id}`);
    expect(src.body.data.status).toBe('merged');
    expect((await api(owner).get('/patients')).body.meta.total).toBe(1);
  });

  it('soft-deletes and restores (Undo), changes status, filters by tag and dentist', async () => {
    const owner = await login(c.ownerEmail);
    const p = (await api(reception).post('/patients').send({ ...base, tags: ['VIP'], preferredDentistId: c.staff.dentist!.staffId })).body.data;
    await api(reception).post('/patients').send({ ...base, phone: '0791234580', nationalId: undefined });
    expect((await api(reception).get('/patients?tag=VIP')).body.data.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect((await api(reception).get(`/patients?dentistId=${c.staff.dentist!.staffId}`)).body.meta.total).toBe(1);

    const upd = await api(reception).patch(`/patients/${p.id}`).send({ version: p.version, status: 'deceased' });
    expect(upd.body.data.status).toBe('deceased');
    expect((await api(reception).get('/patients?status=deceased')).body.meta.total).toBe(1);

    await api(owner).delete(`/patients/${p.id}`).expect(204);
    expect((await api(owner).get(`/patients/${p.id}`)).status).toBe(404);
    await api(owner).post(`/patients/${p.id}/restore`).expect(204);
    expect((await api(owner).get(`/patients/${p.id}`)).status).toBe(200);
  });

  it('timeline only shows events the caller may open (04 §1)', async () => {
    const p = (await api(reception).post('/patients').send(base)).body.data;
    await api(reception).post(`/patients/${p.id}/medical-history`).send({ conditions: ['diabetes'], allergies: [] });
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    await api(reception).post(`/patients/${p.id}/documents`).attach('file', pdf, 'id.pdf').field('category', 'id');
    const owner = await login(c.ownerEmail);
    const all = (await api(owner).get(`/patients/${p.id}/timeline`)).body.data.map((e: { kind: string }) => e.kind);
    expect(all).toEqual(expect.arrayContaining(['patient.create', 'medicalHistory.create', 'file.create']));
    // The accountant reads patients but has no medical-history or document permission.
    const accountant = await login(c.staff.accountant!.email);
    const limited = (await api(accountant).get(`/patients/${p.id}/timeline`)).body.data.map((e: { kind: string }) => e.kind);
    expect(limited).toContain('patient.create');
    expect(limited).not.toContain('medicalHistory.create');
    expect(limited).not.toContain('file.create');
  });

  it('links family members, merges family groups and unlinks', async () => {
    const mum = (await api(reception).post('/patients').send(base)).body.data;
    const kidRes = await api(reception).post('/patients').send({ ...base, name: { first: 'Omar', family: 'Haddad' }, phone: '0791234570', dateOfBirth: '2016-05-01', nationalId: undefined, guardian: { patientId: mum.id, name: 'Lina Haddad', relation: 'mother', phone: '0791234567' } });
    // Regression: registering a minor linked to an existing guardian patient used to fail (clinicId invalid).
    expect(kidRes.status).toBe(201);
    const kid = kidRes.body.data;
    const fam = (await api(reception).get(`/patients/${mum.id}/family`)).body.data;
    expect(fam).toEqual([expect.objectContaining({ id: kid.id, relation: 'dependant' })]);
    expect((await api(reception).get(`/patients/${kid.id}/family`)).body.data[0]).toMatchObject({ id: mum.id, relation: 'guardian' });

    // Linking someone who already has a family brings the whole group along.
    const dad = (await api(reception).post('/patients').send({ ...base, name: { first: 'Sami', family: 'Haddad' }, phone: '0791234571', nationalId: undefined })).body.data;
    const aunt = (await api(reception).post('/patients').send({ ...base, name: { first: 'Rana', family: 'Haddad' }, phone: '0791234572', nationalId: undefined })).body.data;
    await api(reception).post(`/patients/${dad.id}/family`).send({ patientId: aunt.id }).expect(200);
    const linked = await api(reception).post(`/patients/${mum.id}/family`).send({ patientId: dad.id });
    expect(linked.status).toBe(200);
    expect(linked.body.data.map((m: { id: string }) => m.id).sort()).toEqual([kid.id, dad.id, aunt.id].sort());

    expect((await api(reception).post(`/patients/${mum.id}/family`).send({ patientId: mum.id })).body.error.details.fields[0].code).toBe('family_self');
    await api(reception).delete(`/patients/${aunt.id}/family`).expect(204);
    expect((await api(reception).get(`/patients/${aunt.id}/family`)).body.data).toEqual([]);
    expect((await api(reception).get(`/patients/${mum.id}/family`)).body.data).toHaveLength(2);

    // A dentist with own scope can't see or link patients they don't treat.
    const dentist = await login(c.staff.dentist!.email);
    expect((await api(dentist).get(`/patients/${mum.id}/family`)).status).toBe(404);
  });
});
