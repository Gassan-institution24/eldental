import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { toCsv } from '@/shared/csv';
import type { StaffListQuery } from './staff.schemas';
import { listStaff } from './staff.service';

/** Export goes through the same serializer, so hidden fields never appear (04 §4.3). */
export async function exportStaffCsv(auth: AuthContext, q: StaffListQuery): Promise<string> {
  const rows: Record<string, unknown>[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const r = await listStaff(auth, { ...q, page, limit: 100 });
    rows.push(...(r.data as Record<string, unknown>[]));
    if (page >= r.meta.pages) break;
  }
  await recordAudit({ action: 'export', entity: 'staff', summary: `${rows.length} rows` });
  const cols = ['fileNumber', 'name', 'staffType', 'jobTitle', 'phone', 'email', 'licenseNumber', 'licenseExpiry', 'status'];
  const present = cols.filter((c) => rows.some((r) => r[c] !== undefined));
  if (rows.some((r) => (r.compensation as { basicSalary?: number } | undefined)?.basicSalary !== undefined)) present.push('basicSalary');
  return toCsv(present, rows.map((r) => ({ ...r, basicSalary: (r.compensation as { basicSalary?: number } | undefined)?.basicSalary })));
}
