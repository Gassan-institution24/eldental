import { beforeEach, describe, expect, it } from 'vitest';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;

beforeEach(async () => {
  resetState();
  c = await makeClinic('f');
});

describe('field-level permissions (04 §4)', () => {
  it('"Receptionist can see employees names and phones but not salaries" — API omits the salary', async () => {
    const s = await login(c.staff.reception!.email);
    const list = await api(s).get('/staff');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(3);
    for (const row of list.body.data) {
      expect(row.name).toBeTruthy();
      if (row.staffType !== 'manager') expect(row.phone).toBeTruthy();
      expect(row.compensation).toBeUndefined();
      expect(row.bank).toBeUndefined();
      expect(row.nationalId).toBeUndefined();
      expect(JSON.stringify(row)).not.toContain('1500000');
    }
    const one = await api(s).get(`/staff/${c.staff.dentist!.staffId}`);
    expect(one.body.data.compensation).toBeUndefined();
  });

  it('HR sees salaries and the raw national id', async () => {
    const s = await login(c.staff.hr!.email);
    const one = await api(s).get(`/staff/${c.staff.dentist!.staffId}`);
    expect(one.body.data.compensation.basicSalary).toBe(1_500_000);
    expect(one.body.data.nationalId).toBe('9871234567');
  });

  it('masked fields are masked by the server (dentist own profile: national id)', async () => {
    const s = await login(c.staff.dentist!.email);
    const me = await api(s).get(`/staff/${c.staff.dentist!.staffId}`);
    expect(me.body.data.nationalId).toBe('•••• 4567');
    expect(JSON.stringify(me.body)).not.toContain('9871234567');
  });

  it('own scope: a dentist cannot read another staff member (404)', async () => {
    const s = await login(c.staff.dentist!.email);
    expect((await api(s).get(`/staff/${c.staff.reception!.staffId}`)).status).toBe(404);
    const list = await api(s).get('/staff');
    expect(list.body.data).toHaveLength(1);
  });

  it('writing a non-writable field returns 403 FIELD_FORBIDDEN', async () => {
    const owner = await login(c.ownerEmail);
    const hr = await login(c.staff.hr!.email);
    const target = await api(hr).get(`/staff/${c.staff.reception!.staffId}`);
    // HR may change salary:
    const ok = await api(hr).patch(`/staff/${c.staff.reception!.staffId}`).send({ version: target.body.data.version, compensation: { basicSalary: 600_000 } });
    expect(ok.status).toBe(200);
    // A custom role that can update staff but has salary read-only:
    const role = await api(owner).post('/roles').send({
      name: 'Office manager',
      permissions: [
        { permission: 'staff.member.read', scope: 'all', fields: { name: 'read', phone: 'read', basicSalary: 'read' } },
        { permission: 'staff.member.update', scope: 'all', fields: { name: 'write', phone: 'write', basicSalary: 'read' } },
      ],
    });
    expect(role.status).toBe(201);
    await api(owner).put(`/staff/${c.staff.accountant!.staffId}/roles`).send({ roleIds: [role.body.data.id] });
    const mgr = await login(c.staff.accountant!.email);
    const fresh = await api(mgr).get(`/staff/${c.staff.reception!.staffId}`);
    const denied = await api(mgr).patch(`/staff/${c.staff.reception!.staffId}`).send({ version: fresh.body.data.version, compensation: { basicSalary: 1 } });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatchObject({ code: 'FIELD_FORBIDDEN', details: { fields: ['basicSalary'] } });
    const allowed = await api(mgr).patch(`/staff/${c.staff.reception!.staffId}`).send({ version: fresh.body.data.version, name: 'Reception Renamed' });
    expect(allowed.status).toBe(200);
  });

  it('sort or search on a hidden field returns 422 FIELD_NOT_ALLOWED', async () => {
    const s = await login(c.staff.reception!.email);
    const res = await api(s).get('/staff?sort=-licenseExpiry');
    expect(res.status).toBe(200);
    const hidden = await api(s).get('/staff?sort=-basicSalary');
    expect(hidden.status).toBe(422);
    const acc = await login(c.staff.accountant!.email);
    const hiddenForAcc = await api(acc).get('/staff?sort=licenseExpiry');
    expect(hiddenForAcc.status).toBe(422);
    expect(hiddenForAcc.body.error.code).toBe('FIELD_NOT_ALLOWED');
  });

  it('export goes through the same serializer (no salary column for receptionist-like roles)', async () => {
    const owner = await login(c.ownerEmail);
    await api(owner).put(`/staff/${c.staff.reception!.staffId}/permission-overrides`).send({
      overrides: [{ permission: 'staff.member.export', scope: 'all' }],
    });
    const s = await login(c.staff.reception!.email);
    const csv = await api(s).get('/staff/export');
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('name');
    expect(csv.text).not.toContain('basicSalary');
  });

  it('per-staff overrides grant and restrict; revoked permissions are denied', async () => {
    const owner = await login(c.ownerEmail);
    // Dentist gets the staff list, names + phones only.
    await api(owner).put(`/staff/${c.staff.dentist!.staffId}/permission-overrides`).send({
      overrides: [
        { permission: 'staff.member.read', scope: 'all', fields: { name: 'read', phone: 'read' } },
        { permission: 'reports.dashboard.read', revoked: true },
      ],
    });
    const d = await login(c.staff.dentist!.email);
    const list = await api(d).get('/staff');
    expect(list.body.data.length).toBeGreaterThan(3);
    expect(list.body.data[0].jobTitle).toBeUndefined();
    expect(list.body.data[0].compensation).toBeUndefined();
    const me = await api(d).get('/auth/me');
    expect(me.body.data.grants['reports.dashboard.read']).toBeUndefined();
    const eff = await api(owner).get(`/staff/${c.staff.dentist!.staffId}/effective-permissions`);
    expect(eff.body.data.inherited['reports.dashboard.read']).toBeTruthy();
    expect(eff.body.data.effective['reports.dashboard.read']).toBeUndefined();
  });

  it('missing permission → 403 FORBIDDEN with the permission key', async () => {
    const d = await login(c.staff.dentist!.email);
    const res = await api(d).post('/roles').send({ name: 'X', permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'FORBIDDEN', details: { permission: 'staff.role.manage' } });
  });

  it('a clinic must keep at least one owner', async () => {
    const owner = await login(c.ownerEmail);
    const res = await api(owner).post(`/staff/${c.staff.owner!.staffId}/deactivate`).send({ status: 'inactive' });
    expect(res.body.error.code).toBe('LAST_OWNER');
  });
});
