import { Types } from 'mongoose';
import { env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { withTransaction } from '@/core/db/transaction';
import { nextNumber } from '@/core/db/sequence';
import { ApiError } from '@/core/http/ApiError';
import { pageMeta } from '@/core/http/response';
import { fieldPolicyOf, scopeFilter, withScope, type ScopeRule } from '@/core/rbac/authorize';
import { applyFieldPolicy, assertQueryable, assertWritable, sortFields } from '@/core/rbac/fieldPolicy';
import { bumpPermVersion, computeStaffGrants } from '@/core/rbac/permission.service';
import { PERMISSIONS } from '@/core/rbac/registry';
import { escalationViolations, resolveEffectiveGrants, resolveFields } from '@/core/rbac/resolve';
import type { FieldAccess, Grant, Override } from '@/core/rbac/rbac.types';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { sendInvitation } from '@/modules/auth/auth.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { RoleModel } from '@/modules/roles/role.model';
import { UserModel } from '@/modules/users/user.model';
import { decrypt, encrypt } from '@/shared/crypto';
import { parseSort, skipOf } from '@/shared/pagination';
import { toSearchName } from '@/shared/validation/normalize';
import type { Staff } from './staff.model';
import { staffRepository } from './staff.repository';
import type { StaffInvite, StaffListQuery, StaffUpdate } from './staff.schemas';

const RESOURCE = 'staff.member';
export const staffScope: ScopeRule = { own: (auth) => ({ _id: new Types.ObjectId(auth.staffId) }) };
const SORTABLE = ['name', 'createdAt', 'staffType', 'status', 'jobTitle', 'licenseExpiry'] as const;

type Raw = Partial<Staff> & { _id: Types.ObjectId; __v?: number; nationalIdEnc?: string; bank?: { bankName?: string; ibanEnc?: string; ibanLast4?: string } };

/** Hooks other modules register (e.g. scheduling checks future appointments, 08 §1). */
type BeforeDeactivate = (staffId: string) => Promise<void>;
const beforeDeactivateHooks: BeforeDeactivate[] = [];
export function onBeforeStaffDeactivate(fn: BeforeDeactivate): void {
  beforeDeactivateHooks.push(fn);
}

/** Storage → API shape. Encrypted values are decrypted only when the field survived projection. */
export function toStaffDto(s: Raw) {
  return {
    id: String(s._id),
    version: s.__v ?? 0,
    userId: s.userId ? String(s.userId) : undefined,
    fileNumber: s.fileNumber,
    name: s.name,
    photo: s.avatarFileId ? String(s.avatarFileId) : undefined,
    phone: s.phone?.e164 ?? undefined,
    email: s.email ?? undefined,
    address: s.address ?? undefined,
    gender: s.gender ?? undefined,
    dateOfBirth: s.dateOfBirth ?? undefined,
    nationalId: s.nationalIdEnc ? decrypt(s.nationalIdEnc) : s.nationalIdLast4 ? `******${s.nationalIdLast4}` : undefined,
    nationality: s.nationality ?? undefined,
    jobTitle: s.jobTitle ?? undefined,
    staffType: s.staffType,
    isOwner: s.isOwner,
    roleIds: s.roleIds?.map(String),
    specialty: s.specialty ?? undefined,
    licenseNumber: s.licenseNumber ?? undefined,
    licenseExpiry: s.licenseExpiry ?? undefined,
    color: s.color,
    bookableOnline: s.bookableOnline,
    defaultChairId: s.defaultChairId ? String(s.defaultChairId) : undefined,
    shiftId: s.shiftId ? String(s.shiftId) : undefined,
    employment: s.employment,
    compensation: s.compensation
      ? {
          basicSalary: s.compensation.basicSalary,
          currency: s.compensation.currency,
          payFrequency: s.compensation.payFrequency,
          allowances: s.compensation.allowances?.map((a) => ({ componentId: String(a.componentId), amount: a.amount })),
          deductions: s.compensation.deductions?.map((a) => ({ componentId: String(a.componentId), amount: a.amount })),
          socialSecurity: s.compensation.socialSecurity,
          commission: s.compensation.commission?.basis ? s.compensation.commission : undefined,
        }
      : undefined,
    bank: s.bank ? { bankName: s.bank.bankName, iban: s.bank.ibanEnc ? decrypt(s.bank.ibanEnc) : s.bank.ibanLast4 ? `****${s.bank.ibanLast4}` : undefined } : undefined,
    status: s.status,
    hasCustomPermissions: Boolean(s.permissionOverrides?.length),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}
export type StaffDto = ReturnType<typeof toStaffDto>;

function serialize(auth: AuthContext, raw: Raw) {
  const dto = toStaffDto(raw);
  // Compensation lives in two places: the serializer drops empty parents after hiding.
  const out = applyFieldPolicy(dto, fieldPolicyOf(auth, RESOURCE));
  if (out.compensation && Object.values(out.compensation).every((v) => v === undefined)) delete out.compensation;
  return out;
}

export async function listStaff(auth: AuthContext, q: StaffListQuery) {
  const policy = fieldPolicyOf(auth, RESOURCE);
  assertQueryable([...sortFields(q.sort), q.q ? 'name' : undefined], policy);
  const filter: Record<string, unknown> = { ...scopeFilter(auth, staffScope) };
  if (q.staffType) filter.staffType = q.staffType;
  if (q.status) filter.status = q.status;
  if (q.bookable) filter.staffType = { $in: ['dentist', 'hygienist'] };
  const { items, total } = await staffRepository.list(policy, { filter, q: q.q, sort: parseSort(q.sort, SORTABLE, { name: 1 }), skip: skipOf(q), limit: q.limit });
  return { data: items.map((s) => serialize(auth, s as Raw)), meta: pageMeta(q.page, q.limit, total) };
}

export async function getStaff(auth: AuthContext, id: string) {
  const policy = fieldPolicyOf(auth, RESOURCE);
  const raw = await staffRepository.findOne(policy, withScope(auth, staffScope, { _id: id }));
  if (!raw) throw ApiError.notFound();
  return serialize(auth, raw as Raw);
}

/** Applies a validated, field-checked patch onto the document. */
function applyPatch(doc: InstanceType<typeof import('./staff.model').StaffModel>, b: Partial<StaffUpdate>) {
  if (b.name !== undefined) {
    doc.name = b.name;
    doc.searchName = toSearchName(b.name);
  }
  if (b.phone !== undefined) doc.set('phone', b.phone ? { e164: b.phone, countryCode: b.phone.slice(1, 4), number: b.phone.slice(4) } : undefined);
  if (b.email !== undefined) doc.set('email', b.email ?? undefined);
  if ('address' in b) doc.address = b.address;
  if ('gender' in b) doc.set('gender', b.gender);
  if ('dateOfBirth' in b) doc.set('dateOfBirth', b.dateOfBirth ?? undefined);
  if ('nationalId' in b) {
    const v = (b as StaffUpdate).nationalId;
    doc.set('nationalIdEnc', v ? encrypt(v) : undefined);
    doc.set('nationalIdLast4', v ? v.slice(-4) : undefined);
  }
  for (const k of ['nationality', 'jobTitle', 'staffType', 'specialty', 'licenseNumber', 'color', 'bookableOnline'] as const) {
    if (k in b && (b as Record<string, unknown>)[k] !== undefined) doc.set(k, (b as Record<string, unknown>)[k]);
  }
  if ('licenseExpiry' in b) doc.set('licenseExpiry', b.licenseExpiry ?? undefined);
  if ('defaultChairId' in b) doc.set('defaultChairId', (b as StaffUpdate).defaultChairId ?? undefined);
  if ('shift' in b) doc.set('shiftId', (b as StaffUpdate).shift ?? undefined);
  if (b.employment) doc.set('employment', { ...doc.employment, ...b.employment });
  if (b.compensation) {
    for (const [k, v] of Object.entries(b.compensation)) doc.set(`compensation.${k}`, v === null ? undefined : v);
  }
  if ((b as StaffUpdate).bank) {
    const bank = (b as StaffUpdate).bank!;
    doc.set('bank.bankName', bank.bankName);
    if (bank.iban !== undefined) {
      doc.set('bank.ibanEnc', bank.iban ? encrypt(bank.iban) : undefined);
      doc.set('bank.ibanLast4', bank.iban ? bank.iban.slice(-4) : undefined);
    }
  }
}

export async function updateStaff(auth: AuthContext, id: string, body: StaffUpdate) {
  const policy = fieldPolicyOf(auth, RESOURCE);
  const { version, ...changes } = body;
  assertWritable(changes, policy);
  const doc = await staffRepository.findDoc(withScope(auth, staffScope, { _id: id }));
  if (!doc) throw ApiError.notFound();
  if ((doc.__v ?? 0) !== version) throw ApiError.conflict('VERSION_CONFLICT', 'The record was changed by someone else.');
  const before = toStaffDto(doc.toObject() as Raw);
  applyPatch(doc, changes);
  doc.increment();
  await doc.save();
  const after = toStaffDto(doc.toObject() as Raw);
  await recordAudit({ action: 'update', entity: 'staff', entityId: id, before, after, resource: RESOURCE });
  if (changes.email !== undefined || changes.phone !== undefined || changes.name !== undefined) {
    await UserModel.updateOne({ _id: doc.userId }, { $set: { ...(changes.name ? { displayName: changes.name } : {}) } });
  }
  return getStaff(auth, id);
}

/** Invite: creates or links the user, the staff document and sends the invitation (08 §1). */
export async function inviteStaff(auth: AuthContext, body: StaffInvite) {
  const policy = fieldPolicyOf(auth, RESOURCE);
  const { roleIds, sendInvite, ...fields } = body;
  assertWritable(fields, policy);
  const clinic = await runWithoutTenant(() => ClinicModel.findById(auth.clinicId).select('name locale').lean());
  if (!clinic) throw ApiError.notFound();
  const roles = roleIds?.length ? await RoleModel.find({ _id: { $in: roleIds } }).select('_id').lean() : [];
  if (roles.length !== (roleIds?.length ?? 0)) throw ApiError.validation([{ path: 'roleIds', code: 'not_found' }]);

  const { staff, user, isNewUser } = await withTransaction(async (session) => {
    let user = await UserModel.findOne(body.email ? { email: body.email } : { 'phone.e164': body.phone }).session(session);
    const isNewUser = !user;
    if (user && user.kind !== 'staff') throw ApiError.conflict('DUPLICATE', 'This email/phone belongs to another account type', { fields: ['email'] });
    if (!user) {
      user = new UserModel({
        kind: 'staff',
        email: body.email,
        ...(body.phone ? { phone: { e164: body.phone } } : {}),
        displayName: body.name,
        locale: clinic.locale ?? 'ar',
        mustChangePassword: false,
      });
      await user.save({ session });
    }
    const exists = await staffRepository.findDoc({ userId: user._id }, session);
    if (exists) throw ApiError.conflict('DUPLICATE', 'This person already works at this clinic', { fields: ['email'] });
    const staff = await staffRepository.create(
      {
        userId: user._id,
        fileNumber: await nextNumber('staff', 'STF', { pad: 4, session }),
        name: body.name,
        searchName: toSearchName(body.name),
        staffType: body.staffType,
        roleIds: roles.map((r) => r._id),
        status: 'active',
      } as Partial<Staff>,
      session,
    );
    applyPatch(staff, fields as Partial<StaffUpdate>);
    await staff.save({ session });
    return { staff, user, isNewUser };
  });
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'create', entity: 'staff', entityId: staff._id, after: toStaffDto(staff.toObject() as Raw), resource: RESOURCE });
  if (sendInvite && isNewUser) await sendInvitation(user, { id: auth.clinicId!, name: clinic.name });
  return getStaff({ ...auth, scope: 'all' }, String(staff._id));
}

export async function resendInvite(auth: AuthContext, id: string) {
  const staff = await staffRepository.findDoc({ _id: id });
  if (!staff) throw ApiError.notFound();
  const user = await UserModel.findById(staff.userId).select('+passwordHash');
  if (!user) throw ApiError.notFound();
  if (user.passwordHash) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'The user already activated the account');
  const clinic = await runWithoutTenant(() => ClinicModel.findById(auth.clinicId).select('name').lean());
  const token = await sendInvitation(user, { id: auth.clinicId!, name: clinic?.name ?? '' });
  return { sent: true, ...(env.NODE_ENV !== 'production' ? { devInviteUrl: `${env.FRONTEND_URL}/invite/${token}` } : {}) };
}

export async function deactivateStaff(auth: AuthContext, id: string, body: { status: 'inactive' | 'terminated'; endDate?: string; reason?: string }) {
  const doc = await staffRepository.findDoc({ _id: id });
  if (!doc) throw ApiError.notFound();
  if (doc.isOwner && (await staffRepository.countActive({ isOwner: true })) <= 1) throw ApiError.conflict('LAST_OWNER', 'A clinic must keep at least one owner');
  for (const hook of beforeDeactivateHooks) await hook(id);
  const before = { status: doc.status };
  doc.status = body.status;
  if (body.endDate) doc.set('employment.endDate', body.endDate);
  await doc.save();
  const { RefreshTokenModel } = await import('@/modules/auth/auth.models');
  await RefreshTokenModel.updateMany({ userId: doc.userId, clinicId: auth.clinicId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'staff_deactivated' } });
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'status_change', entity: 'staff', entityId: id, before, after: { status: body.status }, reason: body.reason });
  return getStaff(auth, id);
}

export async function reactivateStaff(auth: AuthContext, id: string) {
  const doc = await staffRepository.findDoc({ _id: id });
  if (!doc) throw ApiError.notFound();
  doc.status = 'active';
  await doc.save();
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'status_change', entity: 'staff', entityId: id, after: { status: 'active' } });
  return getStaff(auth, id);
}

export async function setStaffRoles(auth: AuthContext, id: string, body: { roleIds: string[]; isOwner?: boolean }) {
  const doc = await staffRepository.findDoc({ _id: id });
  if (!doc) throw ApiError.notFound();
  const roles = await RoleModel.find({ _id: { $in: body.roleIds } }).select('_id').lean();
  if (roles.length !== body.roleIds.length) throw ApiError.validation([{ path: 'roleIds', code: 'not_found' }]);
  if (body.isOwner !== undefined && body.isOwner !== doc.isOwner) {
    if (!auth.isOwner) throw ApiError.forbidden('FORBIDDEN', 'Only an owner can change ownership');
    if (!body.isOwner && (await staffRepository.countActive({ isOwner: true })) <= 1) throw ApiError.conflict('LAST_OWNER', 'A clinic must keep at least one owner');
  }
  const before = { roleIds: doc.roleIds.map(String), isOwner: doc.isOwner };
  doc.roleIds = roles.map((r) => r._id) as never;
  if (body.isOwner !== undefined) doc.isOwner = body.isOwner;
  await doc.save();
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'permission_change', entity: 'staff', entityId: id, before, after: { roleIds: body.roleIds, isOwner: doc.isOwner }, summary: 'roles' });
  return getStaff(auth, id);
}

export async function getOverrides(id: string) {
  const doc = await staffRepository.findDoc({ _id: id });
  if (!doc) throw ApiError.notFound();
  return { overrides: (doc.permissionOverrides ?? []) as Override[] };
}

/** Per-staff overrides (04 §4.4). The editor can't grant beyond its own rights unless owner. */
export async function setOverrides(auth: AuthContext, id: string, overrides: Override[]) {
  for (const o of overrides) if (!PERMISSIONS[o.permission]) throw ApiError.validation([{ path: 'overrides', code: 'invalid_option', params: { permission: o.permission } }]);
  if (!auth.isOwner) {
    const bad = escalationViolations(auth.grants, overrides.filter((o): o is Grant => !('revoked' in o)));
    if (bad.length) throw ApiError.forbidden('ESCALATION_FORBIDDEN', 'Cannot grant beyond your own permissions', { permissions: bad });
  }
  const doc = await staffRepository.findDoc({ _id: id });
  if (!doc) throw ApiError.notFound();
  const before = { overrides: doc.permissionOverrides };
  doc.permissionOverrides = overrides as never;
  await doc.save();
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'permission_change', entity: 'staff', entityId: id, before, after: { overrides }, summary: 'overrides' });
  return getOverrides(id);
}

/** Inherited result (per role) + final effective grants, for the Permissions tab. */
export async function effectivePermissions(auth: AuthContext, id: string) {
  const doc = await staffRepository.findDoc({ _id: id });
  if (!doc) throw ApiError.notFound();
  if (doc.isOwner) {
    return { isOwner: true, inherited: {}, effective: Object.fromEntries(Object.keys(PERMISSIONS).map((k) => [k, { scope: 'all', fields: Object.fromEntries(Object.keys(resolveFields({ permission: k })).map((f) => [f, 'write' as FieldAccess])), sources: ['owner'] }])) };
  }
  const roles = await RoleModel.find({ _id: { $in: doc.roleIds } }).lean();
  const inherited = resolveEffectiveGrants(roles.map((r) => (r.permissions ?? []) as Grant[]));
  const sources: Record<string, string[]> = {};
  for (const r of roles) for (const g of r.permissions ?? []) (sources[g.permission] ??= []).push(r.name ?? r.systemKey ?? r.key);
  const effective = await computeStaffGrants(auth.clinicId!, id);
  return {
    isOwner: false,
    inherited: Object.fromEntries(Object.entries(inherited).map(([k, v]) => [k, { ...v, sources: sources[k] ?? [] }])),
    effective,
    overrides: doc.permissionOverrides ?? [],
  };
}

export async function myStaff(auth: AuthContext) {
  if (!auth.staffId) throw ApiError.notFound();
  return getStaff({ ...auth, scope: 'all' }, auth.staffId);
}
