// SHARED FILE — synced to the frontend (src/shared/generated/patients.ts). Patient record rules used
// by both the API and the forms, so client and server validate the same way (16 §5).
import { z } from 'zod';
import { entityName, freeText, objectId, optional } from './validation/fields';

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
