import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { useTestDb } from './db';
import { addStaff, api, login, makeClinic, PASSWORD, resetState, type Session, type TestClinic } from './helpers';

/** The clinic owner is a protected clinic-level identity, not a role (04 §9). */
useTestDb();
let c: TestClinic;
let owner: Session;
let hr: Session;
let dentist: Session;
/** A manager with the Full access role: every permission, but not the owner identity. */
let mgr: Session;
let mgrId: string;

beforeEach(async () => {
  resetState();
  c = await makeClinic('own');
  owner = await login(c.ownerEmail);
  hr = await login(c.staff.hr!.email);
  dentist = await login(c.staff.dentist!.email);
  mgrId = (await addStaff(c.clinicId, { email: 'boss@own.test', name: 'Boss Manager', staffType: 'manager', role: 'owner' })).staffId;
  mgr = await login('boss@own.test');
});

const ownerIds = () => runInTenant(c.clinicId, async () => (await StaffModel.find({ isOwner: true }).select('_id').lean()).map((s) => String(s._id)));
const version = async (s: Session, id: string) => (await api(s).get(`/staff/${id}`)).body.data.version as number;

describe('clinic owner identity', () => {
  it('the clinic creator is the only owner, and adding staff never changes it', async () => {
    expect(await ownerIds()).toEqual([c.staff.owner!.staffId]);
    const clinic = await runWithoutTenant(() => ClinicModel.findById(c.clinicId).lean());
    expect(String(clinic?.ownerUserId)).toBe(c.staff.owner!.userId);
    const invited = await api(owner).post('/staff').send({ name: 'New Manager', email: 'mgr@own.test', staffType: 'manager', sendInvite: false });
    expect(invited.status).toBe(201);
    expect(invited.body.data.isOwner).toBe(false);
    expect(await ownerIds()).toEqual([c.staff.owner!.staffId]);
    const me = await api(owner).get('/auth/me');
    expect(me.body.data.isOwner).toBe(true);
    expect((await api(hr).get('/auth/me')).body.data.isOwner).toBe(false);
  });

  it('the owner reaches every clinic module and manages anyone', async () => {
    for (const url of ['/staff', '/invoices', '/payments', '/accounts', '/reports/trial-balance', '/patients', '/roles']) {
      expect((await api(owner).get(url)).status, url).toBe(200);
    }
    const roles = (await api(owner).get('/roles')).body.data as { id: string; key: string }[];
    const set = await api(owner).put(`/staff/${c.staff.dentist!.staffId}/roles`).send({ roleIds: [roles.find((r) => r.key === 'assistant')!.id] });
    expect(set.status).toBe(200);
    const ov = await api(owner).put(`/staff/${c.staff.hr!.staffId}/permission-overrides`).send({ overrides: [{ permission: 'billing.invoice.read', scope: 'all' }] });
    expect(ov.status).toBe(200);
    expect((await api(owner).post(`/staff/${c.staff.reception!.staffId}/deactivate`).send({ status: 'inactive' })).status).toBe(200);
  });
});

describe('owner protection', () => {
  it('nobody else can promote themselves, or change, downgrade or deactivate the owner', async () => {
    // Ownership is not a field of the roles endpoint any more: a manipulated request is rejected.
    const promote = await api(mgr).put(`/staff/${mgrId}/roles`).send({ roleIds: [], isOwner: true });
    expect(promote.status).toBe(422);
    expect(promote.body.error.details.fields[0]).toMatchObject({ code: 'unknown_field' });
    const self = await api(mgr).put(`/staff/${mgrId}/roles`).send({ roleIds: [] });
    expect(self.body.error.code).toBe('SELF_PERMISSION_CHANGE');
    expect((await api(mgr).post(`/staff/${mgrId}/deactivate`).send({ status: 'inactive' })).body.error.code).toBe('SELF_PERMISSION_CHANGE');
    const selfOv = await api(mgr).put(`/staff/${mgrId}/permission-overrides`).send({ overrides: [{ permission: 'billing.invoice.read', scope: 'all' }] });
    expect(selfOv.body.error.code).toBe('SELF_PERMISSION_CHANGE');

    const o = c.staff.owner!.staffId;
    expect((await api(mgr).put(`/staff/${o}/roles`).send({ roleIds: [] })).body.error.code).toBe('OWNER_PROTECTED');
    expect((await api(mgr).put(`/staff/${o}/permission-overrides`).send({ overrides: [] })).body.error.code).toBe('OWNER_PROTECTED');
    expect((await api(mgr).post(`/staff/${o}/deactivate`).send({ status: 'terminated' })).body.error.code).toBe('OWNER_PROTECTED');
    expect((await api(hr).post(`/staff/${o}/deactivate`).send({ status: 'terminated' })).body.error.code).toBe('OWNER_PROTECTED');
    expect((await api(mgr).patch(`/staff/${o}`).send({ version: await version(owner, o), name: 'Hacked' })).body.error.code).toBe('OWNER_PROTECTED');
    expect((await api(mgr).post(`/staff/${mgrId}/transfer-ownership`).send({ password: PASSWORD })).body.error.code).toBe('OWNER_ONLY');
    expect((await api(dentist).post(`/staff/${c.staff.dentist!.staffId}/transfer-ownership`).send({ password: PASSWORD })).status).toBe(403);
    // Even the owner can't deactivate themselves: ownership has to be transferred first.
    expect((await api(owner).post(`/staff/${o}/deactivate`).send({ status: 'inactive' })).body.error.code).toBe('OWNER_PROTECTED');
    expect(await ownerIds()).toEqual([o]);
  });

  it('ownership moves only through the transfer workflow, with the owner\'s password, and is audited', async () => {
    const to = c.staff.hr!.staffId;
    const wrong = await api(owner).post(`/staff/${to}/transfer-ownership`).send({ password: 'not-it-123' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.details.fields[0]).toMatchObject({ path: 'password', code: 'invalid' });
    expect(await ownerIds()).toEqual([c.staff.owner!.staffId]);

    const done = await api(owner).post(`/staff/${to}/transfer-ownership`).send({ password: PASSWORD });
    expect(done.status).toBe(200);
    expect(done.body.data.isOwner).toBe(true);
    expect(await ownerIds()).toEqual([to]);
    const clinic = await runWithoutTenant(() => ClinicModel.findById(c.clinicId).lean());
    expect(String(clinic?.ownerUserId)).toBe(c.staff.hr!.userId);
    const audit = await runInTenant(c.clinicId, () => AuditLogModel.findOne({ action: 'ownership_transfer' }).lean());
    expect(audit).toMatchObject({ entity: 'clinic', before: { ownerStaffId: c.staff.owner!.staffId }, after: { ownerStaffId: to } });

    // The new owner is protected from the previous one, who is now an ordinary (full-access) member.
    expect((await api(owner).get('/auth/me')).body.data.isOwner).toBe(false);
    expect((await api(owner).post(`/staff/${to}/deactivate`).send({ status: 'inactive' })).body.error.code).toBe('OWNER_PROTECTED');
    const newOwner = await login(c.staff.hr!.email);
    expect((await api(newOwner).post(`/staff/${c.staff.owner!.staffId}/deactivate`).send({ status: 'inactive' })).status).toBe(200);
  });

  it('owner rights stop at the clinic boundary', async () => {
    const other = await makeClinic('own2');
    expect((await api(owner).get(`/staff/${other.staff.dentist!.staffId}`)).status).toBe(404);
    expect((await api(owner).post(`/staff/${other.staff.hr!.staffId}/transfer-ownership`).send({ password: PASSWORD })).status).toBe(404);
    expect((await api(owner).post(`/staff/${other.staff.owner!.staffId}/deactivate`).send({ status: 'inactive' })).status).toBe(404);
    expect(await runInTenant(other.clinicId, async () => (await StaffModel.find({ isOwner: true }).lean()).map((s) => String(s._id)))).toEqual([other.staff.owner!.staffId]);
  });
});

describe('Full access is owner-controlled (04 §9.2)', () => {
  const roleId = async (key: string) => ((await api(owner).get('/roles')).body.data as { id: string; key: string }[]).find((r) => r.key === key)!.id;
  const invite = (s: Session, email: string, staffType: string, roleIds: string[]) => api(s).post('/staff').send({ name: 'New Person', email, staffType, roleIds, sendInvite: false });

  it('HR assigns normal job roles but never Full access', async () => {
    const ok = await invite(hr, 'newdoc@own.test', 'dentist', [await roleId('dentist')]);
    expect(ok.status).toBe(201);
    expect((await invite(hr, 'newrec@own.test', 'receptionist', [await roleId('receptionist')])).status).toBe(201);
    const full = await invite(hr, 'newmgr@own.test', 'manager', [await roleId('owner')]);
    expect(full.status).toBe(403);
    expect(full.body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
  });

  it('a Full access manager can neither grant nor remove Full access, nor hand out access management', async () => {
    const full = await roleId('owner');
    const dentistRole = await roleId('dentist');
    const toHr = await api(mgr).put(`/staff/${c.staff.hr!.staffId}/roles`).send({ roleIds: [full] });
    expect(toHr.body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    // A second Full access manager, made by the owner, can't be downgraded by the first.
    const other = await invite(owner, 'mgr2@own.test', 'manager', [full]);
    expect(other.status).toBe(201);
    expect((await api(mgr).put(`/staff/${other.body.data.id}/roles`).send({ roleIds: [dentistRole] })).body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    // Same power through other doors: overrides, a cloned or custom role, or editing a role.
    const ov = await api(mgr).put(`/staff/${c.staff.dentist!.staffId}/permission-overrides`).send({ overrides: [{ permission: 'staff.role.manage', scope: 'all' }] });
    expect(ov.body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    expect((await api(mgr).post(`/roles/${full}/clone`).send({ name: 'Almost owner' })).body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    const role = (await api(owner).get(`/roles/${dentistRole}`)).body.data as { version: number; permissions: unknown[] };
    const edit = await api(mgr).patch(`/roles/${dentistRole}`).send({ version: role.version, permissions: [...role.permissions, { permission: 'staff.role.manage', scope: 'all' }] });
    expect(edit.body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    const fullRole = (await api(owner).get(`/roles/${full}`)).body.data as { version: number };
    expect((await api(mgr).patch(`/roles/${full}`).send({ version: fullRole.version, name: 'Mine now' })).body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    // Normal job roles stay in the manager's hands.
    expect((await api(mgr).put(`/staff/${c.staff.hr!.staffId}/roles`).send({ roleIds: [await roleId('hr_manager'), await roleId('receptionist')] })).status).toBe(200);
  });

  it('custom roles stay within the assigner\'s own permissions', async () => {
    const custom = await api(owner).post('/roles').send({ name: 'Billing lead', permissions: [{ permission: 'billing.invoice.void', scope: 'all' }] });
    expect(custom.status).toBe(201);
    const res = await invite(hr, 'lead@own.test', 'other', [custom.body.data.id]);
    expect(res.body.error.code).toBe('ESCALATION_FORBIDDEN');
  });

  it('the owner grants and removes Full access', async () => {
    const full = await roleId('owner');
    expect((await api(owner).put(`/staff/${c.staff.hr!.staffId}/roles`).send({ roleIds: [full] })).status).toBe(200);
    expect((await api(owner).put(`/staff/${c.staff.hr!.staffId}/roles`).send({ roleIds: [await roleId('hr_manager')] })).status).toBe(200);
  });
});

describe('HR changes job roles of existing staff (04 §9.2)', () => {
  const roleId = async (key: string) => ((await api(owner).get('/roles')).body.data as { id: string; key: string }[]).find((r) => r.key === key)!.id;
  const setRoles = (s: Session, staffId: string, roleIds: string[]) => api(s).put(`/staff/${staffId}/roles`).send({ roleIds });

  it('HR may change built-in job roles, and it is audited', async () => {
    const res = await setRoles(hr, c.staff.reception!.staffId, [await roleId('receptionist'), await roleId('assistant')]);
    expect(res.status).toBe(200);
    expect(res.body.data.roleIds.sort()).toEqual([await roleId('receptionist'), await roleId('assistant')].sort());
    expect((await setRoles(hr, c.staff.dentist!.staffId, [await roleId('hygienist')])).status).toBe(200);
    expect((await setRoles(hr, c.staff.dentist!.staffId, [await roleId('dentist')])).status).toBe(200);
    const { AuditLogModel } = await import('@/core/audit/auditLog.model');
    const audits = await runInTenant(c.clinicId, () => AuditLogModel.find({ action: 'permission_change', entityId: c.staff.reception!.staffId }).lean());
    expect(audits).toHaveLength(1);
  });

  it('HR never grants or removes Full access, never exceeds its own grants, and never touches the owner or itself', async () => {
    const full = await roleId('owner');
    expect((await setRoles(hr, c.staff.dentist!.staffId, [await roleId('dentist'), full])).body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    // mgr holds Full access (given by the owner): HR can't take it away either.
    expect((await setRoles(hr, mgrId, [await roleId('receptionist')])).body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    const custom = await api(owner).post('/roles').send({ name: 'Ledger poster', permissions: [{ permission: 'accounting.journal.post', scope: 'all' }] });
    expect((await setRoles(hr, c.staff.reception!.staffId, [custom.body.data.id])).body.error.code).toBe('ESCALATION_FORBIDDEN');
    const withAccess = await api(owner).post('/roles').send({ name: 'Access admin', permissions: [{ permission: 'staff.role.manage', scope: 'all' }] });
    expect((await setRoles(hr, c.staff.reception!.staffId, [withAccess.body.data.id])).body.error.code).toBe('FULL_ACCESS_OWNER_ONLY');
    expect((await setRoles(hr, c.staff.owner!.staffId, [await roleId('dentist')])).body.error.code).toBe('OWNER_PROTECTED');
    expect((await setRoles(hr, c.staff.hr!.staffId, [await roleId('hr_manager'), await roleId('accountant')])).body.error.code).toBe('SELF_PERMISSION_CHANGE');
    // Overrides and role definitions stay with access managers.
    expect((await api(hr).put(`/staff/${c.staff.reception!.staffId}/permission-overrides`).send({ overrides: [] })).status).toBe(403);
    expect((await api(hr).post('/roles').send({ name: 'x', permissions: [] })).status).toBe(403);
    // Staff without staff.member.update can't change roles at all.
    expect((await setRoles(dentist, c.staff.reception!.staffId, [await roleId('receptionist')])).status).toBe(403);
    expect(await ownerIds()).toEqual([c.staff.owner!.staffId]);
  });
});
