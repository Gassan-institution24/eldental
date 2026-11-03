// SHARED FILE — synced to the frontend (src/shared/generated/patients.ts). Patient record rules used
// by both the API and the forms, so client and server validate the same way (16 §5).
import { z } from 'zod';
import { dateOnly, entityName, enumOf, freeText, instant, nullable, objectId, optional, requiredText } from './validation/fields';

/** Non-medical flags shown as chips in the patient header (03 §4). */
export const PATIENT_FLAGS = ['anxious', 'gag_reflex', 'wheelchair', 'hearing_impaired', 'interpreter', 'vip', 'payment_issue', 'often_late', 'other'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const REFERRAL_TYPES = ['patient', 'doctor', 'campaign', 'other'] as const;

/** ISO 3166-1 alpha-2; names come from Intl.DisplayNames in the UI language. */
export const countryCode = () =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z]{2}$/, { message: 'invalid_option' }));

export const heightCm = () =>
  z.coerce.number({ invalid_type_error: 'invalid_type' }).int({ message: 'invalid' }).min(30, { message: 'too_small' }).max(250, { message: 'too_big' });

export const weightKg = () =>
  z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .min(1, { message: 'too_small' })
    .max(400, { message: 'too_big' })
    .refine((v) => Math.round(v * 10) === v * 10, { message: 'too_many_decimals' });

/** The old paper file number; unique per clinic. */
export const legacyFileNumber = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z0-9٠-٩][A-Z0-9٠-٩/._-]{0,29}$/, { message: 'invalid_format' }),
  );

export const patientFlags = () =>
  z
    .array(z.object({ code: z.enum(PATIENT_FLAGS), note: optional(freeText(200)) }).strict())
    .max(PATIENT_FLAGS.length)
    .superRefine((list, ctx) => {
      const seen = new Set<string>();
      list.forEach((f, i) => {
        if (seen.has(f.code)) ctx.addIssue({ code: 'custom', path: [i, 'code'], message: 'duplicate' });
        seen.add(f.code);
        if (f.code === 'other' && !f.note) ctx.addIssue({ code: 'custom', path: [i, 'note'], message: 'required' });
      });
    });

/** Who referred the patient (a patient of the clinic, a doctor, a campaign…). */
export const referredBy = () =>
  z
    .object({
      type: z.enum(REFERRAL_TYPES),
      patientId: optional(objectId()),
      name: optional(entityName({ max: 120 })),
      note: optional(freeText(300)),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.type === 'patient' && !v.patientId) ctx.addIssue({ code: 'custom', path: ['patientId'], message: 'required' });
      if ((v.type === 'doctor' || v.type === 'campaign') && !v.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'required' });
      if (v.type === 'other' && !v.name && !v.note) ctx.addIssue({ code: 'custom', path: ['note'], message: 'required' });
    });

/** Body-mass index with one decimal, or undefined when height or weight is missing. */
export function bmiOf(heightCm?: number | null, weightKg?: number | null): number | undefined {
  if (!heightCm || !weightKg) return undefined;
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}

/* ---------- medical history (versioned; 03 §4, 07 §11) ---------- */

export const MEDICAL_CONDITIONS = [
  'heart_disease',
  'hypertension',
  'diabetes',
  'asthma',
  'epilepsy',
  'bleeding_disorder',
  'anticoagulants',
  'bisphosphonates',
  'hepatitis',
  'hiv',
  'kidney_disease',
  'thyroid',
  'cancer_treatment',
  'pregnancy',
  'smoker',
  'pacemaker',
] as const;
/** Conditions that raise a red alert banner on every clinical screen (07 §11). */
export const ALERT_CONDITIONS = ['heart_disease', 'bleeding_disorder', 'anticoagulants', 'bisphosphonates', 'pregnancy', 'diabetes', 'pacemaker', 'epilepsy'] as const;
export const SMOKING_LEVELS = ['none', 'former', 'light', 'heavy'] as const;
export const ALCOHOL_LEVELS = ['none', 'light', 'heavy'] as const;
export const MAX_MEDICATIONS = 30;
export const MAX_SURGERIES = 20;
export const ALLERGY_SEVERITIES = ['mild', 'moderate', 'severe'] as const;

/** A day of slack so a clinic ahead of UTC can still pick its own "today". */
const notFuture = (v: string) => v <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export const medicationItem = () =>
  z
    .object({
      name: entityName({ min: 1, max: 120 }),
      medicineId: optional(objectId()),
      dose: optional(freeText(60)),
      frequency: optional(freeText(60)),
      since: optional(dateOnly().refine(notFuture, { message: 'date_in_future' })),
    })
    .strict();

export const surgeryItem = () =>
  z
    .object({
      name: entityName({ min: 1, max: 120 }),
      year: optional(
        z.coerce
          .number({ invalid_type_error: 'invalid_type' })
          .int({ message: 'invalid' })
          .min(1900, { message: 'too_small' })
          .refine((y) => y <= new Date().getFullYear(), { message: 'date_in_future' }),
      ),
      note: optional(freeText(300)),
    })
    .strict();

export const allergyItem = () =>
  z
    .object({
      substance: z.string().trim().min(1, { message: 'required' }).max(80, { message: 'too_long' }),
      reaction: optional(freeText(120)),
      severity: enumOf([...ALLERGY_SEVERITIES]),
    })
    .strict();

export const pregnancyWeeks = () =>
  z.coerce.number({ invalid_type_error: 'invalid_type' }).int({ message: 'invalid' }).min(1, { message: 'too_small' }).max(42, { message: 'too_big' });

/** One version of the medical history; the same rules in the editor and the API. */
export const medicalHistoryBody = () =>
  z
    .object({
      conditions: z.array(z.enum(MEDICAL_CONDITIONS)).max(MEDICAL_CONDITIONS.length).default([]),
      medicationsList: z.array(medicationItem()).max(MAX_MEDICATIONS, { message: 'too_many' }).default([]),
      /** Free-text "other notes" about medicines, kept from the first version of the form. */
      medications: optional(freeText(1000)),
      surgeries: z.array(surgeryItem()).max(MAX_SURGERIES, { message: 'too_many' }).default([]),
      lifestyle: z
        .object({ smoking: optional(enumOf([...SMOKING_LEVELS])), alcohol: optional(enumOf([...ALCOHOL_LEVELS])) })
        .strict()
        .default({}),
      pregnancyWeeks: optional(pregnancyWeeks()),
      allergies: z.array(allergyItem()).max(20, { message: 'too_many' }).default([]),
      notes: optional(freeText(2000)),
      reviewed: z.boolean().default(false),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (v.pregnancyWeeks !== undefined && !v.conditions.includes('pregnancy'))
        ctx.addIssue({ code: 'custom', path: ['pregnancyWeeks'], message: 'pregnancy_required' });
    });

/* ---------- communication log (03 §4) ---------- */

export const COMM_CHANNELS = ['call', 'whatsapp', 'sms', 'email', 'in_person', 'other'] as const;
export const COMM_DIRECTIONS = ['in', 'out'] as const;
export const COMM_OUTCOMES = ['reached', 'no_answer', 'left_message', 'resolved', 'other'] as const;
/** The author may correct an entry for this long; after that it is part of the record. */
export const COMM_EDIT_WINDOW_MS = 24 * 3600_000;

const notAhead = (d: Date) => d.getTime() <= Date.now() + 5 * 60_000;
/** A follow-up can be today or later (a day of slack for clinics ahead of UTC). */
const notPastDay = (d: Date) => d.getTime() >= Date.now() - 86_400_000;

export const communicationBody = () =>
  z
    .object({
      at: optional(instant().refine(notAhead, { message: 'date_in_future' })),
      channel: enumOf([...COMM_CHANNELS]),
      direction: enumOf([...COMM_DIRECTIONS]),
      summary: requiredText(1000),
      outcome: enumOf([...COMM_OUTCOMES]),
      followUpAt: optional(instant().refine(notPastDay, { message: 'date_in_past' })),
    })
    .strict();

export const communicationPatch = () =>
  z
    .object({
      channel: optional(enumOf([...COMM_CHANNELS])),
      direction: optional(enumOf([...COMM_DIRECTIONS])),
      summary: optional(requiredText(1000)),
      outcome: optional(enumOf([...COMM_OUTCOMES])),
      followUpAt: nullable(instant().refine(notPastDay, { message: 'date_in_past' })),
      followUpDone: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0, { message: 'required' });

/* ---------- medical certificates (07 §14) ---------- */

export const CERTIFICATE_TYPES = ['sick_leave', 'medical_report', 'attendance'] as const;
export const CERTIFICATE_MAX_DAYS = 60;

/** Days covered, both ends included (`2026-05-01` → `2026-05-03` is 3 days). */
export function certificateDays(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export const certificateBody = () =>
  z
    .object({
      type: enumOf([...CERTIFICATE_TYPES]),
      appointmentId: optional(objectId()),
      from: dateOnly(),
      to: optional(dateOnly()),
      diagnosis: optional(freeText(300)),
      body: requiredText(3000),
      recommendations: optional(freeText(1000)),
    })
    .strict()
    .superRefine((v, ctx) => {
      if (!v.to) return;
      if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_invalid' });
      else if (certificateDays(v.from, v.to) > CERTIFICATE_MAX_DAYS)
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_too_long', params: { max: CERTIFICATE_MAX_DAYS } });
    });

export const certificateVoidBody = () => z.object({ reason: requiredText(300) }).strict();
