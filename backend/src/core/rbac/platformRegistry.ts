// SHARED FILE — synced to the frontend (src/shared/generated/rbac).
// Platform (superadmin) permissions (04_ROLES_AND_PERMISSIONS.md §8.2).
import type { PermissionDef } from './rbac.types';

const keys = [
  'platform.clinic.read',
  'platform.clinic.manage',
  'platform.clinic.suspend',
  'platform.clinicData.read',
  'platform.clinicData.write',
  'platform.impersonate',
  'platform.plan.manage',
  'platform.subscription.manage',
  'platform.catalog.manage',
  'platform.settings.manage',
  'platform.user.read',
  'platform.user.manage',
  'platform.superadmin.manage',
  'platform.logs.audit.read',
  'platform.logs.activity.read',
  'platform.logs.issues.read',
  'platform.logs.errors.read',
  'platform.logs.requests.read',
  'platform.announcement.manage',
  'platform.ticket.manage',
  'platform.stats.read',
] as const;

export type PlatformPermissionKey = (typeof keys)[number];

export const PLATFORM_PERMISSIONS: Readonly<Record<string, PermissionDef>> = Object.fromEntries(
  keys.map((k) => [k, { resource: k.split('.').slice(0, -1).join('.'), scopes: ['all'], labelKey: `perm.${k}` }]),
);

export const PLATFORM_PERMISSION_KEYS: readonly string[] = keys;

/** Platform grants that can carry clinic field rules (cross-tenant explorer). */
export const PLATFORM_FIELD_SCOPED = new Set<string>(['platform.clinicData.read', 'platform.clinicData.write']);
