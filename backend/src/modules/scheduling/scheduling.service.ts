import { Types, type ClientSession } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { onCommit, withTransaction } from '@/core/db/transaction';
import { emit } from '@/core/events/bus';
import { ApiError } from '@/core/http/ApiError';
import { fieldPolicyOf, scopeFor } from '@/core/rbac/authorize';
import { applyFieldPolicy, assertWritable } from '@/core/rbac/fieldPolicy';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ChairModel, AppointmentTypeModel } from '@/modules/clinic/clinic.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, localDate, localTime, minutesOf, startOfLocalDay } from '@/shared/dates';
import { computeSlots, isWithinAvailability, type EngineInput } from './availability.engine';
import { ACTIVE_STATUSES, canTransition, displayStatus } from './appointment.state';
import { AppointmentModel, DentistScheduleModel, ScheduleExceptionModel, SlotLockModel, type Appointment, type AppointmentStatus } from './scheduling.models';

const RESOURCE = 'scheduling.appointment';
const BUCKET_MIN = 5;
const MIN = 60_000;
export const BOOKABLE_TYPES = ['dentist', 'hygienist'] as const;

/* ---------- clinic + data gathering ---------- */

export async function loadClinic() {
  const id = currentClinicId();
  const clinic = await runWithoutTenant(() => ClinicModel.findById(id).select('name timezone workingHours settings').lean());
  if (!clinic) throw ApiError.notFound();
  return clinic;
}
type ClinicLean = Awaited<ReturnType<typeof loadClinic>>;

type EngineQuery = { from: string; to: string; dentistId?: string; specialty?: string; chairId?: string; appointmentTypeId?: string; durationMin?: number; online?: boolean; excludeAppointmentId?: string };

/** Collects schedules, exceptions and busy time for the engine (06 §2). */
export async function engineInput(clinic: ClinicLean, q: EngineQuery): Promise<EngineInput> {
  const tz = clinic.timezone ?? 'Asia/Amman';
  const type = q.appointmentTypeId ? await AppointmentTypeModel.findById(q.appointmentTypeId).lean() : null;
  if (q.appointmentTypeId && !type) throw ApiError.validation([{ path: 'appointmentTypeId', code: 'not_found' }]);
  const duration = q.durationMin ?? type?.defaultDurationMin ?? clinic.settings?.defaultAppointmentMinutes ?? 30;
  const rangeStart = startOfLocalDay(q.from, tz);
  const rangeEnd = startOfLocalDay(addDays(q.to, 1), tz);

  const dentists = await StaffModel.find({ status: 'active', staffType: { $in: BOOKABLE_TYPES }, ...(q.dentistId ? { _id: q.dentistId } : {}), ...(q.specialty ? { specialties: q.specialty } : {}) })
    .select('bookableOnline')
    .lean();
  const ids = dentists.map((d) => d._id);
  const [schedules, exceptions, appts] = await Promise.all([
    DentistScheduleModel.find({ staffId: { $in: ids } }).sort({ effectiveFrom: -1 }).lean(),
    ScheduleExceptionModel.find({ start: { $lt: rangeEnd }, end: { $gt: rangeStart } }).lean(),
    AppointmentModel.find({
      start: { $lt: new Date(rangeEnd.getTime() + 4 * 3_600_000) },
      end: { $gt: new Date(rangeStart.getTime() - 4 * 3_600_000) },
      status: { $in: ACTIVE_STATUSES },
      ...(q.excludeAppointmentId ? { _id: { $ne: new Types.ObjectId(q.excludeAppointmentId) } } : {}),
    })
      .select('start end dentistId chairId appointmentTypeId')
      .lean(),
  ]);
  const typeBuffers = new Map((await AppointmentTypeModel.find({}).select('bufferAfterMin').lean()).map((t) => [String(t._id), t.bufferAfterMin ?? 0]));

  return {
    timezone: tz,
    from: q.from,
    to: q.to,
    durationMin: duration,
    ...(q.appointmentTypeId ? { appointmentTypeId: q.appointmentTypeId } : {}),
    ...(q.chairId ? { chairId: q.chairId } : {}),
    clinicHours: (clinic.workingHours ?? []).map((h) => ({ weekday: h.weekday, open: h.open ?? '09:00', close: h.close ?? '17:00', closed: Boolean(h.closed) })),
    dentists: dentists.map((d) => ({
      id: String(d._id),
      bookableOnline: Boolean(d.bookableOnline),
      schedules: schedules
        .filter((s) => String(s.staffId) === String(d._id))
        .map((s) => ({
          dentistId: String(d._id),
          effectiveFrom: s.effectiveFrom,
          ...(s.effectiveTo ? { effectiveTo: s.effectiveTo } : {}),
          slotGranularityMin: s.slotGranularityMin ?? 15,
          weekly: (s.weekly ?? []).map((w) => ({
            weekday: w.weekday ?? 0,
            blocks: (w.blocks ?? []).map((b) => ({
              start: b.start,
              end: b.end,
              ...(b.chairId ? { chairId: String(b.chairId) } : {}),
              ...(b.appointmentTypeIds?.length ? { appointmentTypeIds: b.appointmentTypeIds.map(String) } : {}),
              onlineBookable: b.onlineBookable ?? true,
            })),
          })),
        })),
    })),
    exceptions: exceptions.map((e) => ({
      type: e.type as EngineInput['exceptions'][number]['type'],
      start: e.start.getTime(),
      end: e.end.getTime(),
      ...(e.staffId ? { dentistId: String(e.staffId) } : {}),
      ...(e.chairId ? { chairId: String(e.chairId) } : {}),
    })),
    busy: appts.map((a) => ({
      start: a.start.getTime(),
      end: a.end.getTime(),
      dentistId: String(a.dentistId),
      ...(a.chairId ? { chairId: String(a.chairId) } : {}),
      bufferAfterMin: a.appointmentTypeId ? (typeBuffers.get(String(a.appointmentTypeId)) ?? 0) : 0,
    })),
    now: Date.now(),
    ...(q.online
      ? { online: { minLeadHours: clinic.settings?.minOnlineLeadHours ?? 2, maxDaysAhead: clinic.settings?.maxOnlineDaysAhead ?? 60, typeAllowsOnline: Boolean(type?.allowOnline) } }
      : {}),
  };
}

export async function availability(auth: AuthContext | null, q: EngineQuery) {
  const clinic = await loadClinic();
  const dentistId = auth && auth.scope === 'own' && auth.staffId ? auth.staffId : q.dentistId;
  const input = await engineInput(clinic, { ...q, ...(dentistId ? { dentistId } : {}) });
  return { durationMin: input.durationMin, timezone: input.timezone, days: computeSlots(input) };
}

/* ---------- DTO ---------- */

type Raw = Partial<Appointment> & { _id: Types.ObjectId; __v?: number };
type PatientMini = { _id: Types.ObjectId; fullName?: string | null; fileNumber?: string | null; phone?: { e164?: string | null } | null; medicalAlerts?: string[]; noShowCount?: number | null };

export function toAppointmentDto(a: Raw, patient?: PatientMini | null) {
  const status = (a.status ?? 'scheduled') as AppointmentStatus;
  return {
    id: String(a._id),
    version: a.__v ?? 0,
    number: a.number,
    patientId: a.patientId ? String(a.patientId) : undefined,
    patient: patient
      ? { id: String(patient._id), fullName: patient.fullName ?? '', fileNumber: patient.fileNumber ?? '', phone: patient.phone?.e164 ?? undefined, medicalAlerts: patient.medicalAlerts ?? [], noShowCount: patient.noShowCount ?? 0 }
      : undefined,
    dentistId: String(a.dentistId),
    chairId: a.chairId ? String(a.chairId) : undefined,
    assistantIds: (a.assistantIds ?? []).map(String),
    appointmentTypeId: a.appointmentTypeId ? String(a.appointmentTypeId) : undefined,
    start: a.start,
    end: a.end,
    status,
    displayStatus: a.start && a.end ? displayStatus({ status, start: a.start, end: a.end }) : status,
    statusHistory: (a.statusHistory ?? []).map((h) => ({ from: h.from, to: h.to, at: h.at, byUserId: h.byUserId ? String(h.byUserId) : undefined, reason: h.reason ?? undefined })),
    source: a.source,
    priority: a.priority,
    overbooked: Boolean(a.overbooked),
    notes: a.notes ?? '',
    patientNotes: a.patientNotes ?? '',
    cancellation: a.cancellation?.at ? { reason: a.cancellation.reason, comment: a.cancellation.comment, at: a.cancellation.at, lateCancel: Boolean(a.cancellation.lateCancel) } : undefined,
    rescheduledFromId: a.rescheduledFromId ? String(a.rescheduledFromId) : undefined,
    checkInAt: a.checkInAt,
    seatedAt: a.seatedAt,
    completedAt: a.completedAt,
    noProceduresReason: a.noProceduresReason ?? undefined,
    invoiceId: a.invoiceId ? String(a.invoiceId) : undefined,
    recallId: a.recallId ? String(a.recallId) : undefined,
    waitlistId: a.waitlistId ? String(a.waitlistId) : undefined,
    createdAt: (a as { createdAt?: Date }).createdAt,
  };
}
export type AppointmentDto = ReturnType<typeof toAppointmentDto>;

async function patientsById(ids: (Types.ObjectId | null | undefined)[]) {
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  if (!uniq.length) return new Map<string, PatientMini>();
  const rows = await PatientModel.find({ _id: { $in: uniq } }).select('fullName fileNumber phone medicalAlerts noShowCount').lean();
  return new Map(rows.map((p) => [String(p._id), p as unknown as PatientMini]));
}

export async function serializeMany(auth: AuthContext, rows: Raw[]) {
  const policy = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  const patients = policy.visible.has('patient') ? await patientsById(rows.map((r) => r.patientId)) : new Map<string, PatientMini>();
  return rows.map((r) => {
    const dto = toAppointmentDto(r, patients.get(String(r.patientId)));
    if (!policy.visible.has('patient')) delete dto.patient;
    return applyFieldPolicy(dto, policy);
  });
}

async function serializeOne(auth: AuthContext, row: Raw) {
  const [dto] = await serializeMany(auth, [row]);
  return dto!;
}

/* ---------- scope ---------- */

/** `own` = appointments where the user is the dentist or an assistant (04 §3). */
export function ownFilter(auth: AuthContext, permission: string): Record<string, unknown> {
  if (scopeFor(auth, permission) !== 'own') return {};
  const me = new Types.ObjectId(auth.staffId);
  return { $or: [{ dentistId: me }, { assistantIds: me }] };
}

async function loadScoped(auth: AuthContext, id: string, permission: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound();
  const own = ownFilter(auth, permission);
  const doc = await AppointmentModel.findOne(Object.keys(own).length ? { $and: [{ _id: id }, own] } : { _id: id });
  if (!doc) throw ApiError.notFound();
  return doc;
}

/* ---------- list / get ---------- */

export type ListQuery = { from: string; to: string; dentistId?: string; chairId?: string; patientId?: string; status?: AppointmentStatus[]; includeCancelled?: boolean };

export async function listAppointments(auth: AuthContext, q: ListQuery) {
  const clinic = await loadClinic();
  const tz = clinic.timezone ?? 'Asia/Amman';
  const filter: Record<string, unknown> = { start: { $gte: startOfLocalDay(q.from, tz), $lt: startOfLocalDay(addDays(q.to, 1), tz) } };
  if (q.dentistId) filter.dentistId = new Types.ObjectId(q.dentistId);
  if (q.chairId) filter.chairId = new Types.ObjectId(q.chairId);
  if (q.patientId) filter.patientId = new Types.ObjectId(q.patientId);
  if (q.status?.length) filter.status = { $in: q.status };
  else if (!q.includeCancelled) filter.status = { $nin: ['cancelled'] };
  const own = ownFilter(auth, `${RESOURCE}.read`);
  const rows = await AppointmentModel.find(Object.keys(own).length ? { $and: [filter, own] } : filter)
    .sort({ start: 1 })
    .limit(2000)
    .lean();
  return serializeMany(auth, rows as Raw[]);
}

export async function patientAppointments(auth: AuthContext, patientId: string) {
  const own = ownFilter(auth, `${RESOURCE}.read`);
  const filter = { patientId: new Types.ObjectId(patientId) };
  const rows = await AppointmentModel.find(Object.keys(own).length ? { $and: [filter, own] } : filter).sort({ start: -1 }).limit(200).lean();
  return serializeMany(auth, rows as Raw[]);
}

export async function getAppointment(auth: AuthContext, id: string) {
  const doc = await loadScoped(auth, id, `${RESOURCE}.read`);
  return serializeOne(auth, doc.toObject() as Raw);
}

/* ---------- locks ---------- */

function buckets(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const step = BUCKET_MIN * MIN;
  for (let t = Math.floor(start.getTime() / step) * step; t < end.getTime(); t += step) out.push(new Date(t));
  return out;
}

async function insertLocks(appointmentId: Types.ObjectId, a: { dentistId: Types.ObjectId; chairId?: Types.ObjectId | null; start: Date; end: Date }, session: ClientSession | undefined) {
  const clinicId = new Types.ObjectId(currentClinicId());
  const rows = buckets(a.start, a.end).flatMap((bucketStart) => [
    { clinicId, resourceType: 'dentist', resourceId: a.dentistId, bucketStart, appointmentId },
    ...(a.chairId ? [{ clinicId, resourceType: 'chair', resourceId: a.chairId, bucketStart, appointmentId }] : []),
  ]);
  try {
    await SlotLockModel.insertMany(rows, { session, ordered: true });
  } catch (err) {
    // Without a transaction (dev standalone Mongo) clean up the partial insert ourselves.
    if (!session) await SlotLockModel.deleteMany({ appointmentId });
    if ((err as { code?: number }).code === 11000) throw ApiError.conflict('APPOINTMENT_SLOT_TAKEN', 'This time was just booked by someone else');
    throw err;
  }
}

async function releaseLocks(appointmentId: Types.ObjectId, session: ClientSession | undefined) {
  await SlotLockModel.deleteMany({ appointmentId }, { session });
}

/* ---------- booking ---------- */

export type BookInput = {
  patientId: string;
  dentistId: string;
  chairId?: string;
  appointmentTypeId?: string;
  start: Date;
  durationMin?: number;
  assistantIds?: string[];
  plannedItems?: { treatmentPlanItemId?: string; procedureId?: string; toothNumbers?: number[]; surfaces?: string[] }[];
  notes?: string;
  patientNotes?: string;
  source?: 'staff' | 'online' | 'walk_in' | 'recall';
  priority?: 'normal' | 'emergency';
  override?: boolean;
  allowOverlap?: boolean;
  recallId?: string;
  waitlistId?: string;
};

async function validateResources(b: { patientId?: string; dentistId: string; chairId?: string | null }) {
  const [patient, dentist, chair] = await Promise.all([
    b.patientId ? PatientModel.findById(b.patientId).select('status').lean() : null,
    StaffModel.findById(b.dentistId).select('status staffType').lean(),
    b.chairId ? ChairModel.findById(b.chairId).select('isActive').lean() : null,
  ]);
  if (b.patientId && !patient) throw ApiError.validation([{ path: 'patientId', code: 'not_found' }]);
  if (patient && patient.status !== 'active') throw ApiError.conflict('PATIENT_INACTIVE', 'Patient is not active');
  if (!dentist || dentist.status !== 'active' || !(BOOKABLE_TYPES as readonly string[]).includes(dentist.staffType)) {
    throw ApiError.conflict('DENTIST_NOT_BOOKABLE', 'This staff member cannot take appointments');
  }
  if (b.chairId && (!chair || !chair.isActive)) throw ApiError.conflict('CHAIR_INACTIVE', 'Chair is not active');
}

function assertOwnDentist(auth: AuthContext, permission: string, dentistId: string) {
  if (scopeFor(auth, permission) === 'own' && dentistId !== auth.staffId) throw ApiError.forbidden('FORBIDDEN', 'You can only book into your own calendar');
}

function canOverride(auth: AuthContext): boolean {
  return auth.isOwner || scopeFor(auth, `${RESOURCE}.book`) === 'all';
}

async function assertBookable(clinic: ClinicLean, b: { dentistId: string; chairId?: string; appointmentTypeId?: string; start: Date; durationMin: number; override?: boolean; excludeAppointmentId?: string }) {
  const tz = clinic.timezone ?? 'Asia/Amman';
  if (b.override) return;
  if (b.start.getTime() < Date.now() - 5 * MIN) throw ApiError.conflict('APPOINTMENT_IN_PAST', 'This time has already passed');
  const date = localDate(b.start, tz);
  const input = await engineInput(clinic, { from: date, to: date, dentistId: b.dentistId, ...(b.chairId ? { chairId: b.chairId } : {}), ...(b.appointmentTypeId ? { appointmentTypeId: b.appointmentTypeId } : {}), durationMin: b.durationMin, ...(b.excludeAppointmentId ? { excludeAppointmentId: b.excludeAppointmentId } : {}) });
  input.now = Math.min(input.now, b.start.getTime());
  if (isWithinAvailability(input, b.start, b.dentistId)) return;
  // Off the grid gets its own code so the UI can say "pick :00/:15/:30…".
  const step = input.dentists[0]?.schedules.find((s) => s.effectiveFrom <= date && (!s.effectiveTo || s.effectiveTo >= date))?.slotGranularityMin ?? 15;
  if (minutesOf(localTime(b.start, tz)) % step !== 0) throw ApiError.conflict('APPOINTMENT_NOT_ALIGNED', 'Start time is not on the schedule grid', { stepMin: step });
  const free = computeSlots(input)[0]?.slots ?? [];
  throw ApiError.conflict('APPOINTMENT_OUTSIDE_SCHEDULE', 'This time is not available', { suggestions: free.slice(0, 6).map((s) => s.start) });
}

export async function book(auth: AuthContext, b: BookInput) {
  const permission = `${RESOURCE}.book`;
  assertOwnDentist(auth, permission, b.dentistId);
  assertWritable(b, fieldPolicyOf(auth, RESOURCE, permission));
  if ((b.override || b.allowOverlap) && !canOverride(auth)) throw ApiError.forbidden('FORBIDDEN', 'Override needs full booking rights');
  await validateResources(b);
  const clinic = await loadClinic();
  const type = b.appointmentTypeId ? await AppointmentTypeModel.findById(b.appointmentTypeId).lean() : null;
  const durationMin = b.durationMin ?? type?.defaultDurationMin ?? clinic.settings?.defaultAppointmentMinutes ?? 30;
  await assertBookable(clinic, { ...b, durationMin });
  const start = b.start;
  const end = new Date(start.getTime() + durationMin * MIN);
  const id = new Types.ObjectId();

  const appt = await withTransaction(async (session) => {
    const s = session ?? undefined;
    if (!b.allowOverlap) await insertLocks(id, { dentistId: new Types.ObjectId(b.dentistId), chairId: b.chairId ? new Types.ObjectId(b.chairId) : null, start, end }, s);
    const prefix = clinic.settings?.numbering?.appointment ?? 'APT';
    const number = await nextNumber('appointment', prefix, { session: s ?? null });
    const [doc] = await AppointmentModel.create(
      [
        {
          _id: id,
          number,
          patientId: b.patientId,
          dentistId: b.dentistId,
          chairId: b.chairId,
          assistantIds: b.assistantIds ?? [],
          appointmentTypeId: b.appointmentTypeId,
          start,
          end,
          status: 'scheduled',
          statusHistory: [{ to: 'scheduled', at: new Date(), byUserId: auth.userId }],
          source: b.source ?? 'staff',
          priority: b.priority ?? 'normal',
          overbooked: Boolean(b.allowOverlap),
          plannedItems: b.plannedItems ?? [],
          notes: b.notes ?? '',
          patientNotes: b.patientNotes ?? '',
          recallId: b.recallId,
          waitlistId: b.waitlistId,
        },
      ],
      { session: s },
    );
    onCommit(session, () => emit('appointment.booked', { clinicId: String(clinic._id), appointmentId: String(id), actorUserId: auth.userId }));
    return doc!;
  }).catch(async (err: unknown) => {
    if (!(err instanceof ApiError)) await SlotLockModel.deleteMany({ appointmentId: id });
    throw err;
  });
  await recordAudit({ action: 'create', entity: 'appointment', entityId: id, after: { number: appt.number, start, dentistId: b.dentistId, patientId: b.patientId }, ...(b.override ? { reason: 'override' } : {}) });
  return serializeOne(auth, appt.toObject() as Raw);
}

/* ---------- reschedule / update ---------- */

export type UpdateInput = Partial<Omit<Pick<BookInput, 'dentistId' | 'chairId' | 'appointmentTypeId' | 'start' | 'durationMin' | 'assistantIds' | 'notes' | 'patientNotes' | 'priority' | 'override' | 'allowOverlap' | 'plannedItems'>, 'chairId'>> & { version?: number; chairId?: string | null };

export async function updateAppointment(auth: AuthContext, id: string, b: UpdateInput) {
  const permission = `${RESOURCE}.update`;
  assertWritable(b, fieldPolicyOf(auth, RESOURCE, permission));
  const doc = await loadScoped(auth, id, permission);
  if (b.version !== undefined && b.version !== doc.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this appointment');
  if (!['scheduled', 'confirmed'].includes(doc.status) && (b.start || b.dentistId || b.chairId !== undefined || b.durationMin)) {
    throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Only upcoming appointments can be moved');
  }
  if ((b.override || b.allowOverlap) && !canOverride(auth)) throw ApiError.forbidden('FORBIDDEN', 'Override needs full booking rights');
  const dentistId = b.dentistId ?? String(doc.dentistId);
  assertOwnDentist(auth, permission, dentistId);
  const chairId = b.chairId === null ? undefined : (b.chairId ?? (doc.chairId ? String(doc.chairId) : undefined));
  const start = b.start ?? doc.start;
  const durationMin = b.durationMin ?? Math.round((doc.end.getTime() - doc.start.getTime()) / MIN);
  const end = new Date(start.getTime() + durationMin * MIN);
  const moved = start.getTime() !== doc.start.getTime() || end.getTime() !== doc.end.getTime() || dentistId !== String(doc.dentistId) || (chairId ?? '') !== (doc.chairId ? String(doc.chairId) : '');
  const clinic = await loadClinic();
  if (moved) {
    await validateResources({ dentistId, chairId: chairId ?? null });
    await assertBookable(clinic, { dentistId, ...(chairId ? { chairId } : {}), ...(doc.appointmentTypeId ? { appointmentTypeId: String(doc.appointmentTypeId) } : {}), start, durationMin, override: b.override, excludeAppointmentId: id });
  }
  const previousStart = doc.start.toISOString();
  const before = { start: doc.start, end: doc.end, dentistId: String(doc.dentistId), chairId: doc.chairId ? String(doc.chairId) : undefined };

  await withTransaction(async (session) => {
    const s = session ?? undefined;
    if (moved) {
      await releaseLocks(doc._id, s);
      if (!b.allowOverlap) {
        await insertLocks(doc._id, { dentistId: new Types.ObjectId(dentistId), chairId: chairId ? new Types.ObjectId(chairId) : null, start, end }, s).catch(async (err: unknown) => {
          // Standalone Mongo: put the old locks back so the original slot stays protected.
          if (!session) await insertLocks(doc._id, { dentistId: doc.dentistId, chairId: doc.chairId, start: doc.start, end: doc.end }, undefined).catch(() => undefined);
          throw err;
        });
      }
      doc.set({ start, end, dentistId, chairId: chairId ?? undefined, overbooked: Boolean(b.allowOverlap) });
      doc.statusHistory.push({ from: doc.status, to: doc.status, at: new Date(), byUserId: new Types.ObjectId(auth.userId), reason: 'rescheduled' });
      if (doc.reminders) doc.set('reminders', {});
    }
    for (const k of ['assistantIds', 'notes', 'patientNotes', 'priority', 'appointmentTypeId', 'plannedItems'] as const) {
      if (b[k] !== undefined) doc.set(k, b[k]);
    }
    await doc.save({ session: s });
    if (moved) onCommit(session, () => emit('appointment.rescheduled', { clinicId: String(clinic._id), appointmentId: id, previousStart, actorUserId: auth.userId }));
  });
  await recordAudit({ action: 'update', entity: 'appointment', entityId: id, before, after: { start, end, dentistId, chairId }, summary: moved ? 'rescheduled' : 'updated' });
  return serializeOne(auth, doc.toObject() as Raw);
}

/* ---------- status transitions ---------- */

/** Clinical registers a counter of performed procedures for the visit (06 §4 `completed`). */
type CompletionCheck = (appointmentId: string) => Promise<number>;
const completionChecks: CompletionCheck[] = [];
export function registerCompletionCheck(fn: CompletionCheck): void {
  completionChecks.push(fn);
}

export type TransitionInput = { to: AppointmentStatus; reason?: string; comment?: string; noProcedures?: boolean; version?: number };

const TRANSITION_PERMISSION: Partial<Record<AppointmentStatus, string>> = {
  confirmed: `${RESOURCE}.update`,
  arrived: `${RESOURCE}.checkin`,
  in_chair: `${RESOURCE}.checkin`,
  completed: `${RESOURCE}.update`,
  cancelled: `${RESOURCE}.cancel`,
  no_show: `${RESOURCE}.cancel`,
};

export function transitionPermission(to: AppointmentStatus): string {
  return TRANSITION_PERMISSION[to] ?? `${RESOURCE}.update`;
}

export async function transition(auth: AuthContext, id: string, t: TransitionInput) {
  const permission = transitionPermission(t.to);
  // Seating / checking in can also be done by the treating dentist with update rights.
  const effective = scopeFor(auth, permission) ? permission : `${RESOURCE}.update`;
  if (!auth.isOwner && !scopeFor(auth, effective)) throw ApiError.forbidden('FORBIDDEN', 'Missing permission', { permission });
  const doc = await loadScoped(auth, id, effective);
  if (t.version !== undefined && t.version !== doc.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this appointment');
  const from = doc.status;
  if (!canTransition(from, t.to)) throw ApiError.conflict('INVALID_STATE_TRANSITION', `Cannot go from ${from} to ${t.to}`, { from, to: t.to });
  const clinic = await loadClinic();
  const now = new Date();

  if (t.to === 'no_show') {
    const grace = clinic.settings?.noShowGraceMinutes ?? 15;
    if (now.getTime() < doc.start.getTime() + grace * MIN) throw ApiError.conflict('NO_SHOW_TOO_EARLY', 'A no-show can be recorded only after the grace period', { graceMinutes: grace });
  }
  if (t.to === 'cancelled' && from === 'arrived' && !t.reason) throw ApiError.validation([{ path: 'reason', code: 'required' }]);
  if (t.to === 'completed') {
    const performed = (await Promise.all(completionChecks.map((c) => c(id)))).reduce((a, n) => a + n, 0);
    if (!performed && !(t.noProcedures && t.reason)) throw ApiError.conflict('COMPLETE_REQUIRES_PROCEDURE', 'Record a procedure or confirm the visit had none');
  }

  await withTransaction(async (session) => {
    const s = session ?? undefined;
    doc.status = t.to;
    doc.statusHistory.push({ from, to: t.to, at: now, byUserId: new Types.ObjectId(auth.userId), ...(t.reason ? { reason: t.reason } : {}) });
    if (t.to === 'arrived') doc.checkInAt = now;
    if (t.to === 'in_chair') doc.seatedAt = now;
    if (t.to === 'completed') {
      doc.completedAt = now;
      if (t.noProcedures) doc.noProceduresReason = t.reason ?? '';
      await PatientModel.updateOne({ _id: doc.patientId }, { $set: { lastVisitAt: now } }, { session: s });
    }
    if (t.to === 'cancelled') {
      const windowH = clinic.settings?.cancellationWindowHours ?? 24;
      const late = doc.start.getTime() - now.getTime() < windowH * 3_600_000;
      doc.set('cancellation', { reason: t.reason ?? 'other', comment: t.comment ?? '', byUserId: auth.userId, at: now, lateCancel: late });
    }
    if (t.to === 'no_show') await PatientModel.updateOne({ _id: doc.patientId }, { $inc: { noShowCount: 1 } }, { session: s });
    if (t.to === 'cancelled' || t.to === 'no_show') await releaseLocks(doc._id, s);
    await doc.save({ session: s });
    const clinicId = String(clinic._id);
    onCommit(session, async () => {
      await emit('appointment.statusChanged', { clinicId, appointmentId: id, from, to: t.to, actorUserId: auth.userId });
      if (t.to === 'cancelled') await emit('appointment.cancelled', { clinicId, appointmentId: id, actorUserId: auth.userId });
      if (t.to === 'completed') await emit('appointment.completed', { clinicId, appointmentId: id, actorUserId: auth.userId });
    });
  });
  await recordAudit({ action: 'status_change', entity: 'appointment', entityId: id, before: { status: from }, after: { status: t.to }, ...(t.reason ? { reason: t.reason } : {}) });
  return serializeOne(auth, doc.toObject() as Raw);
}

/* ---------- bulk shift (Hakeemna /delay) ---------- */

export async function bulkShift(auth: AuthContext, ids: string[], minutes: number) {
  const results: { id: string; ok: boolean; code?: string }[] = [];
  for (const id of ids) {
    try {
      const doc = await loadScoped(auth, id, `${RESOURCE}.update`);
      await updateAppointment(auth, id, { start: new Date(doc.start.getTime() + minutes * MIN), override: canOverride(auth) });
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, code: err instanceof ApiError ? err.code : 'INTERNAL_ERROR' });
    }
  }
  await recordAudit({ action: 'update', entity: 'appointment', summary: `bulk shift ${minutes} min × ${ids.length}` });
  return results;
}

/* ---------- today board (06 §8) ---------- */

export async function todayBoard(auth: AuthContext, date?: string) {
  const clinic = await loadClinic();
  const tz = clinic.timezone ?? 'Asia/Amman';
  const day = date ?? localDate(new Date(), tz);
  const all = await listAppointments(auth, { from: day, to: day, includeCancelled: true });
  const now = Date.now();
  const col = (s: AppointmentStatus[]) => all.filter((a) => s.includes(a.status));
  return {
    date: day,
    upcoming: col(['scheduled', 'confirmed']),
    arrived: col(['arrived']).map((a) => ({ ...a, waitingMin: a.checkInAt ? Math.max(0, Math.round((now - new Date(a.checkInAt).getTime()) / MIN)) : 0 })),
    inChair: col(['in_chair']),
    completed: col(['completed']),
    missed: col(['no_show', 'cancelled']),
    counts: Object.fromEntries(['scheduled', 'confirmed', 'arrived', 'in_chair', 'completed', 'cancelled', 'no_show'].map((s) => [s, all.filter((a) => a.status === s).length])),
  };
}

/** Future active appointments of a staff member (blocks deactivation, 08 §1). */
export async function futureAppointmentCount(staffId: string): Promise<number> {
  return AppointmentModel.countDocuments({ dentistId: staffId, start: { $gt: new Date() }, status: { $in: ['scheduled', 'confirmed'] } });
}

/* ---------- patient portal (01 §4.10, 06 §2 step 7) ---------- */

export type OnlineBookInput = { patientId: string; dentistId: string; appointmentTypeId: string; start: Date; patientNotes?: string; userId: string };

/**
 * Online booking by a patient: the slot must be one the engine offers online (bookable dentist,
 * online block, online type, lead time, days ahead). Runs inside the clinic's tenant.
 */
export async function bookOnline(b: OnlineBookInput) {
  const clinic = await loadClinic();
  if (!clinic.settings?.onlineBookingEnabled) throw ApiError.conflict('ONLINE_BOOKING_DISABLED', 'This clinic does not take online bookings');
  await validateResources(b);
  const patient = await PatientModel.findById(b.patientId).select('noShowCount').lean();
  if ((patient?.noShowCount ?? 0) >= (clinic.settings?.noShowAlertThreshold ?? 3)) throw ApiError.conflict('ONLINE_BOOKING_BLOCKED', 'Please call the clinic to book');
  const tz = clinic.timezone ?? 'Asia/Amman';
  const date = localDate(b.start, tz);
  const input = await engineInput(clinic, { from: date, to: date, dentistId: b.dentistId, appointmentTypeId: b.appointmentTypeId, online: true });
  const free = computeSlots(input)[0]?.slots ?? [];
  const slot = free.find((s) => new Date(s.start).getTime() === b.start.getTime() && s.dentistId === b.dentistId);
  if (!slot) throw ApiError.conflict('APPOINTMENT_OUTSIDE_SCHEDULE', 'This time is not available', { suggestions: free.slice(0, 6).map((s) => s.start) });
  const end = new Date(b.start.getTime() + input.durationMin * MIN);
  const chairId = slot.chairId ? new Types.ObjectId(slot.chairId) : null;
  const id = new Types.ObjectId();
  const appt = await withTransaction(async (session) => {
    const s = session ?? undefined;
    await insertLocks(id, { dentistId: new Types.ObjectId(b.dentistId), chairId, start: b.start, end }, s);
    const number = await nextNumber('appointment', clinic.settings?.numbering?.appointment ?? 'APT', { session: s ?? null });
    const [doc] = await AppointmentModel.create(
      [
        {
          _id: id,
          number,
          patientId: b.patientId,
          dentistId: b.dentistId,
          ...(chairId ? { chairId } : {}),
          appointmentTypeId: b.appointmentTypeId,
          start: b.start,
          end,
          status: 'scheduled',
          statusHistory: [{ to: 'scheduled', at: new Date(), byUserId: b.userId }],
          source: 'online',
          patientNotes: b.patientNotes ?? '',
        },
      ],
      { session: s },
    );
    onCommit(session, () => emit('appointment.booked', { clinicId: String(clinic._id), appointmentId: String(id), actorUserId: b.userId }));
    return doc!;
  }).catch(async (err: unknown) => {
    if (!(err instanceof ApiError)) await SlotLockModel.deleteMany({ appointmentId: id });
    throw err;
  });
  await recordAudit({ action: 'create', entity: 'appointment', entityId: id, actorUserId: b.userId, summary: 'online booking', after: { number: appt.number, start: b.start, dentistId: b.dentistId, patientId: b.patientId } });
  return appt.toObject();
}

/** Patient cancellation: only scheduled/confirmed visits, and only before the clinic's window. */
export async function cancelOnline(appointmentId: string, patientIds: Types.ObjectId[], userId: string, comment?: string) {
  const doc = await AppointmentModel.findOne({ _id: appointmentId, patientId: { $in: patientIds } });
  if (!doc) throw ApiError.notFound();
  if (!['scheduled', 'confirmed'].includes(doc.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', `Cannot cancel a ${doc.status} appointment`);
  const clinic = await loadClinic();
  const windowH = clinic.settings?.cancellationWindowHours ?? 24;
  const now = new Date();
  if (doc.start.getTime() - now.getTime() < windowH * 3_600_000) throw ApiError.conflict('CANCEL_WINDOW_PASSED', 'Too close to the appointment to cancel online', { hours: windowH });
  const from = doc.status;
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    doc.status = 'cancelled';
    doc.statusHistory.push({ from, to: 'cancelled', at: now, byUserId: new Types.ObjectId(userId), reason: 'patient_request' });
    doc.set('cancellation', { reason: 'patient_request', comment: comment ?? '', byUserId: userId, at: now, lateCancel: false });
    await releaseLocks(doc._id, s);
    await doc.save({ session: s });
    const clinicId = String(clinic._id);
    onCommit(session, async () => {
      await emit('appointment.statusChanged', { clinicId, appointmentId, from, to: 'cancelled', actorUserId: userId });
      await emit('appointment.cancelled', { clinicId, appointmentId, actorUserId: userId });
    });
  });
  await recordAudit({ action: 'status_change', entity: 'appointment', entityId: appointmentId, actorUserId: userId, before: { status: from }, after: { status: 'cancelled' }, reason: 'patient_request' });
  return doc.toObject();
}
