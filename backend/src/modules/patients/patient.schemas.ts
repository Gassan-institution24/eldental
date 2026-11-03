import { z } from 'zod';
import { pageQuery } from '@/shared/pagination';
import {
  ageOn,
  dateOfBirth,
  dateOnly,
  email,
  enumOf,
  freeText,
  money,
  nationalId,
  nullable,
  objectId,
  optional,
  passportNo,
  percent,
  personName,
  phone,
} from '@/shared/validation/fields';
import { ALERT_CONDITIONS as ALERT_LIST, BLOOD_TYPES, countryCode, medicalHistoryBody as medicalHistory, heightCm, legacyFileNumber, MARITAL_STATUSES, patientFlags, referredBy, weightKg } from '@/shared/patients';

const contact = z.object({ name: personName({ max: 120 }), relation: optional(freeText(40)), phone: phone() }).strict();

/** Shared by create and update; guardian required for under-18s (16 §5.3). */
const patientShape = {
  name: z
    .object({
      first: personName(),
      father: optional(personName()),
      grandfather: optional(personName()),
      family: personName(),
    })
    .strict(),
  gender: optional(enumOf(['male', 'female'])),
  dateOfBirth: optional(dateOfBirth()),
  nationalId: optional(nationalId()),
  passportNo: optional(passportNo()),
  phone: phone({ mobile: true }),
  altPhone: optional(phone()),
  email: optional(email()),
  address: z.object({ line1: optional(freeText(200)), city: optional(freeText(60)) }).strict().optional(),
  guardian: z.object({ patientId: optional(objectId()), name: personName({ max: 120 }), relation: freeText(40), phone: phone() }).strict().optional(),
  emergencyContact: contact.optional(),
  referralSource: optional(freeText(80)),
  referredBy: referredBy().optional(),
  nationality: optional(countryCode()),
  maritalStatus: optional(enumOf([...MARITAL_STATUSES])),
  occupation: optional(freeText(80)),
  bloodType: optional(enumOf([...BLOOD_TYPES])),
  heightCm: optional(heightCm()),
  weightKg: optional(weightKg()),
  legacyFileNumber: optional(legacyFileNumber()),
  flags: patientFlags().optional(),
  preferredDentistId: optional(objectId()),
  preferredLanguage: optional(enumOf(['ar', 'en'])),
  communicationPrefs: z.object({ whatsapp: z.boolean(), sms: z.boolean(), email: z.boolean(), marketing: z.boolean() }).partial().strict().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  notes: optional(freeText(2000)),
};

function guardianRule(v: { dateOfBirth?: string; guardian?: unknown }, ctx: z.RefinementCtx) {
  if (v.dateOfBirth && ageOn(v.dateOfBirth) < 18 && !v.guardian) {
    ctx.addIssue({ code: 'custom', path: ['guardian', 'name'], message: 'guardian_required' });
  }
}

export const patientCreateBody = z.object(patientShape).strict().superRefine(guardianRule);
export type PatientCreate = z.infer<typeof patientCreateBody>;

export const patientUpdateBody = z
  .object({
    ...Object.fromEntries(Object.entries(patientShape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])),
    phone: phone({ mobile: true }).optional(),
    nationalId: nullable(nationalId()),
    // Cleared with null on edit.
    referredBy: referredBy().nullable().optional(),
    nationality: nullable(countryCode()),
    maritalStatus: nullable(enumOf([...MARITAL_STATUSES])),
    bloodType: nullable(enumOf([...BLOOD_TYPES])),
    heightCm: nullable(heightCm()),
    weightKg: nullable(weightKg()),
    legacyFileNumber: nullable(legacyFileNumber()),
    status: enumOf(['active', 'inactive', 'deceased']).optional(),
    version: z.number().int().min(0),
  })
  .strict() as z.ZodType<Partial<PatientCreate> & { version: number; status?: 'active' | 'inactive' | 'deceased'; nationalId?: string | null }>;

export const patientListQuery = z
  .object({
    ...pageQuery,
    status: z.enum(['active', 'inactive', 'deceased', 'merged']).optional(),
    dentistId: objectId().optional(),
    tag: z.string().max(30).optional(),
  })
  .strict();
export type PatientListQuery = z.infer<typeof patientListQuery>;

export const searchQuery = z.object({ q: z.string().trim().min(1).max(60), limit: z.coerce.number().int().min(1).max(20).default(8) }).strict();
export const duplicateQuery = z.object({ phone: z.string().max(30).optional(), nationalId: z.string().max(20).optional(), legacyFileNumber: z.string().max(30).optional(), excludeId: objectId().optional() }).strict();
export const idParams = z.object({ id: objectId() });
/** Rows are validated one by one in the service, so one bad row doesn't reject the file. */
export const importBody = z
  .object({
    rows: z.array(z.record(z.unknown())).min(1, { message: 'too_few' }).max(2000, { message: 'too_many' }),
    dryRun: z.boolean().default(true),
    allowDuplicates: z.boolean().default(false),
  })
  .strict();
export const familyLinkBody = z.object({ patientId: objectId() }).strict();
export const mergeBody =z.object({ sourceId: objectId(), reason: freeText(500) }).strict();

export { MEDICAL_CONDITIONS } from '@/shared/patients';
/** Conditions that raise a red alert banner on every clinical screen (07 §11). */
export const ALERT_CONDITIONS: ReadonlySet<string> = new Set(ALERT_LIST);
export const medicalHistoryBody = medicalHistory();

export const policyBody = z
  .object({
    insuranceCompanyId: objectId(),
    planName: optional(freeText(80)),
    memberNumber: z.string().trim().min(1, { message: 'required' }).max(40, { message: 'too_long' }),
    relationToSubscriber: enumOf(['self', 'spouse', 'child', 'other']).default('self'),
    validFrom: optional(dateOnly()),
    validTo: optional(dateOnly()),
    coveragePercentOverride: optional(percent()),
    annualMax: optional(money()),
    isPrimary: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.validFrom && v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'range_invalid' });
  });
export const policyParams = z.object({ id: objectId(), policyId: objectId() });
export const fileParams = z.object({ id: objectId(), fileId: objectId() });
export const uploadMeta = z
  .object({
    category: z.enum(['xray', 'photo', 'document', 'consent', 'id', 'other']).default('document'),
    notes: optional(freeText(500)),
    toothNumbers: optional(z.string().regex(/^\d{2}(,\d{2})*$/)),
    takenAt: optional(dateOnly()),
  })
  .strict();
