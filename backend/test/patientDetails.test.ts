import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { RoleModel } from '@/modules/roles/role.model';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Phase 3b slice 1: extra details, flags, photo, ID verification, referrals (03 §4). */
useTestDb();
let c: TestClinic;
let reception: Session;
let owner: Session;

const base = { name: { first: 'Lina', family: 'Haddad' }, phone: '0791234567', gender: 'female', dateOfBirth: '1990-04-12' };
const create = (extra: Record<string, unknown> = {}, s = reception) => api(s).post('/patients').send({ ...base, ...extra });

beforeEach(async () => {
  resetState();
  c = await makeClinic('pd');
  reception = await login(c.staff.reception!.email);
  owner = await login(c.ownerEmail);
});

describe('extra patient details', () => {
  it('stores identity, vitals with BMI, flags and referral; validates them like the form', async () => {
    const res = await create({
      nationality: 'jo',
      maritalStatus: 'married',
      occupation: 'Teacher',
      bloodType: 'O+',
      heightCm: 165,
      weightKg: 62.5,
      legacyFileNumber: ' old-123 ',
      flags: [{ code: 'anxious' }, { code: 'other', note: 'Prefers morning visits' }],
      referralSource: 'instagram',
      referredBy: { type: 'campaign', name: 'Summer 2026' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ nationality: 'JO', maritalStatus: 'married', bloodType: 'O+', heightCm: 165, weightKg: 62.5, bmi: 23, legacyFileNumber: 'OLD-123', referralSource: 'instagram', referredBy: { type: 'campaign', name: 'Summer 2026' } });
    expect(res.body.data.flags).toEqual([{ code: 'anxious' }, { code: 'other', note: 'Prefers morning visits' }]);

    const bad = await create({ phone: '0791234500', nationality: 'Jordan', heightCm: 20, weightKg: 70.25, bloodType: 'C+', flags: [{ code: 'other' }], referredBy: { type: 'patient' } });
    expect(bad.status).toBe(422);
    const fields = Object.fromEntries((bad.body.error.details.fields as { path: string; code: string }[]).map((f) => [f.path, f.code]));
    expect(fields).toMatchObject({ nationality: 'invalid_option', heightCm: 'too_small', weightKg: 'too_many_decimals', 'flags.0.note': 'required', 'referredBy.patientId': 'required' });
    expect(fields.bloodType).toBeDefined();
  });

  it('keeps legacy file numbers unique per clinic, searchable and in the duplicate check', async () => {
    await create({ legacyFileNumber: 'A-77' });
    const dup = await create({ phone: '0791234501', legacyFileNumber: 'a-77' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'DUPLICATE', details: { fields: ['legacyFileNumber'] } });
    expect((await api(reception).get('/patients/search?q=A-77')).body.data[0]).toMatchObject({ legacyFileNumber: 'A-77' });
    expect((await api(reception).get('/patients/check-duplicate?legacyFileNumber=a-77')).body.data).toHaveLength(1);
    // Another clinic can reuse the number.
    const other = await makeClinic('pd2');
    const r2 = await login(other.staff.reception!.email);
    expect((await create({ legacyFileNumber: 'A-77' }, r2)).status).toBe(201);
    // Clearing it frees it again.
    const p = (await api(reception).get('/patients?q=A-77')).body.data[0];
    expect((await api(reception).patch(`/patients/${p.id}`).send({ version: p.version, legacyFileNumber: null })).body.data.legacyFileNumber).toBeUndefined();
    expect((await create({ phone: '0791234502', legacyFileNumber: 'A-77' })).status).toBe(201);
  });

  it('hidden fields are never returned and writing them is refused (FIELD_FORBIDDEN)', async () => {
    const p = (await create({ bloodType: 'A-', heightCm: 170, weightKg: 70, flags: [{ code: 'vip' }] })).body.data;
    await runInTenant(c.clinicId, async () => {
      const role = await RoleModel.findOne({ key: 'receptionist' });
      role!.permissions = role!.permissions.map((g) => (g.permission.startsWith('patients.patient.') ? { ...g, fields: { ...(g.fields ?? {}), bloodType: 'hidden', vitals: 'hidden', flags: 'read' } } : g)) as never;
      role!.increment();
      await role!.save();
    });
    const { bumpPermVersion } = await import('@/core/rbac/permission.service');
    await bumpPermVersion(c.clinicId);
    resetState();
    const again = await login(c.staff.reception!.email);
    const got = (await api(again).get(`/patients/${p.id}`)).body.data;
    expect(got.bloodType).toBeUndefined();
    expect(got.heightCm).toBeUndefined();
    expect(got.bmi).toBeUndefined();
    expect(got.flags).toEqual([{ code: 'vip' }]);
    const w = await api(again).patch(`/patients/${p.id}`).send({ version: got.version, flags: [] });
    expect(w.status).toBe(403);
    expect(w.body.error).toMatchObject({ code: 'FIELD_FORBIDDEN' });
    expect((await api(again).patch(`/patients/${p.id}`).send({ version: got.version, weightKg: 80 })).body.error.code).toBe('FIELD_FORBIDDEN');
  });

  it('uploads and removes a re-encoded profile photo; any patient reader may view it', async () => {
    const p = (await create()).body.data;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const up = await api(reception).put(`/patients/${p.id}/photo`).attach('file', png, 'me.png');
    expect(up.status).toBe(200);
    expect(up.body.data.photoUrl).toMatch(/^\/files\//);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    expect((await api(reception).put(`/patients/${p.id}/photo`).attach('file', pdf, 'x.pdf')).body.error.details.fields[0].code).toBe('file_type_not_allowed');
    // The accountant can read patients but not documents: the photo is still viewable.
    const accountant = await login(c.staff.accountant!.email);
    expect((await api(accountant).get(up.body.data.photoUrl)).status).toBe(200);
    const removed = await api(reception).delete(`/patients/${p.id}/photo`);
    expect(removed.body.data.photoUrl).toBeUndefined();
  });

  it('verifies the ID only after an identity document exists, and records who did it', async () => {
    const p = (await create()).body.data;
    const first = await api(reception).post(`/patients/${p.id}/verify-id`);
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('ID_DOCUMENT_REQUIRED');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    await api(reception).post(`/patients/${p.id}/documents`).attach('file', pdf, 'id.pdf').field('category', 'id');
    const ok = await api(reception).post(`/patients/${p.id}/verify-id`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.idVerifiedAt).toBeTruthy();
    expect(ok.body.data.idVerifiedByName).toBe('Reception Person');
  });

  it('lists referrals and reports them, with own scope applied', async () => {
    const referrer = (await create()).body.data;
    await create({ phone: '0791234510', name: { first: 'Omar', family: 'Saleh' }, referredBy: { type: 'patient', patientId: referrer.id }, referralSource: 'friend' });
    await create({ phone: '0791234511', name: { first: 'Rami', family: 'Nasser' }, referredBy: { type: 'patient', patientId: referrer.id }, referralSource: 'friend' });
    await create({ phone: '0791234512', name: { first: 'Dana', family: 'Odeh' }, referredBy: { type: 'doctor', name: 'Dr Kareem' }, referralSource: 'google' });
    expect((await create({ phone: '0791234513', referredBy: { type: 'patient', patientId: '000000000000000000000000' } })).body.error.details.fields[0]).toMatchObject({ path: 'referredBy.patientId', code: 'not_found' });

    const list = await api(reception).get(`/patients/${referrer.id}/referrals`);
    expect(list.body.data.map((x: { fullName: string }) => x.fullName).sort()).toEqual(['Omar Saleh', 'Rami Nasser']);
    const today = new Date().toISOString().slice(0, 10);
    const rep = (await api(owner).get(`/reports/referrals?from=${today}&to=${today}`)).body.data;
    expect(rep.newPatients).toBe(4);
    expect(rep.byType.find((x: { type: string }) => x.type === 'patient').count).toBe(2);
    expect(rep.topReferrers[0]).toMatchObject({ patientId: referrer.id, count: 2 });
    expect(rep.sources.find((x: { source: string }) => x.source === 'friend').count).toBe(2);
    // A dentist with own scope sees none of these patients.
    const dentist = await login(c.staff.dentist!.email);
    expect((await api(dentist).get(`/reports/referrals?from=${today}&to=${today}`)).body.data.newPatients).toBe(0);
    expect((await api(dentist).get(`/patients/${referrer.id}/referrals`)).status).toBe(404);
  });
});
