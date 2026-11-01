import { SPECIALTY_STAFF_TYPES, specialtyFromText, type DentalSpecialty } from '@/shared/dental/specialties';

/**
 * Free-text `specialty` → structured `specialties` + `primarySpecialty` (07 §13, migration notes).
 * Pure planning step, so the script can report before it writes anything.
 */
export type LegacyStaffRow = { _id: unknown; clinicId?: unknown; name?: string | null; staffType?: string | null; specialty?: unknown; specialties?: string[] | null };

export type SpecialtyPlanItem =
  | { kind: 'map'; id: unknown; clinicId: unknown; name: string; from: string; to: DentalSpecialty }
  | { kind: 'unmapped'; id: unknown; clinicId: unknown; name: string; from: string; reason: 'unknown_value' | 'not_clinical_staff' | 'already_structured' };

export function planSpecialtyMigration(rows: LegacyStaffRow[]): SpecialtyPlanItem[] {
  const out: SpecialtyPlanItem[] = [];
  for (const r of rows) {
    const from = typeof r.specialty === 'string' ? r.specialty.trim() : '';
    if (!from) continue;
    const base = { id: r._id, clinicId: r.clinicId, name: r.name ?? '', from };
    if (r.specialties?.length) {
      out.push({ ...base, kind: 'unmapped', reason: 'already_structured' });
      continue;
    }
    if (!(SPECIALTY_STAFF_TYPES as readonly string[]).includes(r.staffType ?? '')) {
      out.push({ ...base, kind: 'unmapped', reason: 'not_clinical_staff' });
      continue;
    }
    const to = specialtyFromText(from);
    out.push(to ? { ...base, kind: 'map', to } : { ...base, kind: 'unmapped', reason: 'unknown_value' });
  }
  return out;
}
