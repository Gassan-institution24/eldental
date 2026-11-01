// SHARED FILE — synced to the frontend (src/shared/generated/dental). Labels are i18n keys:
// `staff:specialties.<code>` (ar + en). Codes are stable; never rename one (03 §3.1).

/** Fixed dental specialties catalog (07 §13). Clinics cannot add their own (for now). */
export const DENTAL_SPECIALTIES = [
  'general',
  'orthodontics',
  'oral_surgery',
  'endodontics',
  'periodontics',
  'prosthodontics',
  'pediatric',
  'implantology',
  'cosmetic',
  'oral_medicine',
] as const;
export type DentalSpecialty = (typeof DENTAL_SPECIALTIES)[number];

/** Staff types that can hold specialties (and be the responsible doctor on an invoice). */
export const SPECIALTY_STAFF_TYPES = ['dentist', 'hygienist'] as const;

export const isDentalSpecialty = (v: unknown): v is DentalSpecialty => typeof v === 'string' && (DENTAL_SPECIALTIES as readonly string[]).includes(v);

const SYNONYMS: Record<DentalSpecialty, readonly string[]> = {
  general: ['general', 'general dentistry', 'general dentist', 'gp', 'طب الأسنان العام', 'طب اسنان عام', 'عام'],
  orthodontics: ['orthodontics', 'orthodontic', 'orthodontist', 'ortho', 'تقويم', 'تقويم الأسنان', 'تقويم الاسنان'],
  oral_surgery: ['oral_surgery', 'oral surgery', 'oral and maxillofacial surgery', 'oral & maxillofacial surgery', 'maxillofacial', 'جراحة الفم', 'جراحة الفم والوجه والفكين', 'جراحة الفم والفكين'],
  endodontics: ['endodontics', 'endodontic', 'endodontist', 'endo', 'root canal', 'علاج العصب', 'علاج الجذور', 'علاج جذور الأسنان', 'لب الأسنان'],
  periodontics: ['periodontics', 'periodontic', 'periodontist', 'perio', 'gum', 'أمراض اللثة', 'امراض اللثة', 'اللثة'],
  prosthodontics: ['prosthodontics', 'prosthodontic', 'prosthodontist', 'prostho', 'تركيبات', 'تركيبات الأسنان', 'التعويضات السنية'],
  pediatric: ['pediatric', 'pediatric dentistry', 'paediatric', 'paedodontics', 'pedodontics', 'pedo', 'أسنان الأطفال', 'طب أسنان الأطفال', 'اطفال'],
  implantology: ['implantology', 'implants', 'implant', 'زراعة', 'زراعة الأسنان', 'زراعة الاسنان'],
  cosmetic: ['cosmetic', 'aesthetic', 'cosmetic dentistry', 'aesthetic dentistry', 'تجميل', 'تجميل الأسنان', 'تجميل الاسنان'],
  oral_medicine: ['oral_medicine', 'oral medicine', 'oral medicine and radiology', 'oral radiology', 'radiology', 'طب الفم', 'أشعة الفم', 'طب الفم والأشعة'],
};

/** Maps an old free-text specialty to a code, or null when it can't be mapped safely. */
export function specialtyFromText(text: string | null | undefined): DentalSpecialty | null {
  const t = (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  for (const code of DENTAL_SPECIALTIES) if (SYNONYMS[code].includes(t)) return code;
  return null;
}
