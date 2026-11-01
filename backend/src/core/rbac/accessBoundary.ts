import type { AuthContext } from '@/core/auth/auth.types';
import { ApiError } from '@/core/http/ApiError';
import { escalationViolations } from './resolve';
import type { Grant, Override } from './rbac.types';

/**
 * Access-control boundary (04 §9.2). Only the clinic owner grants or removes:
 * - the Full access role (system role key `owner`);
 * - the power to manage access itself (`staff.role.manage`), whether through a role definition,
 *   a role assignment or a per-staff override.
 * Everyone else may grant only what they hold themselves (escalation rule); the built-in job roles
 * (Dentist, Receptionist…) are within the authority of anyone allowed to manage staff.
 */
export const FULL_ACCESS_ROLE_KEY = 'owner';
export const OWNER_ONLY_PERMISSIONS: readonly string[] = ['staff.role.manage'];

type RoleLike = { _id: unknown; key?: string | null; isSystem?: boolean | null; permissions?: unknown };

const ownerOnly = () => ApiError.forbidden('FULL_ACCESS_OWNER_ONLY', 'Only the clinic owner can grant or remove Full access or the right to manage access');
const grantsOf = (r: RoleLike) => ((r.permissions ?? []) as Grant[]);
const holdsOwnerOnly = (grants: { permission: string }[]) => grants.some((g) => OWNER_ONLY_PERMISSIONS.includes(g.permission));

/** Role definitions (create/update/clone). */
export function assertRoleDefinitionAllowed(auth: AuthContext, role: { key?: string | null } | null, grants: Grant[]) {
  if (auth.isOwner) return;
  if (role?.key === FULL_ACCESS_ROLE_KEY || holdsOwnerOnly(grants)) throw ownerOnly();
  const bad = escalationViolations(auth.grants, grants);
  if (bad.length) throw ApiError.forbidden('ESCALATION_FORBIDDEN', 'Cannot grant beyond your own permissions', { permissions: bad });
}

/** Role assignment: `before` and `after` are the target's roles before and after the change. */
export function assertRoleAssignmentAllowed(auth: AuthContext, before: RoleLike[], after: RoleLike[]) {
  if (auth.isOwner) return;
  const had = new Set(before.map((r) => String(r._id)));
  const has = new Set(after.map((r) => String(r._id)));
  const added = after.filter((r) => !had.has(String(r._id)));
  const removed = before.filter((r) => !has.has(String(r._id)));
  for (const r of [...added, ...removed]) if (r.key === FULL_ACCESS_ROLE_KEY || holdsOwnerOnly(grantsOf(r))) throw ownerOnly();
  // Custom roles can contain anything: they must stay within the assigner's own permissions.
  const custom = added.filter((r) => !r.isSystem);
  const bad = escalationViolations(auth.grants, custom.flatMap(grantsOf));
  if (bad.length) throw ApiError.forbidden('ESCALATION_FORBIDDEN', 'Cannot grant beyond your own permissions', { permissions: bad });
}

/** Per-staff overrides: neither grant nor revoke an owner-only permission. */
export function assertOverridesAllowed(auth: AuthContext, before: Override[], after: Override[]) {
  if (auth.isOwner) return;
  const key = (o: Override) => JSON.stringify(o);
  const was = new Set(before.map(key));
  const now = new Set(after.map(key));
  const changed = [...after.filter((o) => !was.has(key(o))), ...before.filter((o) => !now.has(key(o)))];
  if (holdsOwnerOnly(changed)) throw ownerOnly();
}
