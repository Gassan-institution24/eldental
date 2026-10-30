import { Types } from 'mongoose';
import { logger } from '@/config/logger';
import { getRedis } from '@/config/redis';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { RoleModel } from '@/modules/roles/role.model';
import { StaffModel } from '@/modules/staff/staff.model';
import type { EffectiveGrant } from '../auth/auth.types';
import { runWithoutTenant } from '../tenancy/tenantPlugin';
import { PLATFORM_PERMISSION_KEYS } from './platformRegistry';
import type { Grant, Override } from './rbac.types';
import { resolveEffectiveGrants } from './resolve';

const TTL_SECONDS = 600;
const memory = new Map<string, { at: number; value: Record<string, EffectiveGrant> }>();
const pvMemory = new Map<string, { at: number; pv: number }>();
const PV_TTL_MS = 3000;

function cacheKey(clinicId: string, staffId: string, pv: number) {
  return `perm:${clinicId}:${staffId}:${pv}`;
}

/** Current permission version of a clinic (bumped on role/assignment/override changes). */
export async function getPermVersion(clinicId: string): Promise<number> {
  const hit = pvMemory.get(clinicId);
  if (hit && Date.now() - hit.at < PV_TTL_MS) return hit.pv;
  const c = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('permVersion').lean());
  const pv = c?.permVersion ?? 1;
  pvMemory.set(clinicId, { at: Date.now(), pv });
  return pv;
}

/** Called after any role / assignment / override change (04 §6.1). */
export async function bumpPermVersion(clinicId: string | Types.ObjectId): Promise<number> {
  const id = String(clinicId);
  const c = await runWithoutTenant(() => ClinicModel.findByIdAndUpdate(id, { $inc: { permVersion: 1 } }, { new: true }).select('permVersion').lean());
  pvMemory.delete(id);
  for (const k of memory.keys()) if (k.startsWith(`perm:${id}:`)) memory.delete(k);
  return c?.permVersion ?? 1;
}

/** Effective grants of a staff member = union of roles, then overrides; cached by pv. */
export async function loadStaffGrants(clinicId: string, staffId: string, pv: number): Promise<Record<string, EffectiveGrant>> {
  const key = cacheKey(clinicId, staffId, pv);
  const mem = memory.get(key);
  if (mem && Date.now() - mem.at < TTL_SECONDS * 1000) return mem.value;
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        const value = JSON.parse(raw) as Record<string, EffectiveGrant>;
        memory.set(key, { at: Date.now(), value });
        return value;
      }
    } catch (err) {
      logger.warn({ err }, 'permission cache read failed');
    }
  }
  const value = await computeStaffGrants(clinicId, staffId);
  memory.set(key, { at: Date.now(), value });
  if (memory.size > 5000) memory.delete(memory.keys().next().value as string);
  if (redis) await redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS).catch(() => undefined);
  return value;
}

export async function computeStaffGrants(clinicId: string, staffId: string): Promise<Record<string, EffectiveGrant>> {
  const staff = await StaffModel.findOne({ _id: staffId }).setOptions({ clinicId }).select('roleIds permissionOverrides').lean();
  if (!staff) return {};
  const roles = await RoleModel.find({ _id: { $in: staff.roleIds ?? [] }, status: 'active' }).setOptions({ clinicId }).select('permissions').lean();
  return resolveEffectiveGrants(
    roles.map((r) => (r.permissions ?? []) as Grant[]),
    (staff.permissionOverrides ?? []) as Override[],
  );
}

/** Platform grants: root holds every platform permission (04 §8.1). */
export function platformGrants(user: { isRootSuperadmin?: boolean | null; platformPermissions?: { permission: string; fields?: unknown; clinicIds?: string[] | null }[] | null }): Record<string, EffectiveGrant> {
  const out: Record<string, EffectiveGrant> = {};
  if (user.isRootSuperadmin) {
    for (const k of PLATFORM_PERMISSION_KEYS) out[k] = { scope: 'all', fields: {} };
    return out;
  }
  for (const g of user.platformPermissions ?? []) {
    if (!PLATFORM_PERMISSION_KEYS.includes(g.permission)) continue;
    out[g.permission] = {
      scope: 'all',
      fields: (g.fields ?? {}) as EffectiveGrant['fields'],
      ...(g.clinicIds && g.clinicIds.length ? { clinicIds: g.clinicIds } : {}),
    };
  }
  return out;
}

export function clearPermissionCache(): void {
  memory.clear();
  pvMemory.clear();
}
