// SHARED FILE — synced to the frontend (src/shared/generated/rbac).
export type Scope = 'own' | 'all';
export type FieldAccess = 'hidden' | 'masked' | 'read' | 'write';
export const FIELD_ACCESS_ORDER: Record<FieldAccess, number> = { hidden: 0, masked: 1, read: 2, write: 3 };
export const FIELD_ACCESS_LEVELS: readonly FieldAccess[] = ['hidden', 'masked', 'read', 'write'];

export type MaskKind = 'phone' | 'email' | 'tail4' | 'full';

export type FieldDef = {
  group: string;
  default: FieldAccess;
  /** Can be set to `masked` (otherwise only hidden/read/write). */
  maskable?: boolean;
  mask?: MaskKind;
  /** Defaults to hidden for every system role except Owner and the role owning that data. */
  sensitive?: boolean;
  /** Document paths covered by this field key (defaults to the key itself). */
  paths?: readonly string[];
};

export type PermissionDef = { resource: string; scopes: readonly Scope[]; labelKey: string };

/** Stored on roles, staff overrides and superadmins (03_DATA_MODEL.md §3). */
export type Grant = {
  permission: string;
  scope: Scope;
  fields?: Record<string, FieldAccess>;
  /** Platform grants only: restrict cross-tenant access to these clinics. */
  clinicIds?: string[];
};

export type Override = Grant | { permission: string; revoked: true };

export function isRevoked(o: Override): o is { permission: string; revoked: true } {
  return 'revoked' in o && o.revoked === true;
}
