import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { StaffModel } from '@/modules/staff/staff.model';
import { RoleModel } from '@/modules/roles/role.model';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';
import { TENANT_RESOURCES } from './tenantResources';

useTestDb();
let a: TestClinic;
let b: TestClinic;
let ownerA: Session;
let ownerB: Session;

beforeEach(async () => {
  resetState();
  a = await makeClinic('ta');
  b = await makeClinic('tb');
  ownerA = await login(a.ownerEmail);
  ownerB = await login(b.ownerEmail);
});

describe('tenant isolation (11 §3)', () => {
  it('the data layer refuses queries without a tenant context', async () => {
    await expect(StaffModel.find({}).lean()).rejects.toThrow(/Tenant context missing/);
    const onlyA = await runInTenant(a.clinicId, () => StaffModel.find({}).lean());
    expect(onlyA.every((s) => String(s.clinicId) === a.clinicId)).toBe(true);
  });

  it('a query for another clinic id inside a tenant context matches nothing', async () => {
    const leaked = await runInTenant(a.clinicId, () => StaffModel.find({ clinicId: b.clinicId }).lean());
    expect(leaked).toEqual([]);
  });

  it('aggregates are scoped too', async () => {
    const rows = await runInTenant(a.clinicId, () => StaffModel.aggregate([{ $group: { _id: '$clinicId', n: { $sum: 1 } } }]));
    expect(rows).toHaveLength(1);
    expect(String(rows[0]._id)).toBe(a.clinicId);
  });

  for (const r of TENANT_RESOURCES) {
    it(`${r.name}: clinic A cannot list, read, update or delete clinic B's records`, async () => {
      const idB = await r.createIn(b.clinicId, ownerB);
      const list = await api(ownerA).get(r.listPath);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body.data)).not.toContain(idB);
      expect((await api(ownerA).get(`${r.basePath}/${idB}`)).status).toBe(404);
      if (r.update) {
        const res = await api(ownerA).patch(`${r.basePath}/${idB}`).send(r.update);
        expect([404, 422]).toContain(res.status);
        expect(res.status === 422 ? res.body.error.code : 'NOT_FOUND').not.toBe('OK');
      }
      if (r.canDelete) expect((await api(ownerA).delete(`${r.basePath}/${idB}`)).status).toBe(404);
      // B still sees its record.
      expect((await api(ownerB).get(`${r.basePath}/${idB}`)).status).toBe(200);
    });
  }

  it('roles are per clinic', async () => {
    const rolesA = await runInTenant(a.clinicId, () => RoleModel.find({}).lean());
    const rolesB = await runInTenant(b.clinicId, () => RoleModel.find({}).lean());
    expect(rolesA.map((r) => String(r._id))).not.toEqual(expect.arrayContaining(rolesB.map((r) => String(r._id))));
  });
});
