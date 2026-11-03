import { COUNTRY_CODES } from '@/lib/countries';
import { toWesternDigits } from '@/shared/generated/validation/normalize';

/**
 * Columns the CSV import understands (Phase 3b slice 6). Each has its label key in
 * `patients:fields.*`, header synonyms in English and Arabic for auto-mapping, and a light
 * normaliser; real validation is the server's `patientCreateBody`, reported per row.
 */
const BOM_START = new RegExp(`^${String.fromCharCode(0xfeff)}`);

export type ImportField = { key: string; label: string; required?: boolean; synonyms: string[]; transform?: (v: string) => unknown };

const pick = (map: Record<string, string>) => {
  const norm = new Map(Object.entries(map).map(([k, v]) => [normalizeHeader(k), v]));
  return (v: string): string => norm.get(normalizeHeader(v)) ?? v.trim();
};

const gender = pick({ male: 'male', m: 'male', ذكر: 'male', female: 'female', f: 'female', انثى: 'female' });
const marital = pick({
  single: 'single',
  اعزب: 'single',
  عزباء: 'single',
  married: 'married',
  متزوج: 'married',
  متزوجه: 'married',
  divorced: 'divorced',
  مطلق: 'divorced',
  مطلقه: 'divorced',
  widowed: 'widowed',
  ارمل: 'widowed',
  ارمله: 'widowed',
});

/** `YYYY-MM-DD`, or `DD/MM/YYYY` / `D-M-YYYY` (as Jordanian spreadsheets write it). */
export function toIsoDate(raw: string): string {
  const v = toWesternDigits(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v;
}

/** An ISO code, or a country name in English or Arabic. */
function country(raw: string): string {
  const v = raw.trim();
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase();
  const wanted = normalizeHeader(v);
  for (const lang of ['en', 'ar']) {
    const names = new Intl.DisplayNames([lang], { type: 'region' });
    const hit = COUNTRY_CODES.find((c) => normalizeHeader(names.of(c) ?? '') === wanted);
    if (hit) return hit;
  }
  return v;
}

export const IMPORT_FIELDS: ImportField[] = [
  { key: 'name.first', label: 'fields.first', required: true, synonyms: ['first name', 'first', 'given name', 'name', 'الاسم الاول', 'الاسم', 'اسم'] },
  { key: 'name.father', label: 'fields.father', synonyms: ['father', 'father name', 'middle name', 'اسم الاب', 'الاب'] },
  { key: 'name.grandfather', label: 'fields.grandfather', synonyms: ['grandfather', 'grandfather name', 'اسم الجد', 'الجد'] },
  { key: 'name.family', label: 'fields.family', required: true, synonyms: ['family', 'family name', 'last name', 'surname', 'اسم العائله', 'العائله', 'الكنيه'] },
  { key: 'phone', label: 'fields.phone', required: true, synonyms: ['phone', 'mobile', 'phone number', 'mobile number', 'الهاتف', 'الموبايل', 'الجوال', 'رقم الهاتف', 'رقم الجوال', 'الخلوي'] },
  { key: 'altPhone', label: 'fields.altPhone', synonyms: ['other phone', 'alt phone', 'phone 2', 'second phone', 'هاتف اخر', 'هاتف بديل'] },
  { key: 'email', label: 'fields.email', synonyms: ['email', 'e mail', 'mail', 'البريد الالكتروني', 'البريد', 'الايميل'] },
  { key: 'gender', label: 'fields.gender', synonyms: ['gender', 'sex', 'الجنس'], transform: gender },
  { key: 'dateOfBirth', label: 'fields.dateOfBirth', synonyms: ['date of birth', 'dob', 'birth date', 'birthday', 'تاريخ الميلاد', 'الميلاد'], transform: toIsoDate },
  { key: 'nationalId', label: 'fields.nationalId', synonyms: ['national id', 'national number', 'id number', 'الرقم الوطني', 'رقم الهويه'], transform: (v) => toWesternDigits(v).trim() },
  { key: 'passportNo', label: 'fields.passportNo', synonyms: ['passport', 'passport no', 'passport number', 'رقم الجواز', 'جواز السفر'] },
  { key: 'nationality', label: 'fields.nationality', synonyms: ['nationality', 'country', 'الجنسيه'], transform: country },
  { key: 'address.line1', label: 'fields.addressLine1', synonyms: ['address', 'street', 'العنوان'] },
  { key: 'address.city', label: 'fields.city', synonyms: ['city', 'town', 'المدينه'] },
  { key: 'legacyFileNumber', label: 'fields.legacyFileNumber', synonyms: ['old file number', 'file number', 'file no', 'legacy file number', 'paper file', 'رقم الملف', 'رقم الملف القديم'] },
  { key: 'bloodType', label: 'fields.bloodType', synonyms: ['blood type', 'blood group', 'فصيله الدم', 'زمره الدم'], transform: (v) => v.replace(/\s+/g, '').toUpperCase() },
  { key: 'occupation', label: 'fields.occupation', synonyms: ['occupation', 'job', 'profession', 'المهنه', 'العمل', 'الوظيفه'] },
  { key: 'maritalStatus', label: 'fields.maritalStatus', synonyms: ['marital status', 'الحاله الاجتماعيه'], transform: marital },
  { key: 'referralSource', label: 'fields.referralSource', synonyms: ['referral source', 'source', 'how did you hear', 'كيف عرفت بنا', 'مصدر الاحاله'] },
  {
    key: 'tags',
    label: 'fields.tags',
    synonyms: ['tags', 'labels', 'الوسوم', 'التصنيفات'],
    transform: (v) =>
      v
        .split(/[;,،|]/)
        .map((x) => x.trim())
        .filter(Boolean),
  },
  { key: 'notes', label: 'fields.notes', synonyms: ['notes', 'note', 'remarks', 'comments', 'ملاحظات', 'الملاحظات'] },
];

export const FIELD_BY_KEY = new Map(IMPORT_FIELDS.map((f) => [f.key, f]));

/** Case, spacing, punctuation and Arabic letter variants don't matter when matching headers. */
export function normalizeHeader(h: string): string {
  return h
    .replace(BOM_START, '')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْ]/g, '')
    .replace(/[_\-.:()/#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** For each CSV column the field it fills, or '' (ignored). Each field is used at most once. */
export function autoMap(headers: string[], labelOf: (labelKey: string) => string[]): string[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const n = normalizeHeader(h);
    const f = IMPORT_FIELDS.find(
      (x) => !used.has(x.key) && (normalizeHeader(x.key) === n || x.synonyms.some((s) => normalizeHeader(s) === n) || labelOf(x.label).some((l) => normalizeHeader(l) === n)),
    );
    if (!f) return '';
    used.add(f.key);
    return f.key;
  });
}

/** Turns CSV lines into API rows (nested objects); empty cells are left out. */
export function buildRows(lines: string[][], mapping: string[]): Record<string, unknown>[] {
  return lines.map((cells) => {
    const out: Record<string, unknown> = {};
    mapping.forEach((key, i) => {
      if (!key) return;
      const raw = (cells[i] ?? '').trim();
      if (!raw) return;
      const f = FIELD_BY_KEY.get(key);
      const value = f?.transform ? f.transform(raw) : raw;
      if (Array.isArray(value) && !value.length) return;
      const [head, tail] = key.split('.') as [string, string | undefined];
      if (tail) out[head] = { ...((out[head] as Record<string, unknown>) ?? {}), [tail]: value };
      else out[head] = value;
    });
    return out;
  });
}
