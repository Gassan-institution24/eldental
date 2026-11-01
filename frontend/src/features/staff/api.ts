import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, postData, putData } from '@/lib/api/axios';
import { authKeys } from '@/features/auth/api/session';
import { resourceHooks, type Entity } from '@/shared/api/resource';
import type { FieldAccess, Scope } from '@/shared/generated/rbac/rbac.types';

export type Grant = { permission: string; scope: Scope; fields?: Record<string, FieldAccess> };
export type Override = Grant | { permission: string; revoked: true };

export type StaffMember = Entity & {
  userId?: string;
  fileNumber?: string;
  name: string;
  photo?: string;
  phone?: string;
  email?: string;
  address?: string;
  gender?: 'male' | 'female';
  dateOfBirth?: string;
  nationalId?: string;
  jobTitle?: string;
  staffType: string;
  isOwner?: boolean;
  roleIds?: string[];
  specialties?: string[];
  primarySpecialty?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  color?: string;
  bookableOnline?: boolean;
  employment?: { type?: string; hireDate?: string; endDate?: string };
  compensation?: {
    basicSalary?: number;
    currency?: string;
    socialSecurity?: { enrolled?: boolean };
    commission?: { basis?: 'production' | 'collection'; percent?: number } | null;
  };
  bank?: { bankName?: string; iban?: string };
  status: 'active' | 'inactive' | 'terminated';
  hasCustomPermissions?: boolean;
};

export const staffApi = resourceHooks<StaffMember>('/staff');

export function useInviteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => postData<StaffMember>('/staff', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffApi.keys.all }),
  });
}

export function useStaffAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      body,
    }: {
      id: string;
      action: 'deactivate' | 'reactivate' | 'resend-invite';
      body?: unknown;
    }) => postData<StaffMember>(`/staff/${id}/${action}`, body ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffApi.keys.all }),
  });
}

export function useSetRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; roleIds: string[] }) =>
      putData<StaffMember>(`/staff/${id}/roles`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffApi.keys.all }),
  });
}

/** Owner only, with the owner's password (04 §9). Ownership is never a role or a checkbox. */
export function useTransferOwnership() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      postData<StaffMember>(`/staff/${id}/transfer-ownership`, { password }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: staffApi.keys.all });
      void qc.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export type EffectivePermissions = {
  isOwner: boolean;
  inherited: Record<
    string,
    { scope: Scope; fields: Record<string, FieldAccess>; sources: string[] }
  >;
  effective: Record<string, { scope: Scope; fields: Record<string, FieldAccess> }>;
  overrides?: Override[];
};

export function useEffectivePermissions(id: string | undefined) {
  return useQuery({
    queryKey: ['/staff', 'effective', id],
    queryFn: () => getData<EffectivePermissions>(`/staff/${id}/effective-permissions`),
    enabled: Boolean(id),
  });
}

export function useSaveOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, overrides }: { id: string; overrides: Override[] }) =>
      putData(`/staff/${id}/permission-overrides`, { overrides }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/staff'] }),
  });
}

/* ---------- roles ---------- */

export type Role = Entity & {
  key: string;
  name: string | null;
  systemKey: string | null;
  description: string;
  permissions: Grant[];
  isSystem: boolean;
  status: string;
  userCount?: number;
};
export const rolesApi = resourceHooks<Role>('/roles');

/** Owner-controlled roles: Full access, or any role that can manage access (04 §9.2). */
export const grantsAccessControl = (r: Pick<Role, 'key' | 'permissions'>) =>
  r.key === 'owner' || r.permissions.some((g) => g.permission === 'staff.role.manage');

export function useRoles() {
  return useQuery({ queryKey: ['/roles', 'all'], queryFn: () => getData<Role[]>('/roles') });
}

export type FieldDef = {
  group: string;
  default: FieldAccess;
  maskable?: boolean;
  sensitive?: boolean;
};
export type Registry = {
  modules: string[];
  resources: Record<
    string,
    {
      module: string;
      actions: { key: string; action: string; scopes: Scope[] }[];
      fields?: Record<string, FieldDef>;
    }
  >;
  fieldGroupOrder: string[];
};

export function usePermissionRegistry() {
  return useQuery({
    queryKey: ['/permissions'],
    queryFn: () => getData<Registry>('/permissions'),
    staleTime: Infinity,
  });
}

export type DiffChange =
  | { kind: 'added'; permission: string; scope: string }
  | { kind: 'removed'; permission: string; scope: string }
  | { kind: 'scope'; permission: string; from: string; to: string }
  | {
      kind: 'field';
      permission: string;
      field: string;
      from: FieldAccess;
      to: FieldAccess;
      widened: boolean;
    };

export function usePreviewDiff() {
  return useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: Grant[] }) =>
      postData<{ changes: DiffChange[]; affectedStaff: number }>(`/roles/${id}/preview-diff`, {
        permissions,
      }),
  });
}

export function useCloneRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      postData<Role>(`/roles/${id}/clone`, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/roles'] }),
  });
}
