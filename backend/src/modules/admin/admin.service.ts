import { Types } from 'mongoose';
import { env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import { invalidateUserCache } from '@/core/auth/authenticate';
import type { AuthContext } from '@/core/auth/auth.types';
import { ApiError } from '@/core/http/ApiError';
import { SystemErrorModel } from '@/core/logging/systemError.model';
import { ClientIssueModel } from '@/core/logging/telemetry.models';
import { PLATFORM_PERMISSION_KEYS } from '@/core/rbac/platformRegistry';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { RefreshTokenModel } from '@/modules/auth/auth.models';
import { sendInvitation } from '@/modules/auth/auth.service';
import { InvoiceModel } from '@/modules/billing/billing.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { createClinic } from '@/modules/platform/onboarding.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel } from '@/modules/users/user.model';
import { escapeRegex, toSearchName } from '@/shared/validation/normalize';
import { PlanModel } from './plan.model';

/* All platform data lives outside the tenant scope; clinic counts run inside each clinic (04 §8.3). */
const noTenant = <T>(fn: () => Promise<T>) => runWithoutTenant(fn);
const oid = (v: string) => new Types.ObjectId(v);
const DAY = 86_400_000;

/* ---------------- dashboard ---------------- */

export async function platformStats() {
  return noTenant(async () => {
    const now = new Date();
    const [byStatus, bySub, trialsEnding, newClinics, users, active7d, openErrors, newIssues, activePlans] = await Promise.all([
      ClinicModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      ClinicModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$subscription.status', n: { $sum: 1 } } }]),
      ClinicModel.find({ 'subscription.status': 'trialing', 'subscription.trialEndsAt': { $gte: now, $lte: new Date(now.getTime() + 14 * DAY) } })
        .select('name slug subscription.trialEndsAt')
        .sort({ 'subscription.trialEndsAt': 1 })
        .limit(10)
        .lean(),
      ClinicModel.countDocuments({ createdAt: { $gte: new Date(now.getTime() - 30 * DAY) } }),
      UserModel.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$kind', n: { $sum: 1 } } }]),
      UserModel.countDocuments({ lastActiveAt: { $gte: new Date(now.getTime() - 7 * DAY) } }),
      SystemErrorModel.countDocuments({ status: { $ne: 'resolved' } }),
      ClientIssueModel.countDocuments({ status: 'new' }),
      ClinicModel.aggregate<{ _id: unknown; n: number }>([{ $match: { 'subscription.status': 'active', planId: { $ne: null } } }, { $group: { _id: '$planId', n: { $sum: 1 } } }]),
    ]);
    const plans = new Map((await PlanModel.find({ _id: { $in: activePlans.map((p) => p._id) } }).select('priceMonthly currency').lean()).map((p) => [String(p._id), p]));
    // Monthly recurring revenue by currency (integer minor units).
    const mrr: Record<string, number> = {};
    for (const p of activePlans) {
      const plan = plans.get(String(p._id));
      if (plan) mrr[plan.currency ?? 'JOD'] = (mrr[plan.currency ?? 'JOD'] ?? 0) + (plan.priceMonthly ?? 0) * p.n;
    }
    const count = (rows: { _id: unknown; n: number }[]) => Object.fromEntries(rows.map((r) => [String(r._id ?? 'none'), r.n]));
    return {
      clinics: { total: byStatus.reduce((a, r) => a + r.n, 0), byStatus: count(byStatus), bySubscription: count(bySub), newLast30d: newClinics },
      trialsEnding: trialsEnding.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, trialEndsAt: c.subscription?.trialEndsAt })),
      users: { byKind: count(users), activeLast7d: active7d },
      health: { openSystemErrors: openErrors, newClientIssues: newIssues },
      mrr,
    };
  });
}

/* ---------------- clinics ---------------- */

export type ClinicListQuery = { page: number; limit: number; q?: string; status?: string; subscription?: string; planId?: string };

export async function listClinics(q: ClinicListQuery) {
  return noTenant(async () => {
    const filter: Record<string, unknown> = {};
    if (q.q) filter.$or = [{ searchName: { $regex: escapeRegex(toSearchName(q.q)) } }, { slug: { $regex: escapeRegex(q.q.toLowerCase()) } }];
    if (q.status) filter.status = q.status;
    if (q.subscription) filter['subscription.status'] = q.subscription;
    if (q.planId) filter.planId = oid(q.planId);
    const [rows, total] = await Promise.all([
      ClinicModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      ClinicModel.countDocuments(filter),
    ]);
    const [owners, plans, staffCounts] = await Promise.all([
      UserModel.find({ _id: { $in: rows.map((r) => r.ownerUserId).filter(Boolean) } }).select('displayName email').lean(),
      PlanModel.find({ _id: { $in: rows.map((r) => r.planId).filter(Boolean) } }).select('name').lean(),
      StaffModel.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { clinicId: { $in: rows.map((r) => r._id) }, status: 'active' } }, { $group: { _id: '$clinicId', n: { $sum: 1 } } }]),
    ]);
    const ownerOf = new Map(owners.map((u) => [String(u._id), u]));
    const planOf = new Map(plans.map((p) => [String(p._id), p.name]));
    const staffOf = new Map(staffCounts.map((s) => [String(s._id), s.n]));
    return {
      total,
      items: rows.map((c) => ({
        ...clinicSummary(c),
        owner: c.ownerUserId ? { id: String(c.ownerUserId), name: ownerOf.get(String(c.ownerUserId))?.displayName ?? '', email: ownerOf.get(String(c.ownerUserId))?.email ?? '' } : null,
        planName: c.planId ? (planOf.get(String(c.planId)) ?? '') : '',
        activeStaff: staffOf.get(String(c._id)) ?? 0,
      })),
    };
  });
}

type ClinicLean = Awaited<ReturnType<typeof loadClinic>>;
async function loadClinic(id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound();
  const c = await noTenant(() => ClinicModel.findById(id).lean());
  if (!c) throw ApiError.notFound();
  return c;
}

function clinicSummary(c: NonNullable<ClinicLean>) {
  return {
    id: String(c._id),
    version: c.__v ?? 0,
    name: c.name,
    slug: c.slug,
    email: c.email ?? '',
    phone: c.phone?.e164 ?? '',
    timezone: c.timezone,
    currency: c.currency,
    locale: c.locale,
    status: c.status,
    planId: c.planId ? String(c.planId) : null,
    subscription: { status: c.subscription?.status ?? 'trialing', trialEndsAt: c.subscription?.trialEndsAt ?? null, currentPeriodEnd: c.subscription?.currentPeriodEnd ?? null },
    onboardingCompleted: Boolean(c.onboarding?.completedAt),
    createdAt: c.createdAt,
  };
}

export async function getClinic(id: string) {
  const c = await loadClinic(id);
  const [owner, plan, counts] = await Promise.all([
    c.ownerUserId ? noTenant(() => UserModel.findById(c.ownerUserId).select('displayName email lastActiveAt status').lean()) : null,
    c.planId ? noTenant(() => PlanModel.findById(c.planId).select('name code').lean()) : null,
    runInTenant(String(c._id), async () => ({
      staff: await StaffModel.countDocuments({ status: 'active' }),
      patients: await PatientModel.countDocuments({}),
      invoices: await InvoiceModel.countDocuments({ status: { $ne: 'draft' } }),
    })),
  ]);
  return {
    ...clinicSummary(c),
    owner: owner ? { id: String(owner._id), name: owner.displayName, email: owner.email ?? '', status: owner.status, lastActiveAt: owner.lastActiveAt ?? null } : null,
    plan: plan ? { id: String(plan._id), name: plan.name, code: plan.code } : null,
    counts,
  };
}

export async function createClinicByAdmin(auth: AuthContext, b: { name: string; slug: string; timezone?: string; currency?: string; locale?: 'ar' | 'en'; planId?: string; trialDays?: number; owner: { name: string; email: string; phone?: string } }) {
  if (b.planId && !(await noTenant(() => PlanModel.exists({ _id: b.planId, isActive: true })))) throw ApiError.validation([{ path: 'planId', code: 'not_found' }]);
  const plan = b.planId ? await noTenant(() => PlanModel.findById(b.planId).select('trialDays').lean()) : null;
  const { clinic, inviteToken } = await createClinic({
    name: b.name,
    slug: b.slug,
    ...(b.timezone ? { timezone: b.timezone } : {}),
    ...(b.currency ? { currency: b.currency } : {}),
    ...(b.locale ? { locale: b.locale } : {}),
    ...(b.planId ? { planId: b.planId } : {}),
    trialDays: b.trialDays ?? plan?.trialDays ?? 30,
    owner: { name: b.owner.name, email: b.owner.email, ...(b.owner.phone ? { phone: b.owner.phone } : {}) },
    sendInvite: true,
  });
  await recordAudit({ action: 'create', entity: 'clinic', entityId: clinic._id, clinicId: clinic._id, summary: 'created by platform', after: { name: b.name, slug: b.slug, by: auth.userId } });
  return { ...(await getClinic(String(clinic._id))), ...(env.NODE_ENV !== 'production' && inviteToken ? { devInviteUrl: `${env.FRONTEND_URL}/invite/${inviteToken}` } : {}) };
}

export async function updateClinic(id: string, b: { version: number; name?: string; email?: string | null; phone?: string | null; timezone?: string; currency?: string; locale?: 'ar' | 'en' }) {
  const c = await noTenant(() => ClinicModel.findById(id));
  if (!c) throw ApiError.notFound();
  if ((c.__v ?? 0) !== b.version) throw ApiError.conflict('VERSION_CONFLICT', 'The record was changed by someone else.');
  const before = clinicSummary(c.toObject() as never);
  if (b.name !== undefined) {
    c.name = b.name;
    c.searchName = toSearchName(b.name);
  }
  if (b.email !== undefined) c.set('email', b.email ?? undefined);
  if (b.phone !== undefined) c.set('phone', b.phone ? { e164: b.phone } : undefined);
  for (const k of ['timezone', 'currency', 'locale'] as const) if (b[k] !== undefined) c.set(k, b[k]);
  c.increment();
  await noTenant(() => c.save());
  await recordAudit({ action: 'update', entity: 'clinic', entityId: id, clinicId: id, before, after: clinicSummary(c.toObject() as never) });
  return getClinic(id);
}

/** Suspend = read-only for everyone in the clinic (10 §3); sessions keep working for viewing. */
export async function setClinicStatus(id: string, status: 'active' | 'suspended', reason?: string) {
  const c = await noTenant(() => ClinicModel.findById(id));
  if (!c) throw ApiError.notFound();
  if (c.status === status) return getClinic(id);
  const before = { status: c.status };
  c.status = status;
  c.increment();
  await noTenant(() => c.save());
  await recordAudit({ action: 'status_change', entity: 'clinic', entityId: id, clinicId: id, before, after: { status }, ...(reason ? { reason } : {}) });
  return getClinic(id);
}

/* ---------------- subscriptions ---------------- */

export async function updateSubscription(id: string, b: { version: number; planId?: string | null; status?: string; trialEndsAt?: string | null; currentPeriodEnd?: string | null }) {
  const c = await noTenant(() => ClinicModel.findById(id));
  if (!c) throw ApiError.notFound();
  if ((c.__v ?? 0) !== b.version) throw ApiError.conflict('VERSION_CONFLICT', 'The record was changed by someone else.');
  if (b.planId && !(await noTenant(() => PlanModel.exists({ _id: b.planId })))) throw ApiError.validation([{ path: 'planId', code: 'not_found' }]);
  const before = { planId: c.planId ? String(c.planId) : null, subscription: { ...c.subscription } };
  if (b.planId !== undefined) c.set('planId', b.planId ? oid(b.planId) : undefined);
  if (b.status !== undefined) c.set('subscription.status', b.status);
  if (b.trialEndsAt !== undefined) c.set('subscription.trialEndsAt', b.trialEndsAt ? new Date(`${b.trialEndsAt}T23:59:59Z`) : undefined);
  if (b.currentPeriodEnd !== undefined) c.set('subscription.currentPeriodEnd', b.currentPeriodEnd ? new Date(`${b.currentPeriodEnd}T23:59:59Z`) : undefined);
  c.increment();
  await noTenant(() => c.save());
  await recordAudit({ action: 'update', entity: 'subscription', entityId: id, clinicId: id, before, after: { planId: c.planId ? String(c.planId) : null, subscription: c.subscription } });
  return getClinic(id);
}

/* ---------------- users ---------------- */

export async function listUsers(q: { page: number; limit: number; q?: string; kind?: string; status?: string }) {
  return noTenant(async () => {
    const filter: Record<string, unknown> = {};
    if (q.kind) filter.kind = q.kind;
    if (q.status === 'locked') filter.lockedUntil = { $gt: new Date() };
    else if (q.status) filter.status = q.status;
    if (q.q) {
      const rx = { $regex: escapeRegex(q.q.trim()), $options: 'i' };
      filter.$or = [{ displayName: rx }, { email: rx }, { 'phone.e164': rx }];
    }
    const [rows, total] = await Promise.all([
      UserModel.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      UserModel.countDocuments(filter),
    ]);
    const staff = await StaffModel.find({ userId: { $in: rows.map((r) => r._id) } }).setOptions({ skipTenant: true }).select('userId clinicId isOwner status').lean();
    const clinics = new Map((await ClinicModel.find({ _id: { $in: staff.map((s) => s.clinicId) } }).select('name').lean()).map((c) => [String(c._id), c.name]));
    return {
      total,
      items: rows.map((u) => ({
        ...userDto(u),
        clinics: staff.filter((s) => String(s.userId) === String(u._id)).map((s) => ({ id: String(s.clinicId), name: clinics.get(String(s.clinicId)) ?? '', isOwner: Boolean(s.isOwner), status: s.status })),
      })),
    };
  });
}

type UserLean = { _id: unknown; email?: string | null; phone?: { e164?: string | null } | null; displayName: string; kind: string; platformRole?: string | null; isRootSuperadmin?: boolean | null; status?: string | null; lockedUntil?: Date | null; lastLoginAt?: Date | null; lastActiveAt?: Date | null; mfa?: { enabled?: boolean | null } | null; createdAt?: Date; platformPermissions?: { permission: string; clinicIds?: string[] | null }[] | null; invitation?: { expiresAt?: Date | null } | null };

function userDto(u: UserLean) {
  return {
    id: String(u._id),
    displayName: u.displayName,
    email: u.email ?? '',
    phone: u.phone?.e164 ?? '',
    kind: u.kind,
    isRootSuperadmin: Boolean(u.isRootSuperadmin),
    status: u.status ?? 'active',
    locked: Boolean(u.lockedUntil && u.lockedUntil.getTime() > Date.now()),
    mfaEnabled: Boolean(u.mfa?.enabled),
    lastLoginAt: u.lastLoginAt ?? null,
    lastActiveAt: u.lastActiveAt ?? null,
    createdAt: u.createdAt,
  };
}

async function revokeSessions(userId: unknown, reason: string) {
  await RefreshTokenModel.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } }).setOptions({ skipTenant: true });
  invalidateUserCache(String(userId));
}

/** Platform accounts are managed on the superadmins page, with the escalation rule (04 §8.2). */
export async function setUserStatus(auth: AuthContext, id: string, action: 'disable' | 'enable' | 'unlock') {
  const u = await noTenant(() => UserModel.findById(id));
  if (!u) throw ApiError.notFound();
  if (u.kind === 'platform') throw ApiError.forbidden('ROOT_PROTECTED', 'Manage platform accounts on the superadmins page');
  if (String(u._id) === auth.userId) throw ApiError.forbidden('SELF_PERMISSION_CHANGE', 'You cannot change your own account here');
  const before = { status: u.status, locked: Boolean(u.lockedUntil) };
  if (action === 'disable') u.status = 'disabled';
  if (action === 'enable') u.status = 'active';
  if (action === 'unlock') {
    u.set('lockedUntil', undefined);
    u.failedLoginCount = 0;
    if (u.status === 'locked') u.status = 'active';
  }
  await noTenant(() => u.save());
  if (action === 'disable') await revokeSessions(u._id, 'disabled_by_platform');
  else invalidateUserCache(String(u._id));
  await recordAudit({ action: 'status_change', entity: 'user', entityId: id, clinicId: null, before, after: { status: u.status, locked: false }, summary: action });
  return userDto(u.toObject() as never);
}

/* ---------------- superadmins ---------------- */

/** Escalation rule (04 §8.2): non-root superadmins grant only what they hold; never the root or themselves. */
function assertCanManage(auth: AuthContext, target: { _id: unknown; isRootSuperadmin?: boolean | null } | null, permissions: string[] = []) {
  if (auth.isRoot) return;
  if (target?.isRootSuperadmin) throw ApiError.forbidden('ROOT_PROTECTED', 'The main superadmin can only be changed by itself');
  if (target && String(target._id) === auth.userId) throw ApiError.forbidden('SELF_PERMISSION_CHANGE', 'You cannot change your own access');
  const beyond = permissions.filter((p) => !auth.grants[p]);
  if (beyond.length) throw ApiError.forbidden('ESCALATION_FORBIDDEN', 'Cannot grant beyond your own permissions', { permissions: beyond });
}

function normalisePermissions(list: string[]) {
  const bad = list.filter((p) => !PLATFORM_PERMISSION_KEYS.includes(p));
  if (bad.length) throw ApiError.validation([{ path: 'permissions', code: 'invalid_option', params: { permissions: bad } }]);
  return [...new Set(list)].sort();
}

function superadminDto(u: UserLean) {
  return {
    ...userDto(u),
    permissions: u.isRootSuperadmin ? [...PLATFORM_PERMISSION_KEYS] : (u.platformPermissions ?? []).map((g) => g.permission),
    invitationPending: Boolean(u.invitation?.expiresAt),
  };
}

export async function listSuperadmins() {
  const rows = await noTenant(() => UserModel.find({ kind: 'platform' }).sort({ isRootSuperadmin: -1, createdAt: 1 }).lean());
  return rows.map((u) => superadminDto(u as never));
}

export async function inviteSuperadmin(auth: AuthContext, b: { name: string; email: string; permissions: string[] }) {
  const permissions = normalisePermissions(b.permissions);
  assertCanManage(auth, null, permissions);
  if (await noTenant(() => UserModel.exists({ email: b.email.toLowerCase() }))) throw ApiError.conflict('DUPLICATE', 'This email already has an account', { fields: ['email'] });
  const user = new UserModel({ kind: 'platform', platformRole: 'superadmin', email: b.email, displayName: b.name, platformPermissions: permissions.map((permission) => ({ permission, scope: 'all' })) });
  await noTenant(() => user.save());
  const token = await sendInvitation(user, null);
  await recordAudit({ action: 'permission_change', entity: 'superadmin', entityId: user._id, clinicId: null, after: { email: b.email, permissions }, summary: 'invited' });
  return { ...superadminDto((await noTenant(() => UserModel.findById(user._id).lean())) as never), ...(env.NODE_ENV !== 'production' ? { devInviteUrl: `${env.FRONTEND_URL}/invite/${token}` } : {}) };
}

export async function setSuperadminPermissions(auth: AuthContext, id: string, list: string[]) {
  const permissions = normalisePermissions(list);
  const u = await noTenant(() => UserModel.findOne({ _id: id, kind: 'platform' }));
  if (!u) throw ApiError.notFound();
  if (u.isRootSuperadmin) throw ApiError.forbidden('ROOT_PROTECTED', 'The main superadmin always has every permission');
  const before = (u.platformPermissions ?? []).map((g) => g.permission).sort();
  // Removing a permission the caller doesn't hold is also beyond their authority.
  const changed = [...permissions.filter((p) => !before.includes(p)), ...before.filter((p) => !permissions.includes(p))];
  assertCanManage(auth, u, changed);
  u.set('platformPermissions', permissions.map((permission) => ({ permission, scope: 'all' })));
  await noTenant(() => u.save());
  invalidateUserCache(String(u._id));
  await recordAudit({ action: 'permission_change', entity: 'superadmin', entityId: id, clinicId: null, before: { permissions: before }, after: { permissions } });
  return superadminDto(u.toObject() as never);
}

export async function setSuperadminStatus(auth: AuthContext, id: string, status: 'active' | 'disabled') {
  const u = await noTenant(() => UserModel.findOne({ _id: id, kind: 'platform' }));
  if (!u) throw ApiError.notFound();
  if (u.isRootSuperadmin) throw ApiError.forbidden('ROOT_PROTECTED', 'The main superadmin cannot be disabled');
  assertCanManage(auth, u, (u.platformPermissions ?? []).map((g) => g.permission));
  const before = { status: u.status };
  u.status = status;
  await noTenant(() => u.save());
  if (status === 'disabled') await revokeSessions(u._id, 'superadmin_disabled');
  else invalidateUserCache(String(u._id));
  await recordAudit({ action: 'status_change', entity: 'superadmin', entityId: id, clinicId: null, before, after: { status } });
  return superadminDto(u.toObject() as never);
}
