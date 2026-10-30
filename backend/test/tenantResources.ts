import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { RoleModel } from '@/modules/roles/role.model';
import { StaffModel } from '@/modules/staff/staff.model';
import type { Session } from './helpers';

/**
 * Registry for the tenant-isolation harness: every tenant resource with a REST surface adds an
 * entry (create a record in clinic B, then assert clinic A can't see or touch it).
 */
export type TenantResource = {
  name: string;
  basePath: string;
  listPath: string;
  createIn: (clinicId: string, ownerOfThatClinic: Session) => Promise<string>;
  update?: Record<string, unknown>;
  canDelete?: boolean;
};

export const TENANT_RESOURCES: TenantResource[] = [
  {
    name: 'staff',
    basePath: '/staff',
    listPath: '/staff?limit=100',
    createIn: async (clinicId) => runInTenant(clinicId, async () => String((await StaffModel.findOne({ staffType: 'receptionist' }).lean())?._id)),
    update: { version: 0, name: 'Hacked Name' },
  },
  {
    name: 'roles',
    basePath: '/roles',
    listPath: '/roles',
    createIn: async (clinicId) => runInTenant(clinicId, async () => String((await RoleModel.findOne({ key: 'dentist' }).lean())?._id)),
    update: { version: 0, name: 'Hacked' },
    canDelete: true,
  },
];

export function registerTenantResource(r: TenantResource): void {
  TENANT_RESOURCES.push(r);
}
