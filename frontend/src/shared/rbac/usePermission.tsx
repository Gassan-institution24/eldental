import { useCallback, useMemo, type ReactNode } from 'react';
import { useSessionData } from '@/features/auth/api/session';
import type { Grant } from '@/features/auth/types';
import {
  RESOURCE_FIELDS,
  type PermissionKey,
  type ResourceKey,
} from '@/shared/generated/rbac/registry';
import type { FieldAccess } from '@/shared/generated/rbac/rbac.types';
import { makeFieldAccess, type FieldAccessApi } from './fieldAccess';

/** Owner and root superadmin see everything; others need the grant (04 §1). */
export function usePermission() {
  const session = useSessionData();
  const can: (perm?: string, scope?: 'own' | 'all') => boolean = useCallback(
    (perm?: string, scope?: 'own' | 'all'): boolean => {
      if (!perm) return true;
      if (!session) return false;
      // 'a|b' = any of them (routes and menu items shared by several permissions).
      if (perm.includes('|')) return perm.split('|').some((p) => can(p, scope));
      if (session.isOwner || session.user.isRootSuperadmin) return true;
      const g = session.grants[perm];
      if (!g) return false;
      return scope === 'all' ? g.scope === 'all' : true;
    },
    [session],
  );
  const grant = useCallback((perm: string): Grant | undefined => session?.grants[perm], [session]);
  return { can, grant, session };
}

export function Can({
  perm,
  scope,
  children,
  fallback = null,
}: {
  perm: PermissionKey | string;
  scope?: 'own' | 'all';
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePermission();
  return <>{can(perm, scope) ? children : fallback}</>;
}

/**
 * `useFieldAccess('staff.member')` → canSee / canEdit / isMasked for that resource, merged from
 * every grant on that resource (read/update/create) — the most permissive level wins (04 §1.5).
 */
export function useFieldAccess(
  resource: ResourceKey | string,
  mode: 'read' | 'write' = 'read',
): FieldAccessApi {
  const session = useSessionData();
  return useMemo(() => {
    const registry =
      (RESOURCE_FIELDS as Record<string, Record<string, { default: FieldAccess }>>)[resource] ?? {};
    if (!session) return makeFieldAccess({}, 'hidden');
    if (session.isOwner || session.user.isRootSuperadmin) return makeFieldAccess({}, 'write');
    const order: Record<FieldAccess, number> = { hidden: 0, masked: 1, read: 2, write: 3 };
    const merged: Record<string, FieldAccess> = {};
    let hasGrant = false;
    let canWriteResource = false;
    for (const [perm, g] of Object.entries(session.grants)) {
      if (!perm.startsWith(`${resource}.`)) continue;
      hasGrant = true;
      const action = perm.slice(resource.length + 1);
      if (action !== 'read' && action !== 'export' && action !== 'print') canWriteResource = true;
      for (const [f, level] of Object.entries(g.fields)) {
        const current = merged[f];
        if (!current || order[level] > order[current]) merged[f] = level;
      }
    }
    if (!hasGrant) return makeFieldAccess({}, 'hidden');
    const fields: Record<string, FieldAccess> = {};
    for (const [f, def] of Object.entries(registry)) {
      let level = merged[f] ?? def.default;
      // Write needs a write action on the resource; in read mode nothing is editable.
      if (level === 'write' && (mode === 'read' || !canWriteResource)) level = 'read';
      fields[f] = level;
    }
    return makeFieldAccess(fields, mode === 'write' && canWriteResource ? 'write' : 'read');
  }, [session, resource, mode]);
}
