import { z } from 'zod';
import { dateOfBirth, dateOnly, email, enumOf, freeText, objectId, optional, otpCode, personName, slug as slugField } from '@/shared/validation/fields';

/** Patient portal request bodies (01 §4.10). Same field rules as the clinic side. */

const slug = slugField();
const fileNumber = z.string().trim().toUpperCase().min(1, { message: 'required' }).max(20, { message: 'too_long' });

export const slugParams = z.object({ slug });
export const idParams = z.object({ id: objectId() });

export const meUpdateBody = z
  .object({
    displayName: optional(freeText(120)),
    email: optional(email()),
    locale: optional(enumOf(['ar', 'en'])),
  })
  .strict();

export const availabilityQuery = z
  .object({
    appointmentTypeId: objectId(),
    dentistId: optional(objectId()),
    from: dateOnly(),
    to: dateOnly(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_invalid' });
    if (Date.parse(v.to) - Date.parse(v.from) > 14 * 86_400_000) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_too_long' });
  });

export const linkStartBody = z.object({ clinicSlug: slug, fileNumber }).strict();
export const linkConfirmBody = z.object({ clinicSlug: slug, fileNumber, code: otpCode() }).strict();

export const dependantBody = z
  .object({
    guardianPatientId: objectId(),
    first: personName(),
    family: personName(),
    dateOfBirth: dateOfBirth(),
    gender: enumOf(['male', 'female']),
  })
  .strict();

export const bookBody = z
  .object({
    clinicSlug: slug,
    patientId: optional(objectId()),
    appointmentTypeId: objectId(),
    dentistId: objectId(),
    start: z.coerce.date(),
    notes: optional(freeText(500)),
  })
  .strict();

export const cancelBody = z.object({ comment: optional(freeText(300)) }).strict();

export const acceptBody = z
  .object({
    itemIds: z.array(objectId()).max(100).optional(),
    signature: z.string().max(400_000).regex(/^data:image\/png;base64,/, { message: 'required' }),
    signerName: personName({ max: 120 }),
  })
  .strict();
