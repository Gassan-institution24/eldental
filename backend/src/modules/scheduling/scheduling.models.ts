import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { applyBase } from '@/core/db/plugins';
import { tenantField } from '@/core/tenancy/tenantPlugin';

const blockSchema = new Schema(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
    chairId: { type: Schema.Types.ObjectId, ref: 'Chair' },
    appointmentTypeIds: { type: [Schema.Types.ObjectId], default: undefined },
    onlineBookable: { type: Boolean, default: true },
  },
  { _id: false },
);

/** Recurring weekly template per dentist (03 §5). */
const dentistScheduleSchema = new Schema(
  {
    clinicId: tenantField,
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    effectiveFrom: { type: String, required: true },
    effectiveTo: String,
    slotGranularityMin: { type: Number, default: 15 },
    weekly: { type: [{ weekday: Number, blocks: [blockSchema], _id: false }], default: [] },
  },
  { timestamps: true, collection: 'dentistSchedules' },
);
applyBase(dentistScheduleSchema);
dentistScheduleSchema.index({ clinicId: 1, staffId: 1, effectiveFrom: 1 });
export type DentistSchedule = InferSchemaType<typeof dentistScheduleSchema>;
export const DentistScheduleModel = model('DentistSchedule', dentistScheduleSchema);

const exceptionSchema = new Schema(
  {
    clinicId: tenantField,
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    chairId: { type: Schema.Types.ObjectId, ref: 'Chair' },
    type: { type: String, enum: ['time_off', 'extra_hours', 'holiday', 'chair_maintenance'], required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    reason: { type: String, default: '' },
    leaveRequestId: { type: Schema.Types.ObjectId, ref: 'LeaveRequest' },
  },
  { timestamps: true, collection: 'scheduleExceptions' },
);
applyBase(exceptionSchema);
exceptionSchema.index({ clinicId: 1, start: 1, end: 1 });
export const ScheduleExceptionModel = model('ScheduleException', exceptionSchema);

export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Appointments (03 §5). `dentistId` replaces Hakeemna work groups. */
const appointmentSchema = new Schema(
  {
    clinicId: tenantField,
    number: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    dentistId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    chairId: { type: Schema.Types.ObjectId, ref: 'Chair' },
    assistantIds: { type: [Schema.Types.ObjectId], default: [] },
    appointmentTypeId: { type: Schema.Types.ObjectId, ref: 'AppointmentType' },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'scheduled' },
    statusHistory: { type: [{ from: String, to: String, at: Date, byUserId: Schema.Types.ObjectId, reason: String, _id: false }], default: [] },
    source: { type: String, enum: ['staff', 'online', 'walk_in', 'recall'], default: 'staff' },
    priority: { type: String, enum: ['normal', 'emergency'], default: 'normal' },
    overbooked: { type: Boolean, default: false },
    plannedItems: { type: [{ treatmentPlanItemId: Schema.Types.ObjectId, procedureId: Schema.Types.ObjectId, toothNumbers: [Number], surfaces: [String], _id: false }], default: [] },
    notes: { type: String, default: '' },
    patientNotes: { type: String, default: '' },
    cancellation: { reason: String, comment: String, byUserId: Schema.Types.ObjectId, at: Date, lateCancel: Boolean },
    rescheduledFromId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    reminders: { sent24hAt: Date, sent2hAt: Date, confirmationRequestedAt: Date },
    checkInAt: Date,
    seatedAt: Date,
    completedAt: Date,
    noProceduresReason: String,
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    recallId: { type: Schema.Types.ObjectId, ref: 'Recall' },
    waitlistId: { type: Schema.Types.ObjectId, ref: 'WaitingListEntry' },
  },
  { timestamps: true, collection: 'appointments', optimisticConcurrency: true },
);
applyBase(appointmentSchema);
appointmentSchema.index({ clinicId: 1, dentistId: 1, start: 1 });
appointmentSchema.index({ clinicId: 1, chairId: 1, start: 1 });
appointmentSchema.index({ clinicId: 1, patientId: 1, start: -1 });
appointmentSchema.index({ clinicId: 1, status: 1, start: 1 });
appointmentSchema.index({ clinicId: 1, start: 1, end: 1 });
export type Appointment = InferSchemaType<typeof appointmentSchema>;
export type AppointmentDoc = HydratedDocument<Appointment>;
export const AppointmentModel = model('Appointment', appointmentSchema);

/**
 * One row per 5-minute bucket per resource. The unique index makes a concurrent booking of
 * the same time fail with a duplicate key → 409 APPOINTMENT_SLOT_TAKEN (06 §3).
 */
const slotLockSchema = new Schema(
  {
    clinicId: tenantField,
    resourceType: { type: String, enum: ['dentist', 'chair'], required: true },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    bucketStart: { type: Date, required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },
  },
  { collection: 'slotLocks', versionKey: false },
);
slotLockSchema.index({ clinicId: 1, resourceType: 1, resourceId: 1, bucketStart: 1 }, { unique: true });
slotLockSchema.index({ appointmentId: 1 });
export const SlotLockModel = model('SlotLock', slotLockSchema);

const waitingListSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    dentistId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    appointmentTypeId: { type: Schema.Types.ObjectId, ref: 'AppointmentType' },
    preferredDays: { type: [Number], default: [] },
    preferredTimeRange: { from: String, to: String },
    notes: { type: String, default: '' },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
    status: { type: String, enum: ['waiting', 'offered', 'booked', 'removed'], default: 'waiting' },
    offeredAt: Date,
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
  },
  { timestamps: true, collection: 'waitingList' },
);
applyBase(waitingListSchema);
waitingListSchema.index({ clinicId: 1, status: 1, createdAt: 1 });
export const WaitingListModel = model('WaitingListEntry', waitingListSchema);

const recallSchema = new Schema(
  {
    clinicId: tenantField,
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true },
    type: { type: String, enum: ['cleaning', 'checkup', 'ortho_adjustment', 'custom'], required: true },
    dueDate: { type: String, required: true },
    intervalMonths: { type: Number, default: 6 },
    dentistId: { type: Schema.Types.ObjectId, ref: 'Staff' },
    status: { type: String, enum: ['upcoming', 'due', 'contacted', 'booked', 'dismissed'], default: 'upcoming' },
    lastContactAt: Date,
    contactCount: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
  },
  { timestamps: true, collection: 'recalls' },
);
applyBase(recallSchema);
recallSchema.index({ clinicId: 1, status: 1, dueDate: 1 });
recallSchema.index({ clinicId: 1, patientId: 1, type: 1 });
export const RecallModel = model('Recall', recallSchema);
