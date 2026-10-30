import type { FieldAccess, Scope } from '../rbac/rbac.types';

export type AuthKind = 'platform' | 'staff' | 'patient';

/** Effective permission after merging roles and overrides: scope + resolved field map. */
export type EffectiveGrant = { scope: Scope; fields: Record<string, FieldAccess>; clinicIds?: string[] };

export type AuthContext = {
  userId: string;
  kind: AuthKind;
  tokenId: string;
  clinicId?: string;
  staffId?: string;
  patientId?: string;
  isOwner: boolean;
  isRoot: boolean;
  permVersion: number;
  impersonatorUserId?: string;
  readOnly: boolean;
  grants: Record<string, EffectiveGrant>;
  /** Set by authorize() for the permission of the current route. */
  scope?: Scope;
  permission?: string;
};
