import { generateSecret } from 'otplib';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import { SystemErrorModel } from '@/core/logging/systemError.model';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { hashPassword } from '@/modules/auth/auth.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { syncRoleTemplates } from '@/modules/roles/roles.service';
import { UserModel } from '@/modules/users/user.model';
import { encrypt } from '@/shared/crypto';
import { useTestDb } from './db';
import { api, login, loginPlatform, makeClinic, makeRootSuperadmin, PASSWORD, resetState, type Session, type TestClinic } from './helpers';

/** Superadmin panel (04 §8, 13 Phase 2): clinics, subscriptions, plans, catalogs, users, superadmins, logs. */
useTestDb();
let root: Session;
let c: TestClinic;

async function superadmin(email: string, permissions: string[]): Promise<Session> {
  await UserModel.create({ kind: 'platform', platformRole: 'superadmin', email, displayName: email, passwordHash: await hashPassword(PASSWORD), platformPermissions: permissions.map((permission) => ({ permission, scope: 'all' })), mfa: { enabled: true, secretEnc: encrypt(generateSecret()) } });
  return loginPlatform(email);
}

beforeEach(async () => {
  resetState();
  root = await makeRootSuperadmin();
  c = await makeClinic('adm');
});

describe('platform access', () => {
  it('every admin route needs a platform permission; clinic users are refused', async () => {
    const owner = await login(c.ownerEmail);
    for (const url of ['/admin/stats', '/admin/clinics', '/admin/users', '/admin/superadmins', '/admin/logs/audit', '/admin/plans', '/admin/catalog/medicines']) {
      expect((await api(owner).get(url)).status, url).toBe(403);
      expect((await api(root).get(url)).status, url).toBe(200);
    }
    const reader = await superadmin('reader@platform.test', ['platform.clinic.read']);
    expect((await api(reader).get('/admin/clinics')).status).toBe(200);
    expect((await api(reader).get('/admin/users')).status).toBe(403);
    expect((await api(reader).post(`/admin/clinics/${c.clinicId}/suspend`).send({})).status).toBe(403);
  });

  it('dashboard counts clinics, users and health', async () => {
    const s = (await api(root).get('/admin/stats')).body.data;
    expect(s.clinics.total).toBe(1);
    expect(s.clinics.bySubscription.trialing).toBe(1);
    expect(s.users.byKind.staff).toBeGreaterThanOrEqual(6);
    expect(s.health).toEqual({ openSystemErrors: 0, newClientIssues: 0 });
  });
});

describe('clinics and subscriptions', () => {
  it('creates a clinic with an invited owner, edits, suspends and reactivates it', async () => {
    const plan = await api(root).post('/admin/plans').send({ code: 'basic', name: 'Basic', currency: 'JOD', priceMonthly: 25_000, priceYearly: 250_000, trialDays: 14, limits: { chairs: 3, staff: 10, patients: 0, monthlyMessages: 500, storageGb: 5 }, features: ['online_booking'], isActive: true, sortOrder: 1 });
    expect(plan.status).toBe(201);
    const res = await api(root).post('/admin/clinics').send({ name: 'Bright Smile', slug: 'bright-smile', planId: plan.body.data.id, owner: { name: 'Hala Owner', email: 'hala@bright.test' } });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Bright Smile', status: 'active', subscription: { status: 'trialing' }, plan: { name: 'Basic' }, owner: { email: 'hala@bright.test' } });
    expect(res.body.data.devInviteUrl).toContain('/invite/');
    const trialDays = Math.round((new Date(res.body.data.subscription.trialEndsAt).getTime() - Date.now()) / 86_400_000);
    expect(trialDays).toBe(14);
    expect((await api(root).post('/admin/clinics').send({ name: 'Copy', slug: 'bright-smile', owner: { name: 'X Y', email: 'x@y.test' } })).body.error.details.fields[0].code).toBe('slug_taken');

    const list = await api(root).get('/admin/clinics?q=bright');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ planName: 'Basic', activeStaff: 1 });

    const id = res.body.data.id as string;
    const edited = await api(root).patch(`/admin/clinics/${id}`).send({ version: res.body.data.version, name: 'Bright Smile Dental', locale: 'en' });
    expect(edited.body.data).toMatchObject({ name: 'Bright Smile Dental', locale: 'en' });
    expect((await api(root).patch(`/admin/clinics/${id}`).send({ version: 0, name: 'Stale' })).body.error.code).toBe('VERSION_CONFLICT');

    expect((await api(root).post(`/admin/clinics/${c.clinicId}/suspend`).send({ reason: 'unpaid' })).body.data.status).toBe('suspended');
    const owner = await login(c.ownerEmail);
    expect((await api(owner).post('/patients').send({ name: { first: 'A', family: 'B' }, phone: '0791234599' })).status).toBe(403);
    expect((await api(root).post(`/admin/clinics/${c.clinicId}/activate`).send({})).body.data.status).toBe('active');
    const audit = await runWithoutTenant(() => AuditLogModel.find({ entity: 'clinic', entityId: c.clinicId, action: 'status_change' }).sort({ at: 1, _id: 1 }).lean());
    expect(audit.map((a) => a.after)).toEqual([{ status: 'suspended' }, { status: 'active' }]);
  });

  it('changes plan, status and dates of a subscription; a plan in use cannot be deleted', async () => {
    const plan = await api(root).post('/admin/plans').send({ code: 'pro', name: 'Pro', currency: 'JOD', priceMonthly: 50_000, priceYearly: 500_000, trialDays: 30, limits: { chairs: 0, staff: 0, patients: 0, monthlyMessages: 0, storageGb: 0 }, features: [], isActive: true, sortOrder: 2 });
    const detail = (await api(root).get(`/admin/clinics/${c.clinicId}`)).body.data;
    const res = await api(root).patch(`/admin/clinics/${c.clinicId}/subscription`).send({ version: detail.version, planId: plan.body.data.id, status: 'active', currentPeriodEnd: '2027-01-31' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ plan: { name: 'Pro' }, subscription: { status: 'active' } });
    expect(res.body.data.subscription.currentPeriodEnd).toContain('2027-01-31');
    expect((await api(root).get('/admin/stats')).body.data.mrr).toEqual({ JOD: 50_000 });
    expect((await api(root).delete(`/admin/plans/${plan.body.data.id}`)).body.error.code).toBe('PLAN_IN_USE');
    const subsOnly = await superadmin('billing@platform.test', ['platform.subscription.manage']);
    expect((await api(subsOnly).get('/admin/clinics')).status).toBe(200);
    expect((await api(subsOnly).patch(`/admin/clinics/${c.clinicId}`).send({ version: 0, name: 'x' })).status).toBe(403);
  });
});

describe('catalogs and role templates', () => {
  it('manages global catalog entries', async () => {
    const cur = await api(root).post('/admin/catalog/currencies').send({ code: 'jod', name: 'Jordanian Dinar', symbol: 'JD', decimals: 3, isActive: true });
    expect(cur.status).toBe(201);
    expect(cur.body.data.code).toBe('JOD');
    expect((await api(root).post('/admin/catalog/currencies').send({ code: 'JOD', name: 'Again', decimals: 3, isActive: true })).body.error.code).toBe('DUPLICATE');
    const country = await api(root).post('/admin/catalog/countries').send({ code: 'jo', name: 'الأردن', dialCode: '962', currency: 'JOD', isActive: true });
    expect(country.body.data.code).toBe('JO');
    await api(root).post('/admin/catalog/cities').send({ countryCode: 'JO', name: 'عمّان', isActive: true });
    await api(root).post('/admin/catalog/cities').send({ countryCode: 'SA', name: 'الرياض', isActive: true });
    expect((await api(root).get('/admin/catalog/cities?countryCode=jo')).body.data.map((x: { name: string }) => x.name)).toEqual(['عمّان']);
    const med = await api(root).post('/admin/catalog/medicines').send({ name: 'Amoxicillin 500mg', form: 'capsule', isActive: true });
    expect((await api(root).get('/admin/catalog/medicines?q=amoxi')).body.data[0].id).toBe(med.body.data.id);
    expect((await api(root).post('/admin/catalog/tooth-conditions').send({ code: 'Bad Code', color: '#000000', appliesTo: 'tooth', isActive: true })).status).toBe(422);
  });

  it('edits a role template for new clinics, keeps it on re-seed, and resets it', async () => {
    const list = (await api(root).get('/admin/role-templates')).body.data as { key: string; version: number; permissions: { permission: string }[] }[];
    const recep = list.find((t) => t.key === 'receptionist')!;
    const trimmed = recep.permissions.filter((p) => p.permission !== 'billing.invoice.create');
    const upd = await api(root).put('/admin/role-templates/receptionist').send({ version: recep.version, permissions: trimmed });
    expect(upd.status).toBe(200);
    expect(upd.body.data.customized).toBe(true);
    await syncRoleTemplates();
    const after = (await api(root).get('/admin/role-templates')).body.data.find((t: { key: string }) => t.key === 'receptionist');
    expect(after.permissions.some((p: { permission: string }) => p.permission === 'billing.invoice.create')).toBe(false);
    // A clinic created now gets the edited template; existing clinics keep theirs.
    const created = await api(root).post('/admin/clinics').send({ name: 'New One', slug: 'new-one', owner: { name: 'N O', email: 'no@new.test' } });
    const { RoleModel } = await import('@/modules/roles/role.model');
    const role = await runInTenant(created.body.data.id, () => RoleModel.findOne({ key: 'receptionist' }).lean());
    expect((role?.permissions ?? []).some((p) => p.permission === 'billing.invoice.create')).toBe(false);
    expect((await api(root).put('/admin/role-templates/owner').send({ version: 0, permissions: [] })).body.error.code).toBe('TEMPLATE_LOCKED');
    const reset = await api(root).post('/admin/role-templates/receptionist/reset');
    expect(reset.body.data.customized).toBe(false);
    expect(reset.body.data.permissions.some((p: { permission: string }) => p.permission === 'billing.invoice.create')).toBe(true);
  });
});

describe('users and superadmins', () => {
  it('disables, unlocks and re-enables clinic users; platform accounts are out of reach here', async () => {
    const users = await api(root).get('/admin/users?q=reception');
    const reception = users.body.data[0];
    expect(reception.clinics[0]).toMatchObject({ name: 'Clinic adm' });
    expect((await api(root).post(`/admin/users/${reception.id}/disable`)).body.data.status).toBe('disabled');
    const blocked = await api().post('/auth/login').send({ email: c.staff.reception!.email, password: PASSWORD });
    expect(blocked.body.error.code).toBe('ACCOUNT_DISABLED');
    await UserModel.updateOne({ _id: reception.id }, { $set: { lockedUntil: new Date(Date.now() + 3_600_000), failedLoginCount: 8 } });
    expect((await api(root).get('/admin/users?status=locked')).body.data.map((u: { id: string }) => u.id)).toEqual([reception.id]);
    expect((await api(root).post(`/admin/users/${reception.id}/unlock`)).body.data.locked).toBe(false);
    expect((await api(root).post(`/admin/users/${reception.id}/enable`)).body.data.status).toBe('active');
    expect((await login(c.staff.reception!.email)).token).toBeTruthy();
    const rootId = (await UserModel.findOne({ isRootSuperadmin: true }).lean())!._id;
    expect((await api(root).post(`/admin/users/${String(rootId)}/disable`)).body.error.code).toBe('ROOT_PROTECTED');
  });

  it('enforces the escalation rule and protects the root', async () => {
    const invited = await api(root).post('/admin/superadmins').send({ name: 'Mona Admin', email: 'mona@platform.test', permissions: ['platform.superadmin.manage', 'platform.clinic.read', 'platform.logs.audit.read'] });
    expect(invited.status).toBe(201);
    expect(invited.body.data).toMatchObject({ invitationPending: true, permissions: ['platform.clinic.read', 'platform.logs.audit.read', 'platform.superadmin.manage'] });
    expect((await api(root).post('/admin/superadmins').send({ name: 'Bad', email: 'bad@platform.test', permissions: ['platform.nope'] })).status).toBe(422);

    const mona = await superadmin('mona2@platform.test', ['platform.superadmin.manage', 'platform.clinic.read']);
    const beyond = await api(mona).post('/admin/superadmins').send({ name: 'Zed', email: 'zed@platform.test', permissions: ['platform.user.manage'] });
    expect(beyond.body.error.code).toBe('ESCALATION_FORBIDDEN');
    const within = await api(mona).post('/admin/superadmins').send({ name: 'Zed', email: 'zed@platform.test', permissions: ['platform.clinic.read'] });
    expect(within.status).toBe(201);
    // Removing a permission Mona doesn't hold is also beyond her authority.
    expect((await api(mona).put(`/admin/superadmins/${invited.body.data.id}/permissions`).send({ permissions: ['platform.clinic.read'] })).body.error.code).toBe('ESCALATION_FORBIDDEN');
    const list = (await api(mona).get('/admin/superadmins')).body.data as { id: string; isRootSuperadmin: boolean }[];
    const rootRow = list.find((u) => u.isRootSuperadmin)!;
    expect((await api(mona).put(`/admin/superadmins/${rootRow.id}/permissions`).send({ permissions: [] })).body.error.code).toBe('ROOT_PROTECTED');
    expect((await api(mona).post(`/admin/superadmins/${rootRow.id}/disable`)).body.error.code).toBe('ROOT_PROTECTED');
    const self = list.find((u) => !u.isRootSuperadmin && u.id !== within.body.data.id && u.id !== invited.body.data.id)!;
    expect((await api(mona).post(`/admin/superadmins/${self.id}/disable`)).body.error.code).toBe('SELF_PERMISSION_CHANGE');

    // The root changes anyone; a disabled superadmin's sessions stop.
    const zedPerms = await api(root).put(`/admin/superadmins/${within.body.data.id}/permissions`).send({ permissions: ['platform.clinic.read', 'platform.user.read'] });
    expect(zedPerms.body.data.permissions).toEqual(['platform.clinic.read', 'platform.user.read']);
    expect((await api(root).post(`/admin/superadmins/${self.id}/disable`)).body.data.status).toBe('disabled');
    expect((await api(mona).get('/admin/clinics')).status).toBe(401);
  });
});

describe('logs', () => {
  it('lists, filters, exports and triages logs, and builds a user timeline', async () => {
    await runWithoutTenant(() => SystemErrorModel.create({ fingerprint: 'fp1', message: 'Boom in invoices', route: '/invoices', httpStatus: 500, clinicId: c.clinicId }));
    const owner = await login(c.ownerEmail);
    await api(owner).post('/patients').send({ name: { first: 'Rana', family: 'Odeh' }, phone: '0791234598' });

    const audit = await api(root).get(`/admin/logs/audit?clinicId=${c.clinicId}&q=patient`);
    expect(audit.status).toBe(200);
    expect(audit.body.data.some((r: { entity: string; clinic: string }) => r.entity === 'patient' && r.clinic === 'Clinic adm')).toBe(true);
    const errors = await api(root).get('/admin/logs/errors?status=new');
    expect(errors.body.data).toHaveLength(1);
    const triaged = await api(root).patch(`/admin/logs/errors/${errors.body.data[0].id}`).send({ status: 'resolved', notes: 'fixed in 0.2' });
    expect(triaged.body.data).toMatchObject({ status: 'resolved', notes: 'fixed in 0.2' });
    expect((await api(root).get('/admin/logs/errors?status=new')).body.data).toHaveLength(0);

    const csv = await api(root).get(`/admin/logs/audit?clinicId=${c.clinicId}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toContain('at,clinic,actorName,action,entity');

    const ownerUser = await UserModel.findOne({ email: c.ownerEmail }).lean();
    const tl = await api(root).get(`/admin/logs/timeline?userId=${String(ownerUser!._id)}`);
    expect(tl.status).toBe(200);
    expect(tl.body.data.events.some((e: { kind: string; label: string }) => e.kind === 'audit' && e.label.startsWith('patient'))).toBe(true);

    const auditOnly = await superadmin('auditor@platform.test', ['platform.logs.audit.read']);
    expect((await api(auditOnly).get('/admin/logs/audit')).status).toBe(200);
    expect((await api(auditOnly).get('/admin/logs/errors')).status).toBe(403);
    expect((await api(auditOnly).get(`/admin/logs/timeline?userId=${String(ownerUser!._id)}`)).status).toBe(403);
    expect(await runInTenant(c.clinicId, () => ClinicModel.exists({ _id: c.clinicId }))).toBeTruthy();
  });
});
