import type { ClientSession } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { ApiError } from '@/core/http/ApiError';
import { bumpPermVersion } from '@/core/rbac/permission.service';
import { FIELD_GROUP_ORDER, MODULES, PERMISSIONS, RESOURCE_FIELDS } from '@/core/rbac/registry';
import { PLATFORM_PERMISSIONS } from '@/core/rbac/platformRegistry';
import { assertRoleDefinitionAllowed, FULL_ACCESS_ROLE_KEY } from '@/core/rbac/accessBoundary';
import { resolveFields } from '@/core/rbac/resolve';
import { ROLE_TEMPLATES } from '@/core/rbac/roleTemplates';
import { FIELD_ACCESS_ORDER, type FieldAccess, type Grant } from '@/core/rbac/rbac.types';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { StaffModel } from '@/modules/staff/staff.model';
import { entityName, freeText } from '@/shared/validation/fields';
import { RoleModel, RoleTemplateModel } from './role.model';

const grant = z.object({
  permission: z.string().refine((p) => Boolean(PERMISSIONS[p]), { message: 'invalid_option' }),
  scope: z.enum(['own', 'all']).default('all'),
  fields: z.record(z.enum(['hidden', 'masked', 'read', 'write'])).optional(),
});

export const roleBody = z
  .object({
    name: entityName({ max: 60 }),
    description: freeText(500).optional(),
    permissions: z.array(grant).max(300),
  })
  .strict();
export const roleUpdateBody = roleBody.partial().extend({ version: z.number().int().min(0) }).strict();
export type RoleBody = z.infer<typeof roleBody>;

function normaliseGrants(grants: Grant[]): Grant[] {
  const out = new Map<string, Grant>();
  for (const g of grants) {
    const def = PERMISSIONS[g.permission];
    if (!def) continue;
    const scope = def.scopes.includes(g.scope) ? g.scope : (def.scopes[0] ?? 'all');
    const registry = (RESOURCE_FIELDS as Record<string, Record<string, { maskable?: boolean }>>)[def.resource];
    let fields: Record<string, FieldAccess> | undefined;
    if (registry && g.fields) {
      fields = {};
      for (const [f, level] of Object.entries(g.fields)) {
        if (!registry[f]) continue;
        fields[f] = level === 'masked' && !registry[f]?.maskable ? 'hidden' : level;
      }
    }
    out.set(g.permission, fields ? { permission: g.permission, scope, fields } : { permission: g.permission, scope });
  }
  return [...out.values()];
}

/** Clones the global templates into a new clinic (onboarding, 04 §5). */
export async function seedClinicRoles(session?: ClientSession) {
  const templates = await runWithoutTenant(() => RoleTemplateModel.find({ status: 'active' }).lean());
  const source = templates.length ? templates.map((t) => ({ key: t.key, systemKey: t.systemKey ?? t.key, permissions: t.permissions as Grant[] })) : ROLE_TEMPLATES;
  const docs = source.map((t) => ({ key: t.key, systemKey: t.systemKey, name: null, permissions: t.permissions, isSystem: true }));
  return RoleModel.insertMany(docs, { session });
}

/** Seeds/refreshes the global templates from code (seed script). */
export async function syncRoleTemplates() {
  for (const t of ROLE_TEMPLATES) {
    await RoleTemplateModel.updateOne({ key: t.key }, { $set: { systemKey: t.systemKey, permissions: t.permissions, isSystem: true, status: 'active' }, $setOnInsert: { name: null } }, { upsert: true });
  }
}

function toDto(r: { _id: unknown; __v?: number; key: string; name?: string | null; systemKey?: string | null; description?: string | null; permissions?: unknown; isSystem?: boolean | null; status?: string | null }, userCount?: number) {
  return {
    id: String(r._id),
    version: r.__v ?? 0,
    key: r.key,
    name: r.name ?? null,
    systemKey: r.systemKey ?? null,
    description: r.description ?? '',
    permissions: r.permissions as Grant[],
    isSystem: Boolean(r.isSystem),
    status: r.status ?? 'active',
    ...(userCount !== undefined ? { userCount } : {}),
  };
}

export async function listRoles() {
  const roles = await RoleModel.find({}).sort({ isSystem: -1, createdAt: 1 }).lean();
  const counts = await StaffModel.aggregate<{ _id: unknown; n: number }>([{ $match: { status: 'active' } }, { $unwind: '$roleIds' }, { $group: { _id: '$roleIds', n: { $sum: 1 } } }]);
  return roles.map((r) => toDto(r, counts.find((c) => String(c._id) === String(r._id))?.n ?? 0));
}

export async function getRole(id: string) {
  const r = await RoleModel.findById(id).lean();
  if (!r) throw ApiError.notFound();
  return toDto(r);
}

/** Escalation rule + owner-only access control (04 §9.2). */
function assertNoEscalation(auth: AuthContext, grants: Grant[], role: { key?: string | null } | null = null) {
  assertRoleDefinitionAllowed(auth, role, grants);
}

export async function createRole(auth: AuthContext, body: RoleBody) {
  const permissions = normaliseGrants(body.permissions as Grant[]);
  assertNoEscalation(auth, permissions);
  const key = `custom_${Date.now().toString(36)}`;
  const r = await RoleModel.create({ key, name: body.name, description: body.description ?? '', permissions, isSystem: false });
  await recordAudit({ action: 'permission_change', entity: 'role', entityId: r._id, after: toDto(r.toObject()), summary: 'role_created' });
  return toDto(r.toObject());
}

export async function updateRole(auth: AuthContext, id: string, body: z.infer<typeof roleUpdateBody>) {
  const r = await RoleModel.findById(id);
  if (!r) throw ApiError.notFound();
  if ((r.__v ?? 0) !== body.version) throw ApiError.conflict('VERSION_CONFLICT', 'The role was changed by someone else.');
  // The Full access role is owner-controlled, even for a rename.
  if (!auth.isOwner && r.key === FULL_ACCESS_ROLE_KEY) assertNoEscalation(auth, [], r);
  const before = toDto(r.toObject());
  if (body.permissions) {
    const permissions = normaliseGrants(body.permissions as Grant[]);
    assertNoEscalation(auth, permissions, r);
    r.permissions = permissions as never;
  }
  if (body.name !== undefined) r.name = body.name;
  if (body.description !== undefined) r.description = body.description;
  r.increment();
  await r.save();
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'permission_change', entity: 'role', entityId: id, before, after: toDto(r.toObject()), summary: 'role_updated' });
  return toDto(r.toObject());
}

export async function resetRoleName(id: string) {
  const r = await RoleModel.findById(id);
  if (!r) throw ApiError.notFound();
  r.name = null;
  await r.save();
  return toDto(r.toObject());
}

export async function deleteRole(auth: AuthContext, id: string) {
  const r = await RoleModel.findById(id);
  if (!r) throw ApiError.notFound();
  if (r.key === 'owner') throw ApiError.conflict('LAST_OWNER', 'The owner role cannot be deleted');
  const inUse = await StaffModel.countDocuments({ roleIds: r._id, status: 'active' });
  if (inUse) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Role is assigned to staff', { count: inUse });
  await (r as unknown as { softDelete: () => Promise<void> }).softDelete();
  await bumpPermVersion(auth.clinicId!);
  await recordAudit({ action: 'delete', entity: 'role', entityId: id, before: toDto(r.toObject()) });
}

export async function cloneRole(auth: AuthContext, id: string, name: string) {
  const r = await RoleModel.findById(id).lean();
  if (!r) throw ApiError.notFound();
  return createRole(auth, { name, description: r.description ?? '', permissions: r.permissions as never });
}

export type DiffChange =
  | { kind: 'added' | 'removed'; permission: string; scope: string }
  | { kind: 'scope'; permission: string; from: string; to: string }
  | { kind: 'field'; permission: string; field: string; from: FieldAccess; to: FieldAccess; widened: boolean };

/** "Diff before save" (04 §7): what this change grants or removes, with widened flags. */
export function diffGrants(before: Grant[], after: Grant[]): DiffChange[] {
  const b = new Map(before.map((g) => [g.permission, g]));
  const a = new Map(after.map((g) => [g.permission, g]));
  const out: DiffChange[] = [];
  for (const [p, g] of a) {
    const old = b.get(p);
    if (!old) {
      out.push({ kind: 'added', permission: p, scope: g.scope });
      continue;
    }
    if (old.scope !== g.scope) out.push({ kind: 'scope', permission: p, from: old.scope, to: g.scope });
    const fb = resolveFields(old);
    const fa = resolveFields(g);
    for (const f of Object.keys(fa)) {
      const from = fb[f] ?? 'hidden';
      const to = fa[f] ?? 'hidden';
      if (from !== to) out.push({ kind: 'field', permission: p, field: f, from, to, widened: FIELD_ACCESS_ORDER[to] > FIELD_ACCESS_ORDER[from] });
    }
  }
  for (const [p, g] of b) if (!a.has(p)) out.push({ kind: 'removed', permission: p, scope: g.scope });
  return out;
}

export async function previewDiff(id: string, permissions: Grant[]) {
  const r = await RoleModel.findById(id).lean();
  if (!r) throw ApiError.notFound();
  const affected = await StaffModel.countDocuments({ roleIds: r._id, status: 'active' });
  return { changes: diffGrants((r.permissions ?? []) as Grant[], normaliseGrants(permissions)), affectedStaff: affected };
}

/** Registry for the role editor UI: modules → resources → actions + field groups (05 §7). */
export function permissionRegistry() {
  const resources: Record<string, { module: string; actions: { key: string; action: string; scopes: readonly string[] }[]; fields?: Record<string, unknown> }> = {};
  for (const [key, def] of Object.entries(PERMISSIONS)) {
    const module = key.split('.')[0] ?? '';
    const entry = (resources[def.resource] ??= { module, actions: [] });
    entry.actions.push({ key, action: key.slice(def.resource.length + 1), scopes: def.scopes });
    const fields = (RESOURCE_FIELDS as Record<string, Record<string, unknown>>)[def.resource];
    if (fields) entry.fields = fields;
  }
  return { modules: MODULES, resources, fieldGroupOrder: FIELD_GROUP_ORDER, templates: ROLE_TEMPLATES.map((t) => t.key) };
}

export function platformRegistry() {
  return { permissions: Object.entries(PLATFORM_PERMISSIONS).map(([key, def]) => ({ key, resource: def.resource })), clinicResources: RESOURCE_FIELDS };
}
