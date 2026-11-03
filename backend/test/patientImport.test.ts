import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import { PatientModel } from '@/modules/patients/patient.models';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Phase 3b slice 6: bulk patient import with dry run and duplicate checks (03 §4). */
useTestDb();
let c: TestClinic;
let reception: Session;

const row = (first: string, phone: string, extra: Record<string, unknown> = {}) => ({ name: { first, family: 'Saleh' }, phone, ...extra });

beforeEach(async () => {
  resetState();
  c = await makeClinic('im');
  reception = await login(c.staff.reception!.email);
  await api(reception).post('/patients').send({ name: { first: 'Old', family: 'Patient' }, phone: '0791234500', legacyFileNumber: 'A-1' });
});

const run = (rows: unknown[], extra: Record<string, unknown> = {}, s = reception) => api(s).post('/patients/import').send({ rows, ...extra });

describe('patient import', () => {
  const file = [
    row('Rana', '0791234501', { legacyFileNumber: 'b-7', gender: 'female' }),
    row('X', 'not a phone'),
    row('Omar', '0791234500'), // same phone as an existing patient
    row('Sami', '0791234502'),
    row('Sami', '0791234502'), // same as the row above
    row('Lina', '0791234503', { legacyFileNumber: 'A-1' }), // legacy number taken
  ];

  it('dry run reports each row without creating anything', async () => {
    const res = await run(file);
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual({ total: 6, ok: 2, duplicate: 2, error: 2 });
    const rows = res.body.data.rows;
    expect(rows[0]).toEqual({ index: 0, status: 'ok' });
    expect(rows[1].status).toBe('error');
    expect(rows[1].errors.map((e: { path: string }) => e.path)).toEqual(expect.arrayContaining(['name.first', 'phone']));
    expect(rows[2]).toMatchObject({ status: 'duplicate', fields: ['phone'], duplicateOf: { fullName: 'Old Patient' } });
    expect(rows[4]).toMatchObject({ status: 'duplicate', fields: ['phone'], duplicateOfRow: 3 });
    expect(rows[5]).toMatchObject({ status: 'error', errors: [{ path: 'legacyFileNumber', code: 'duplicate' }] });
    expect(await runInTenant(c.clinicId, () => PatientModel.countDocuments({}))).toBe(1);
  });

  it('commits the good rows, skips duplicates unless allowed, and audits once', async () => {
    const res = await run(file, { dryRun: false });
    expect(res.body.data.summary.created).toBe(2);
    expect(res.body.data.rows.filter((r: { status: string }) => r.status === 'created').map((r: { index: number }) => r.index)).toEqual([0, 3]);
    expect(res.body.data.rows[2]).toMatchObject({ status: 'skipped', reason: 'duplicate' });
    const rana = await runInTenant(c.clinicId, () => PatientModel.findOne({ 'name.first': 'Rana' }).lean());
    expect(rana).toMatchObject({ legacyFileNumber: 'B-7', gender: 'female' });
    expect(rana?.fileNumber).toMatch(/^P-\d{6}$/);
    const audits = await runInTenant(c.clinicId, () => AuditLogModel.find({ entity: { $in: ['patient', 'patientImport'] }, action: 'create' }).lean());
    // The seed patient + one summary entry for the whole import (no per-row audit).
    expect(audits.filter((a) => a.entity === 'patientImport')).toHaveLength(1);
    expect(audits.filter((a) => a.entity === 'patient')).toHaveLength(1);

    const again = await run([row('Omar', '0791234500'), row('Sami', '0791234502')], { dryRun: false, allowDuplicates: true });
    expect(again.body.data.summary.created).toBe(2);
  });

  it('is limited to owner and reception, 1–2000 rows, and the create rules', async () => {
    const dentist = await login(c.staff.dentist!.email);
    expect((await run([row('Rana', '0791234509')], {}, dentist)).status).toBe(403);
    const owner = await login(c.ownerEmail);
    expect((await run([row('Rana', '0791234509')], {}, owner)).status).toBe(200);
    expect((await run([])).status).toBe(422);
    const big = Array.from({ length: 2001 }, (_, i) => row('Rana', `07912${String(i).padStart(5, '0')}`));
    expect((await run(big)).status).toBe(422);
    // Fields outside the create rules are a row error, not a silent drop.
    const unknown = await run([row('Rana', '0791234509', { balance: 5000 })]);
    expect(unknown.body.data.rows[0]).toMatchObject({ status: 'error', errors: [expect.objectContaining({ code: 'unknown_field' })] });
  });
});
