import { z } from 'zod';
import { dateOnly, enumOf, freeText, instant, objectId, optional, timeOfDay, toothNumber, surfaces } from '@/shared/validation/fields';
import { minutesOf } from '@/shared/dates';
import { DENTAL_SPECIALTIES } from '@/shared/dental/specialties';
import { APPOINTMENT_STATUSES } from './scheduling.models';

export const idParams = z.object({ id: objectId() }).strict();
export const staffParams = z.object({ staffId: objectId() }).strict();

const boolString = z.enum(['true', 'false']).transform((v) => v === 'true');
const csv = <T extends z.ZodTypeAny>(item: T) => z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item));
const duration = z.coerce.number().int().min(5, { message: 'too_small' }).max(480, { message: 'too_big' });

function maxRange(max: number) {
  return (v: { from: string; to: string }, ctx: z.RefinementCtx) => {
    if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_invalid' });
    else if ((Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 > max) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_too_long', params: { max } });
  };
}

export const availabilityQuery = z
  .object({
    from: dateOnly(),
    to: dateOnly(),
    dentistId: optional(objectId()),
    chairId: optional(objectId()),
    appointmentTypeId: optional(objectId()),
    durationMin: duration.optional(),
    // Guides patients to the right doctor; it never limits who may treat (07 §13).
    specialty: enumOf([...DENTAL_SPECIALTIES]).optional(),
  })
  .strict()
  .superRefine(maxRange(42));

export const listQuery = z
  .object({
    from: dateOnly(),
    to: dateOnly(),
    dentistId: optional(objectId()),
    chairId: optional(objectId()),
    patientId: optional(objectId()),
    status: csv(z.enum(APPOINTMENT_STATUSES)).optional(),
    includeCancelled: boolString.optional(),
  })
  .strict()
  .superRefine(maxRange(62));

const plannedItem = z
  .object({ treatmentPlanItemId: optional(objectId()), procedureId: optional(objectId()), toothNumbers: z.array(toothNumber()).max(32).optional(), surfaces: surfaces().optional() })
  .strict();

export const bookBody = z
  .object({
    patientId: objectId(),
    dentistId: objectId(),
    chairId: optional(objectId()),
    appointmentTypeId: optional(objectId()),
    start: instant(),
    durationMin: duration.optional(),
    assistantIds: z.array(objectId()).max(5).optional(),
    plannedItems: z.array(plannedItem).max(30).optional(),
    notes: optional(freeText(1000)),
    patientNotes: optional(freeText(500)),
    source: enumOf(['staff', 'walk_in', 'recall']).optional(),
    priority: enumOf(['normal', 'emergency']).optional(),
    override: z.boolean().optional(),
    allowOverlap: z.boolean().optional(),
    recallId: optional(objectId()),
    waitlistId: optional(objectId()),
  })
  .strict();
export type BookBody = z.infer<typeof bookBody>;

export const updateBody = z
  .object({
    version: z.number().int().min(0).optional(),
    dentistId: optional(objectId()),
    chairId: objectId().nullable().optional(),
    appointmentTypeId: optional(objectId()),
    start: instant().optional(),
    durationMin: duration.optional(),
    assistantIds: z.array(objectId()).max(5).optional(),
    plannedItems: z.array(plannedItem).max(30).optional(),
    notes: optional(freeText(1000)),
    patientNotes: optional(freeText(500)),
    priority: enumOf(['normal', 'emergency']).optional(),
    override: z.boolean().optional(),
    allowOverlap: z.boolean().optional(),
  })
  .strict();

export const CANCEL_REASONS = ['patient_request', 'patient_sick', 'clinic_closed', 'dentist_unavailable', 'rescheduled', 'other'] as const;

export const statusBody = z
  .object({
    to: z.enum(APPOINTMENT_STATUSES),
    reason: optional(freeText(300)),
    comment: optional(freeText(500)),
    noProcedures: z.boolean().optional(),
    version: z.number().int().min(0).optional(),
  })
  .strict();

export const cancelBody = z
  .object({ reason: z.enum(CANCEL_REASONS, { message: 'required' }), comment: optional(freeText(500)), version: z.number().int().min(0).optional() })
  .strict();

export const bulkShiftBody = z
  .object({ ids: z.array(objectId()).min(1).max(100), minutes: z.number().int().min(-240).max(240).refine((v) => v !== 0, { message: 'required' }) })
  .strict();

export const boardQuery = z.object({ date: optional(dateOnly()) }).strict();

/* ---------- schedules ---------- */

const block = z
  .object({
    start: timeOfDay(),
    end: timeOfDay(),
    chairId: optional(objectId()),
    appointmentTypeIds: z.array(objectId()).max(30).optional(),
    onlineBookable: z.boolean().default(true),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (minutesOf(b.end) <= minutesOf(b.start)) ctx.addIssue({ code: 'custom', path: ['end'], message: 'end_before_start' });
  });

export const scheduleBody = z
  .object({
    effectiveFrom: dateOnly(),
    effectiveTo: optional(dateOnly()),
    slotGranularityMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)]).default(15),
    weekly: z.array(z.object({ weekday: z.number().int().min(0).max(6), blocks: z.array(block).max(8) }).strict()).max(7),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (s.effectiveTo && s.effectiveTo < s.effectiveFrom) ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'range_invalid' });
    const seen = new Set<number>();
    s.weekly.forEach((w, wi) => {
      if (seen.has(w.weekday)) ctx.addIssue({ code: 'custom', path: ['weekly', wi, 'weekday'], message: 'duplicate' });
      seen.add(w.weekday);
      const sorted = [...w.blocks].map((b, bi) => ({ ...b, bi })).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
      for (let i = 1; i < sorted.length; i += 1) {
        if (minutesOf(sorted[i]!.start) < minutesOf(sorted[i - 1]!.end)) ctx.addIssue({ code: 'custom', path: ['weekly', wi, 'blocks', sorted[i]!.bi, 'start'], message: 'overlap' });
      }
    });
  });
export type ScheduleBody = z.infer<typeof scheduleBody>;

export const EXCEPTION_TYPES = ['time_off', 'extra_hours', 'holiday', 'chair_maintenance'] as const;
const exceptionShape = {
  staffId: optional(objectId()),
  chairId: optional(objectId()),
  type: z.enum(EXCEPTION_TYPES),
  start: instant(),
  end: instant(),
  reason: optional(freeText(300)),
};
const exceptionRules = (v: { type?: string; staffId?: string | null; chairId?: string | null; start?: Date; end?: Date }, ctx: z.RefinementCtx) => {
  if (v.start && v.end && v.end <= v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'end_before_start' });
  if ((v.type === 'time_off' || v.type === 'extra_hours') && !v.staffId) ctx.addIssue({ code: 'custom', path: ['staffId'], message: 'required' });
  if (v.type === 'chair_maintenance' && !v.chairId) ctx.addIssue({ code: 'custom', path: ['chairId'], message: 'required' });
};
export const exceptionBody = z.object(exceptionShape).strict().superRefine(exceptionRules);
export const exceptionUpdateBody = z
  .object({
    staffId: objectId().nullable().optional(),
    chairId: objectId().nullable().optional(),
    type: z.enum(EXCEPTION_TYPES).optional(),
    start: instant().optional(),
    end: instant().optional(),
    reason: optional(freeText(300)),
    version: z.number().int().min(0),
  })
  .strict()
  .superRefine(exceptionRules);
export const exceptionQuery = z.object({ from: dateOnly(), to: dateOnly(), staffId: optional(objectId()) }).strict().superRefine(maxRange(400));

/* ---------- waiting list & recalls ---------- */

export const waitlistBody = z
  .object({
    patientId: objectId(),
    dentistId: optional(objectId()),
    appointmentTypeId: optional(objectId()),
    preferredDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    preferredTimeRange: z.object({ from: timeOfDay(), to: timeOfDay() }).strict().optional(),
    notes: optional(freeText(500)),
    priority: enumOf(['low', 'normal', 'high', 'urgent']).default('normal'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.preferredTimeRange && minutesOf(v.preferredTimeRange.to) <= minutesOf(v.preferredTimeRange.from)) {
      ctx.addIssue({ code: 'custom', path: ['preferredTimeRange', 'to'], message: 'end_before_start' });
    }
  });
export const waitlistUpdateBody = z
  .object({
    dentistId: objectId().nullable().optional(),
    appointmentTypeId: objectId().nullable().optional(),
    preferredDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    preferredTimeRange: z.object({ from: timeOfDay(), to: timeOfDay() }).strict().nullable().optional(),
    notes: optional(freeText(500)),
    priority: enumOf(['low', 'normal', 'high', 'urgent']).optional(),
    status: enumOf(['waiting', 'offered', 'removed']).optional(),
  })
  .strict();
export const waitlistQuery = z.object({ status: enumOf(['waiting', 'offered', 'booked', 'removed']).optional(), dentistId: optional(objectId()) }).strict();

export const RECALL_TYPES = ['cleaning', 'checkup', 'ortho_adjustment', 'custom'] as const;
export const recallBody = z
  .object({
    patientId: objectId(),
    type: z.enum(RECALL_TYPES),
    dueDate: dateOnly(),
    intervalMonths: z.number().int().min(1).max(36).default(6),
    dentistId: optional(objectId()),
    notes: optional(freeText(500)),
  })
  .strict();
export const recallUpdateBody = z
  .object({
    dueDate: optional(dateOnly()),
    intervalMonths: z.number().int().min(1).max(36).optional(),
    dentistId: objectId().nullable().optional(),
    notes: optional(freeText(500)),
    status: enumOf(['upcoming', 'due', 'contacted', 'dismissed']).optional(),
    contacted: z.boolean().optional(),
  })
  .strict();
export const recallQuery = z
  .object({ bucket: enumOf(['overdue', 'due', 'upcoming', 'contacted', 'booked', 'dismissed', 'all']).default('due'), dentistId: optional(objectId()), q: optional(z.string().trim().max(60)) })
  .strict();
