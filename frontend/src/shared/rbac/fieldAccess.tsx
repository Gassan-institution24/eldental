import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { FieldAccess } from '@/shared/generated/rbac/rbac.types';

/**
 * Field-level permissions in the UI (04_ROLES_AND_PERMISSIONS.md §4.5). A form or table declares
 * its resource with <FieldScope>; inputs/columns with a `fieldKey` read the access level here.
 */
export type FieldAccessApi = {
  access: (field: string) => FieldAccess;
  canSee: (field: string) => boolean;
  canEdit: (field: string) => boolean;
  isMasked: (field: string) => boolean;
};

const allWrite: FieldAccessApi = {
  access: () => 'write',
  canSee: () => true,
  canEdit: () => true,
  isMasked: () => false,
};

const FieldScopeContext = createContext<FieldAccessApi>(allWrite);

export function makeFieldAccess(
  fields: Record<string, FieldAccess> | undefined,
  fallback: FieldAccess = 'write',
): FieldAccessApi {
  const access = (f: string): FieldAccess => fields?.[f] ?? fallback;
  return {
    access,
    canSee: (f) => access(f) !== 'hidden',
    canEdit: (f) => access(f) === 'write',
    isMasked: (f) => access(f) === 'masked',
  };
}

export function FieldScope({ value, children }: { value: FieldAccessApi; children: ReactNode }) {
  return <FieldScopeContext.Provider value={value}>{children}</FieldScopeContext.Provider>;
}

export function useFieldScope(): FieldAccessApi {
  return useContext(FieldScopeContext);
}

/** For a form that edits a resource: wraps the resolver from the auth grants. */
export function useStaticFieldAccess(fields?: Record<string, FieldAccess>): FieldAccessApi {
  return useMemo(() => makeFieldAccess(fields), [fields]);
}
