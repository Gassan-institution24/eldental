import { z } from 'zod';
import { dateOnly, entityName, enumOf, freeText, instant, money, objectId, optional, requiredText, surfaces, toothNumber } from '@/shared/validation/fields';
import { LAB_STATUSES } from './clinical.models';

export const idParams = z.object({ id: objectId() }).strict();
export const patientParams = z.object({ patientId: objectId() }).strict();
export const entryParams = z.object({ patientId: objectId(), entryId: objectId() }).strict();
const version = z.number().int().min(0).optional();
const qty = z.number().int().min(1, { message: 'too_small' }).max(32, { message: 'too_big' });

/* ---------- chart ---------- */

export const entryBody = z
  .object({
    toothNumber: toothNumber(),
    surfaces: surfaces().default([]),
    kind: z.enum(['existing', 'finding']),
    conditionCode: optional(z.string().trim().max(40)),
    setStatus: enumOf(['present', 'missing', 'implant', 'unerupted']).optional(),
    notes: optional(freeText(500)),
  })
  .strict()
  .refine((v) => v.conditionCode || v.setStatus, { path: ['conditionCode'], message: 'required' });

export const voidBody = z.object({ reason: requiredText(300) }).strict();
export const dentitionBody = z.object({ dentition: z.enum(['permanent', 'primary', 'mixed']) }).strict();

/* ---------- plans ---------- */

const planItem = z
  .object({
    id: optional(objectId()),
    phaseIndex: z.number().int().min(0).max(9).default(0),
    clinicProcedureId: objectId(),
    toothNumbers: z.array(toothNumber()).max(32).default([]),
    surfaces: surfaces().default([]),
    quantity: qty.optional(),
    unitPrice: money().optional(),
    discount: money().optional(),
    notes: optional(freeText(300)),
  })
  .strict();

const phase = z.object({ name: z.string().trim().min(1, { message: 'required' }).max(40), order: z.number().int().min(0).max(9) }).strict();

export const planBody = z
  .object({
    patientId: objectId(),
    title: optional(freeText(120)),
    dentistId: optional(objectId()),
    phases: z.array(phase).max(6).optional(),
    items: z.array(planItem).max(80),
    insurancePolicyId: objectId().nullable().optional(),
    validUntil: optional(dateOnly()),
    notes: optional(freeText(2000)),
    alternativeOf: optional(objectId()),
    alternativeLabel: optional(freeText(60)),
  })
  .strict();

export const planUpdateBody = z
  .object({
    version,
    title: optional(freeText(120)),
    phases: z.array(phase).max(6).optional(),
    items: z.array(planItem).max(80).optional(),
    insurancePolicyId: objectId().nullable().optional(),
    validUntil: optional(dateOnly()),
    notes: optional(freeText(2000)),
    alternativeLabel: optional(freeText(60)),
  })
  .strict();

export const presentBody = z.object({ validUntil: optional(dateOnly()) }).strict();
export const acceptBody = z
  .object({
    itemIds: z.array(objectId()).max(80).optional(),
    signature: z.string().max(900_000).regex(/^data:image\/png;base64,/, { message: 'required' }),
    signerName: optional(freeText(120)),
    byPatient: z.boolean().default(true),
  })
  .strict();
export const planStatusBody = z.object({ to: z.enum(['rejected', 'cancelled', 'draft']), reason: optional(freeText(300)) }).strict();

/* ---------- performed procedures ---------- */

export const performBody = z
  .object({
    patientId: objectId(),
    appointmentId: optional(objectId()),
    treatmentPlanItemId: optional(objectId()),
    clinicProcedureId: objectId(),
    toothNumbers: z.array(toothNumber()).max(32).optional(),
    surfaces: surfaces().optional(),
    dentistId: optional(objectId()),
    assistantIds: z.array(objectId()).max(5).optional(),
    quantity: qty.optional(),
    unitPrice: money().optional(),
    discount: money().optional(),
    notes: optional(freeText(1000)),
    performedAt: instant().optional(),
  })
  .strict();
export const procedureQuery = z.object({ patientId: optional(objectId()), appointmentId: optional(objectId()) }).strict();

/* ---------- notes ---------- */

const soap = z
  .object({ subjective: optional(freeText(5000)), objective: optional(freeText(5000)), assessment: optional(freeText(5000)), plan: optional(freeText(5000)) })
  .strict();

export const noteBody = z
  .object({
    patientId: objectId(),
    appointmentId: optional(objectId()),
    templateId: optional(objectId()),
    format: z.enum(['soap', 'free']).default('soap'),
    content: soap.optional(),
    text: optional(freeText(10000)),
    toothNumbers: z.array(toothNumber()).max(32).optional(),
  })
  .strict()
  .refine((v) => (v.format === 'free' ? Boolean(v.text) : Object.values(v.content ?? {}).some(Boolean)), { path: ['text'], message: 'required' });

export const noteUpdateBody = z
  .object({ version, content: soap.optional(), text: optional(freeText(10000)), toothNumbers: z.array(toothNumber()).max(32).optional() })
  .strict();

export const templateBody = z
  .object({
    name: entityName({ max: 80 }),
    format: z.enum(['soap', 'free']).default('soap'),
    content: soap.optional(),
    text: optional(freeText(10000)),
    appointmentTypeIds: z.array(objectId()).max(20).default([]),
    isActive: z.boolean().default(true),
  })
  .strict();

/* ---------- perio ---------- */

const six = <T extends z.ZodTypeAny>(t: T) => z.array(t).length(6);
const mm = z.number().int().min(0, { message: 'out_of_range' }).max(20, { message: 'out_of_range' });
const perioTooth = z
  .object({
    pocketDepth: six(mm),
    recession: six(z.number().int().min(-5, { message: 'out_of_range' }).max(20, { message: 'out_of_range' })),
    bleeding: six(z.boolean()),
    suppuration: six(z.boolean()),
    plaque: six(z.boolean()).optional(),
    mobility: z.number().int().min(0).max(3).default(0),
    furcation: z.number().int().min(0).max(3).default(0),
    missing: z.boolean().default(false),
  })
  .strict();
export const perioBody = z
  .object({ patientId: objectId(), examDate: dateOnly(), teeth: z.record(z.string().regex(/^\d{2}$/), perioTooth), notes: optional(freeText(2000)) })
  .strict();
export const perioUpdateBody = z.object({ version, examDate: optional(dateOnly()), teeth: z.record(z.string().regex(/^\d{2}$/), perioTooth).optional(), notes: optional(freeText(2000)) }).strict();

/* ---------- prescriptions ---------- */

const rxItem = z
  .object({
    medicineId: optional(objectId()),
    name: requiredText(120),
    dose: optional(freeText(60)),
    route: optional(freeText(40)),
    frequency: optional(freeText(80)),
    durationDays: z.number().int().min(1, { message: 'too_small' }).max(365, { message: 'too_big' }).optional(),
    instructions: optional(freeText(300)),
  })
  .strict();
export const prescriptionBody = z
  .object({ patientId: objectId(), appointmentId: optional(objectId()), items: z.array(rxItem).min(1, { message: 'too_few' }).max(15), notes: optional(freeText(1000)) })
  .strict();

/* ---------- lab orders ---------- */

export const LAB_ITEM_TYPES = ['crown', 'bridge', 'denture', 'veneer', 'aligner', 'night_guard', 'implant_crown', 'other'] as const;
const labItem = z
  .object({ type: z.enum(LAB_ITEM_TYPES), toothNumbers: z.array(toothNumber()).max(32).default([]), material: optional(freeText(60)), shade: optional(freeText(20)), notes: optional(freeText(300)) })
  .strict();
export const labOrderBody = z
  .object({
    patientId: objectId(),
    labSupplierId: optional(objectId()),
    labName: requiredText(120),
    treatmentPlanId: optional(objectId()),
    items: z.array(labItem).min(1, { message: 'too_few' }).max(20),
    dueDate: optional(dateOnly()),
    notes: optional(freeText(1000)),
  })
  .strict();
export const labOrderUpdateBody = z
  .object({ version, labName: optional(freeText(120)), items: z.array(labItem).min(1).max(20).optional(), dueDate: optional(dateOnly()), notes: optional(freeText(1000)), cost: money().optional() })
  .strict();
export const labStatusBody = z.object({ to: z.enum(LAB_STATUSES), reason: optional(freeText(300)), cost: money().optional() }).strict();
export const labListQuery = z.object({ status: z.enum(LAB_STATUSES).optional(), patientId: optional(objectId()), open: z.enum(['true', 'false']).optional() }).strict();

/* ---------- consents ---------- */

export const consentTemplateBody = z
  .object({ title: entityName({ max: 120 }), body: requiredText(20000), procedureCategories: z.array(z.string().max(30)).max(11).default([]), isActive: z.boolean().default(true) })
  .strict();
export const consentBody = z
  .object({
    patientId: objectId(),
    templateId: objectId(),
    appointmentId: optional(objectId()),
    values: z.record(z.string().max(30), z.string().max(300)).default({}),
    signature: z.string().max(900_000).regex(/^data:image\/png;base64,/, { message: 'required' }),
    signerName: optional(freeText(120)),
    witnessStaffId: optional(objectId()),
  })
  .strict();
