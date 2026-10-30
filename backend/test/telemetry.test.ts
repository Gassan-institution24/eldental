import { beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { ActivityLogModel, ClientIssueModel } from '@/core/logging/telemetry.models';
import { LOG_RETENTION } from '@/core/logging/logRetention';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;

beforeEach(async () => {
  resetState();
  c = await makeClinic('tel');
});

describe('telemetry (15 §7)', () => {
  it('records activity with session id and user, stripping unknown fields', async () => {
    const s = await login(c.ownerEmail);
    const res = await api(s)
      .post('/telemetry/activity')
      .set('X-Session-Id', 'session-abc-123')
      .send({ events: [{ type: 'page_view', route: '/clinic/patients', password: 'secret', meta: { tab: 'list' } }] });
    expect(res.status).toBe(200);
    const rows = await ActivityLogModel.find({ type: 'page_view' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sessionId).toBe('session-abc-123');
    expect(String(rows[0]?.userId)).toBe(s.userId);
    expect(JSON.stringify(rows[0])).not.toContain('secret');
  });

  it('accepts beacons (text/plain) without auth', async () => {
    const res = await api().post('/telemetry/activity').set('Content-Type', 'text/plain').send(JSON.stringify({ sessionId: 'beacon-session-1', events: [{ type: 'session_end', route: '/' }] }));
    expect(res.status).toBe(200);
  });

  it('rejects oversized payloads', async () => {
    const events = Array.from({ length: 101 }, () => ({ type: 'action', route: '/x' }));
    expect((await api().post('/telemetry/activity').send({ events })).status).toBe(422);
    const big = 'x'.repeat(3 * 1024 * 1024);
    const res = await api().post('/telemetry/issues').send({ issues: [{ kind: 'js_error', route: '/', message: big }] });
    expect([413, 422]).toContain(res.status);
  });

  it('groups repeated issues by fingerprint and keeps validation as field + rule only', async () => {
    const s = await login(c.ownerEmail);
    const issue = { kind: 'validation_error', severity: 'low', message: 'client validation', route: '/clinic/patients/new', validation: { form: 'patient.create', fields: [{ field: 'phone', rule: 'invalid_phone' }] } };
    await api(s).post('/telemetry/issues').send({ issues: [issue] });
    await api(s).post('/telemetry/issues').send({ issues: [issue] });
    const rows = await ClientIssueModel.find({ kind: 'validation_error' }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.occurrences).toBe(2);
    expect(rows[0]?.validation?.fields?.[0]).toMatchObject({ field: 'phone', rule: 'invalid_phone' });
  });

  it('retention TTL indexes exist', async () => {
    const idx = async (name: string) => (await mongoose.connection.db!.collection(name).indexes()).find((i) => i.expireAfterSeconds !== undefined);
    expect((await idx('activityLogs'))?.expireAfterSeconds).toBe(LOG_RETENTION.activityLogs);
    expect((await idx('clientIssues'))?.expireAfterSeconds).toBe(LOG_RETENTION.clientIssues);
    expect((await idx('requestLogs'))?.expireAfterSeconds).toBe(LOG_RETENTION.requestLogs);
  });

  it('mutations write an audit row and an API action summary', async () => {
    const s = await login(c.ownerEmail);
    const target = await api(s).get(`/staff/${c.staff.reception!.staffId}`);
    await api(s).patch(`/staff/${c.staff.reception!.staffId}`).send({ version: target.body.data.version, jobTitle: 'Front desk lead' });
    const { AuditLogModel } = await import('@/core/audit/auditLog.model');
    const audit = await AuditLogModel.findOne({ entity: 'staff', action: 'update' }).lean();
    expect(audit?.after).toMatchObject({ jobTitle: 'Front desk lead' });
    const { flushApiActions } = await import('@/modules/telemetry/telemetry.service');
    await flushApiActions();
    expect(await ActivityLogModel.countDocuments({ type: 'api_action' })).toBeGreaterThan(0);
  });
});
