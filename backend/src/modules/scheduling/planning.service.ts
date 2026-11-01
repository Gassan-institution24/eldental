import { Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { ApiError } from '@/core/http/ApiError';
import { scopeFor } from '@/core/rbac/authorize';
import { PatientModel } from '@/modules/patients/patient.models';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, localDate } from '@/shared/dates';
import { escapeRegex, toSearchName } from '@/shared/validation/normalize';
import { BOOKABLE_TYPES, loadClinic } from './scheduling.service';
import { DentistScheduleModel, RecallModel, WaitingListModel } from './scheduling.models';
import type { RECALL_TYPES, ScheduleBody } from './scheduling.schemas';

/* ---------- dentist schedules (06 §1) ---------- */

function assertOwnStaff(auth: AuthContext, permission: string, staffId: string) {
  if (scopeFor(auth, permission) === 'own' && staffId !== auth.staffId) throw ApiError.notFound();
}

const scheduleDto = (s: Record<string, unknown> & { _id: Types.ObjectId; staffId: Types.ObjectId; __v?: number }) => ({
  id: String(s._id),
  version: s.__v ?? 0,
  staffId: String(s.staffId),
  effectiveFrom: String(s.effectiveFrom),
  effectiveTo: s.effectiveTo ? String(s.effectiveTo) : undefined,
  slotGranularityMin: s.slotGranularityMin,
  weekly: ((s.weekly as { weekday: number; blocks: Record<string, unknown>[] }[]) ?? []).map((w) => ({
    weekday: w.weekday,
    blocks: w.blocks.map((b) => ({
      start: b.start,
      end: b.end,
      chairId: b.chairId ? String(b.chairId) : undefined,
      appointmentTypeIds: ((b.appointmentTypeIds as Types.ObjectId[] | undefined) ?? []).map(String),
      onlineBookable: b.onlineBookable ?? true,
    })),
  })),
});

/** Every bookable dentist with the schedule in force today (+ future versions). */
export async function listSchedules(auth: AuthContext) {
  const clinic = await loadClinic();
  const today = localDate(new Date(), clinic.timezone ?? 'Asia/Amman');
  const own = scopeFor(auth, 'scheduling.schedule.read') === 'own';
  const dentists = await StaffModel.find({ status: 'active', staffType: { $in: BOOKABLE_TYPES }, ...(own ? { _id: auth.staffId } : {}) })
    .select('name color staffType bookableOnline defaultChairId specialties primarySpecialty')
    .sort({ name: 1 })
    .lean();
  const schedules = await DentistScheduleModel.find({ staffId: { $in: dentists.map((d) => d._id) } }).sort({ effectiveFrom: 1 }).lean();
  return dentists.map((d) => {
    const mine = schedules.filter((s) => String(s.staffId) === String(d._id)).map((s) => scheduleDto(s as never));
    const current = [...mine].reverse().find((s) => s.effectiveFrom <= today && (!s.effectiveTo || s.effectiveTo >= today));
    return {
      staff: { id: String(d._id), name: d.name, color: d.color, staffType: d.staffType, bookableOnline: Boolean(d.bookableOnline), defaultChairId: d.defaultChairId ? String(d.defaultChairId) : undefined, specialties: d.specialties ?? [], primarySpecialty: d.primarySpecialty ?? undefined },
      current: current ?? null,
      versions: mine,
    };
  });
}

/**
 * Saves a schedule version. Same `effectiveFrom` replaces it; a later one closes the previous
 * open version the day before (history is kept so past availability stays explainable).
 */
export async function saveSchedule(auth: AuthContext, staffId: string, body: ScheduleBody) {
  assertOwnStaff(auth, 'scheduling.schedule.manage', staffId);
  const staff = await StaffModel.findById(staffId).select('staffType status').lean();
  if (!staff) throw ApiError.notFound();
  if (!(BOOKABLE_TYPES as readonly string[]).includes(staff.staffType)) throw ApiError.conflict('DENTIST_NOT_BOOKABLE', 'Only dentists and hygienists have schedules');
  const overlapping = await DentistScheduleModel.find({
    staffId,
    effectiveFrom: { $ne: body.effectiveFrom },
    $and: [{ $or: [{ effectiveTo: null }, { effectiveTo: { $exists: false } }, { effectiveTo: { $gte: body.effectiveFrom } }] }, ...(body.effectiveTo ? [{ effectiveFrom: { $lte: body.effectiveTo } }] : [])],
  });
  for (const o of overlapping) {
    if (o.effectiveFrom < body.effectiveFrom) {
      o.effectiveTo = addDays(body.effectiveFrom, -1);
      await o.save();
    } else {
      throw ApiError.conflict('SCHEDULE_OVERLAP', 'Another schedule version starts inside this range', { effectiveFrom: o.effectiveFrom });
    }
  }
  const existing = await DentistScheduleModel.findOne({ staffId, effectiveFrom: body.effectiveFrom });
  const doc = existing ?? new DentistScheduleModel({ staffId });
  const before = existing ? scheduleDto(existing.toObject() as never) : undefined;
  doc.set({ ...body, effectiveTo: body.effectiveTo ?? undefined });
  await doc.save();
  await recordAudit({ action: existing ? 'update' : 'create', entity: 'dentistSchedule', entityId: doc._id, before, after: { staffId, effectiveFrom: body.effectiveFrom } });
  return scheduleDto(doc.toObject() as never);
}

export async function deleteScheduleVersion(auth: AuthContext, staffId: string, id: string) {
  assertOwnStaff(auth, 'scheduling.schedule.manage', staffId);
  const doc = await DentistScheduleModel.findOne({ _id: id, staffId });
  if (!doc) throw ApiError.notFound();
  await doc.deleteOne();
  await recordAudit({ action: 'delete', entity: 'dentistSchedule', entityId: id });
}

/* ---------- patient name join for lists ---------- */

async function withPatients<T extends { patientId?: Types.ObjectId | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => String(r.patientId)))];
  const patients = await PatientModel.find({ _id: { $in: ids } }).select('fullName fileNumber phone').lean();
  const map = new Map(patients.map((p) => [String(p._id), { id: String(p._id), fullName: p.fullName ?? '', fileNumber: p.fileNumber ?? '', phone: p.phone?.e164 ?? undefined }]));
  return (r: T) => map.get(String(r.patientId));
}

async function patientIdsMatching(q?: string): Promise<Types.ObjectId[] | null> {
  if (!q) return null;
  const rx = new RegExp(escapeRegex(toSearchName(q)));
  const rows = await PatientModel.find({ $or: [{ searchName: rx }, { fileNumber: q.toUpperCase() }, { 'phone.e164': new RegExp(escapeRegex(q.replace(/\D/g, ''))) }] })
    .select('_id')
    .limit(200)
    .lean();
  return rows.map((r) => r._id);
}

/* ---------- waiting list (06 §6) ---------- */

type WaitRaw = Record<string, unknown> & { _id: Types.ObjectId; patientId: Types.ObjectId; __v?: number };
const waitDto = (w: WaitRaw, patient?: { id: string; fullName: string; fileNumber: string; phone?: string }) => ({
  id: String(w._id),
  version: w.__v ?? 0,
  patientId: String(w.patientId),
  patient,
  dentistId: w.dentistId ? String(w.dentistId) : undefined,
  appointmentTypeId: w.appointmentTypeId ? String(w.appointmentTypeId) : undefined,
  preferredDays: (w.preferredDays as number[]) ?? [],
  preferredTimeRange: (w.preferredTimeRange as { from?: string })?.from ? w.preferredTimeRange : undefined,
  notes: w.notes ?? '',
  priority: w.priority,
  status: w.status,
  offeredAt: w.offeredAt,
  appointmentId: w.appointmentId ? String(w.appointmentId) : undefined,
  createdAt: w.createdAt,
});

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export async function listWaitlist(q: { status?: string; dentistId?: string }) {
  const rows = (await WaitingListModel.find({ status: q.status ?? { $in: ['waiting', 'offered'] }, ...(q.dentistId ? { dentistId: q.dentistId } : {}) })
    .sort({ createdAt: 1 })
    .limit(500)
    .lean()) as unknown as WaitRaw[];
  const pick = await withPatients(rows);
  return rows.map((r) => waitDto(r, pick(r))).sort((a, b) => (PRIORITY_ORDER[String(a.priority)] ?? 2) - (PRIORITY_ORDER[String(b.priority)] ?? 2));
}

export async function addToWaitlist(body: Record<string, unknown> & { patientId: string }) {
  const patient = await PatientModel.findById(body.patientId).select('status').lean();
  if (!patient) throw ApiError.validation([{ path: 'patientId', code: 'not_found' }]);
  const doc = await WaitingListModel.create(body);
  await recordAudit({ action: 'create', entity: 'waitingList', entityId: doc._id, after: { patientId: body.patientId } });
  return (await listWaitlist({ status: 'waiting' })).find((w) => w.id === String(doc._id)) ?? waitDto(doc.toObject() as never);
}

export async function updateWaitlist(id: string, body: Record<string, unknown>) {
  const doc = await WaitingListModel.findById(id);
  if (!doc) throw ApiError.notFound();
  const before = { status: doc.status };
  for (const [k, v] of Object.entries(body)) doc.set(k, v === null ? undefined : v);
  if (body.status === 'offered') doc.offeredAt = new Date();
  await doc.save();
  await recordAudit({ action: 'update', entity: 'waitingList', entityId: id, before, after: { status: doc.status } });
  const pick = await withPatients([doc.toObject() as unknown as WaitRaw]);
  return waitDto(doc.toObject() as never, pick(doc.toObject() as never));
}

/** Entries matching a freed window: same dentist (or any), preferred weekday and time (06 §6). */
export async function waitlistMatches(slot: { dentistId: string; start: Date }, tz: string) {
  const date = localDate(slot.start, tz);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(slot.start);
  const rows = await WaitingListModel.find({ status: 'waiting', $or: [{ dentistId: null }, { dentistId: { $exists: false } }, { dentistId: slot.dentistId }] }).lean();
  return rows.filter(
    (w) =>
      (!w.preferredDays?.length || w.preferredDays.includes(weekday)) &&
      (!w.preferredTimeRange?.from || (hhmm >= w.preferredTimeRange.from && hhmm < (w.preferredTimeRange.to ?? '23:59'))),
  );
}

/* ---------- recalls (06 §7) ---------- */

type RecallRaw = Record<string, unknown> & { _id: Types.ObjectId; patientId: Types.ObjectId; dueDate: string; __v?: number };
const recallDto = (r: RecallRaw, patient: ReturnType<Awaited<ReturnType<typeof withPatients>>>, today: string) => ({
  id: String(r._id),
  version: r.__v ?? 0,
  patientId: String(r.patientId),
  patient,
  type: r.type,
  dueDate: r.dueDate,
  overdue: r.dueDate < today && !['booked', 'dismissed'].includes(String(r.status)),
  intervalMonths: r.intervalMonths,
  dentistId: r.dentistId ? String(r.dentistId) : undefined,
  status: r.status,
  lastContactAt: r.lastContactAt,
  contactCount: r.contactCount ?? 0,
  notes: r.notes ?? '',
  appointmentId: r.appointmentId ? String(r.appointmentId) : undefined,
});

export async function listRecalls(q: { bucket: string; dentistId?: string; q?: string; patientId?: string }) {
  const clinic = await loadClinic();
  const today = localDate(new Date(), clinic.timezone ?? 'Asia/Amman');
  const soon = addDays(today, 14);
  const filter: Record<string, unknown> = {};
  switch (q.bucket) {
    case 'overdue':
      Object.assign(filter, { dueDate: { $lt: today }, status: { $in: ['upcoming', 'due', 'contacted'] } });
      break;
    case 'due':
      Object.assign(filter, { dueDate: { $lte: soon }, status: { $in: ['upcoming', 'due'] } });
      break;
    case 'upcoming':
      Object.assign(filter, { dueDate: { $gt: soon }, status: 'upcoming' });
      break;
    case 'all':
      break;
    default:
      filter.status = q.bucket;
  }
  if (q.dentistId) filter.dentistId = new Types.ObjectId(q.dentistId);
  if (q.patientId) filter.patientId = new Types.ObjectId(q.patientId);
  const ids = await patientIdsMatching(q.q);
  if (ids) filter.patientId = { $in: ids };
  const rows = (await RecallModel.find(filter).sort({ dueDate: 1 }).limit(500).lean()) as unknown as RecallRaw[];
  const pick = await withPatients(rows);
  return rows.map((r) => recallDto(r, pick(r), today));
}

export async function createRecall(body: Record<string, unknown> & { patientId: string; type: string }) {
  const patient = await PatientModel.findById(body.patientId).select('_id').lean();
  if (!patient) throw ApiError.validation([{ path: 'patientId', code: 'not_found' }]);
  const doc = await RecallModel.create(body);
  await recordAudit({ action: 'create', entity: 'recall', entityId: doc._id, after: { patientId: body.patientId, type: body.type, dueDate: body.dueDate } });
  return (await listRecalls({ bucket: 'all', patientId: body.patientId })).find((r) => r.id === String(doc._id))!;
}

export async function updateRecall(id: string, body: Record<string, unknown> & { contacted?: boolean }) {
  const doc = await RecallModel.findById(id);
  if (!doc) throw ApiError.notFound();
  const { contacted, ...rest } = body;
  for (const [k, v] of Object.entries(rest)) doc.set(k, v === null ? undefined : v);
  if (contacted) {
    doc.status = 'contacted';
    doc.lastContactAt = new Date();
    doc.contactCount = (doc.contactCount ?? 0) + 1;
  }
  await doc.save();
  await recordAudit({ action: 'update', entity: 'recall', entityId: id, after: { status: doc.status } });
  return (await listRecalls({ bucket: 'all', patientId: String(doc.patientId) })).find((r) => r.id === id)!;
}

/** Create or move forward the patient's recall of a type (used by clinical on procedure.completed). */
export async function upsertRecall(patientId: string, type: (typeof RECALL_TYPES)[number], dueDate: string, intervalMonths: number) {
  await RecallModel.findOneAndUpdate(
    { patientId, type, status: { $in: ['upcoming', 'due', 'contacted'] } },
    { $set: { dueDate, intervalMonths, status: 'upcoming' }, $setOnInsert: { patientId, type } },
    { upsert: true },
  );
}
