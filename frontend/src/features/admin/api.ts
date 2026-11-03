import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getData, getPaged, patchData, postData, putData } from '@/lib/api/axios';
import { resourceHooks, type Entity, type ListParams } from '@/shared/api/resource';
import type { Grant, Registry } from '@/features/staff/api';

/** Superadmin panel API (04 §8, 05 §7 Platform). */

const clean = (p?: ListParams) =>
  Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v !== undefined && v !== ''));

/* ---------------- dashboard ---------------- */

export type PlatformStats = {
  clinics: {
    total: number;
    byStatus: Record<string, number>;
    bySubscription: Record<string, number>;
    newLast30d: number;
  };
  trialsEnding: { id: string; name: string; slug: string; trialEndsAt: string }[];
  users: { byKind: Record<string, number>; activeLast7d: number };
  health: { openSystemErrors: number; newClientIssues: number };
  mrr: Record<string, number>;
};
export const usePlatformStats = () =>
  useQuery({ queryKey: ['admin', 'stats'], queryFn: () => getData<PlatformStats>('/admin/stats') });

/* ---------------- clinics & subscriptions ---------------- */

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type AdminClinic = Entity & {
  name: string;
  slug: string;
  email: string;
  phone: string;
  timezone: string;
  currency: string;
  locale: 'ar' | 'en';
  status: 'active' | 'suspended';
  planId: string | null;
  planName?: string;
  activeStaff?: number;
  subscription: {
    status: SubscriptionStatus;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  };
  onboardingCompleted: boolean;
  createdAt: string;
  owner: {
    id: string;
    name: string;
    email: string;
    status?: string;
    lastActiveAt?: string | null;
  } | null;
  plan?: { id: string; name: string; code: string } | null;
  counts?: { staff: number; patients: number; invoices: number };
  devInviteUrl?: string;
};

const clinicKeys = { all: ['admin', 'clinics'] as const };
export const useAdminClinics = (p: ListParams) =>
  useQuery({
    queryKey: [...clinicKeys.all, 'list', p],
    queryFn: () => getPaged<AdminClinic>('/admin/clinics', clean(p)),
    placeholderData: keepPreviousData,
  });
export const useAdminClinic = (id?: string) =>
  useQuery({
    queryKey: [...clinicKeys.all, 'one', id],
    queryFn: () => getData<AdminClinic>(`/admin/clinics/${id}`),
    enabled: Boolean(id),
  });

export function useClinicMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: clinicKeys.all });
    void qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<AdminClinic>('/admin/clinics', b),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: Record<string, unknown> & { id: string }) =>
        patchData<AdminClinic>(`/admin/clinics/${id}`, b),
      onSuccess: done,
    }),
    setStatus: useMutation({
      mutationFn: ({
        id,
        to,
        reason,
      }: {
        id: string;
        to: 'suspend' | 'activate';
        reason?: string;
      }) => postData<AdminClinic>(`/admin/clinics/${id}/${to}`, reason ? { reason } : {}),
      onSuccess: done,
    }),
    subscription: useMutation({
      mutationFn: ({ id, ...b }: Record<string, unknown> & { id: string }) =>
        patchData<AdminClinic>(`/admin/clinics/${id}/subscription`, b),
      onSuccess: done,
    }),
  };
}

/* ---------------- plans & catalogs ---------------- */

export type Plan = Entity & {
  code: string;
  name: string;
  description: string;
  currency: string;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: {
    chairs: number;
    staff: number;
    patients: number;
    monthlyMessages: number;
    storageGb: number;
  };
  features: string[];
  isActive: boolean;
  sortOrder: number;
};
export const plansApi = resourceHooks<Plan>('/admin/plans');

export type CatalogKind =
  'procedures' | 'tooth-conditions' | 'medicines' | 'countries' | 'cities' | 'currencies';
export type CatalogItem = Entity & Record<string, unknown> & { isActive: boolean };
const catalogApis = {
  procedures: resourceHooks<CatalogItem>('/admin/catalog/procedures'),
  'tooth-conditions': resourceHooks<CatalogItem>('/admin/catalog/tooth-conditions'),
  medicines: resourceHooks<CatalogItem>('/admin/catalog/medicines'),
  countries: resourceHooks<CatalogItem>('/admin/catalog/countries'),
  cities: resourceHooks<CatalogItem>('/admin/catalog/cities'),
  currencies: resourceHooks<CatalogItem>('/admin/catalog/currencies'),
};
export const catalogApi = (kind: CatalogKind) => catalogApis[kind];

/* ---------------- role templates ---------------- */

export type RoleTemplate = {
  key: string;
  systemKey: string | null;
  name: string | null;
  permissions: Grant[];
  customized: boolean;
  version: number;
};
export const useRoleTemplates = () =>
  useQuery({
    queryKey: ['admin', 'role-templates'],
    queryFn: () => getData<RoleTemplate[]>('/admin/role-templates'),
  });
export const useClinicPermissionRegistry = () =>
  useQuery({
    queryKey: ['admin', 'permission-registry'],
    queryFn: () => getData<Registry>('/admin/permission-registry'),
    staleTime: Infinity,
  });
export function useRoleTemplateMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['admin', 'role-templates'] });
  return {
    save: useMutation({
      mutationFn: ({ key, ...b }: { key: string; version: number; permissions: Grant[] }) =>
        putData<RoleTemplate>(`/admin/role-templates/${key}`, b),
      onSuccess: done,
    }),
    reset: useMutation({
      mutationFn: (key: string) => postData<RoleTemplate>(`/admin/role-templates/${key}/reset`),
      onSuccess: done,
    }),
  };
}

/* ---------------- users & superadmins ---------------- */

export type PlatformUser = {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  kind: 'platform' | 'staff' | 'patient';
  isRootSuperadmin: boolean;
  status: 'active' | 'disabled' | 'locked';
  locked: boolean;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  clinics?: { id: string; name: string; isOwner: boolean; status: string }[];
  permissions?: string[];
  invitationPending?: boolean;
  devInviteUrl?: string;
};
export const useAdminUsers = (p: ListParams) =>
  useQuery({
    queryKey: ['admin', 'users', p],
    queryFn: () => getPaged<PlatformUser>('/admin/users', clean(p)),
    placeholderData: keepPreviousData,
  });
export function useUserAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'disable' | 'enable' | 'unlock' }) =>
      postData<PlatformUser>(`/admin/users/${id}/${action}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
}

export const useSuperadmins = () =>
  useQuery({
    queryKey: ['admin', 'superadmins'],
    queryFn: () => getData<PlatformUser[]>('/admin/superadmins'),
  });
export const usePlatformPermissions = () =>
  useQuery({
    queryKey: ['admin', 'platform-permissions'],
    queryFn: () => getData<string[]>('/admin/platform-permissions'),
    staleTime: Infinity,
  });
export function useSuperadminMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['admin', 'superadmins'] });
  return {
    invite: useMutation({
      mutationFn: (b: { name: string; email: string; permissions: string[] }) =>
        postData<PlatformUser>('/admin/superadmins', b),
      onSuccess: done,
    }),
    permissions: useMutation({
      mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) =>
        putData<PlatformUser>(`/admin/superadmins/${id}/permissions`, { permissions }),
      onSuccess: done,
    }),
    status: useMutation({
      mutationFn: ({ id, to }: { id: string; to: 'disable' | 'enable' }) =>
        postData<PlatformUser>(`/admin/superadmins/${id}/${to}`),
      onSuccess: done,
    }),
  };
}

/* ---------------- logs ---------------- */

export const LOG_KINDS = ['audit', 'activity', 'issues', 'errors', 'requests'] as const;
export type LogKind = (typeof LOG_KINDS)[number];
export const LOG_PERMISSION: Record<LogKind, string> = {
  audit: 'platform.logs.audit.read',
  activity: 'platform.logs.activity.read',
  issues: 'platform.logs.issues.read',
  errors: 'platform.logs.errors.read',
  requests: 'platform.logs.requests.read',
};
export type LogRow = Record<string, unknown> & { id: string; clinic: string; user: string };

export const useLogs = (kind: LogKind, p: ListParams, enabled = true) =>
  useQuery({
    queryKey: ['admin', 'logs', kind, p],
    queryFn: () => getPaged<LogRow>(`/admin/logs/${kind}`, clean(p)),
    placeholderData: keepPreviousData,
    enabled,
  });

export type TimelineEvent = {
  at: string;
  kind: 'activity' | 'audit' | 'issue' | 'request';
  type: string;
  label: string;
  sessionId?: string;
  clinicId: string | null;
};
export const useTimeline = (p: {
  userId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
}) =>
  useQuery({
    queryKey: ['admin', 'timeline', p],
    queryFn: () =>
      getData<{ from: string; to: string; events: TimelineEvent[] }>('/admin/logs/timeline', {
        params: clean(p),
      }),
    enabled: Boolean(p.userId || p.sessionId),
  });

export function useLogItemUpdate(kind: 'issues' | 'errors') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: { id: string; status?: string; notes?: string }) =>
      patchData<LogRow>(`/admin/logs/${kind}/${id}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'logs', kind] }),
  });
}

export async function downloadLogsCsv(kind: LogKind, p: ListParams) {
  const res = await api.get<Blob>(`/admin/logs/${kind}`, {
    params: { ...clean(p), page: undefined, limit: undefined, format: 'csv' },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${kind}-logs.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
