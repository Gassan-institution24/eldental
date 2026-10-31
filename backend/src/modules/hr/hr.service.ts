import { createHmac } from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { withTransaction } from '@/core/db/transaction';
import { emit } from '@/core/events/bus';
import { ApiError } from '@/core/http/ApiError';
import { scopeFor } from '@/core/rbac/authorize';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { AppointmentModel, ScheduleExceptionModel } from '@/modules/scheduling/scheduling.models';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, atLocal, eachDate, localDate, localTime, startOfLocalDay, weekdayOf } from '@/shared/dates';
import { AttendanceModel, LeaveBalanceModel, LeaveRequestModel, LeaveTypeModel, ShiftModel } from './hr.models';

const MIN = 60_000;
const id = (v: unknown) => (v ? String(v) : undefined);

export async function hrSettings() {
  const c = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('timezone settings').lean());
  const s = (c?.settings ?? {}) as { weekendDays?: number[]; overtimeRequiresApproval?: boolean };
  return { tz: c?.timezone ?? 'Asia/Amman', weekendDays: s.weekendDays ?? [5], overtimeRequiresApproval: Boolean(s.overtimeRequiresApproval), settings: c?.settings };
}

/** Clinic-wide holidays (schedule exceptions of type holiday) as a set of local dates. */
export async function holidayDates(from: string, to: string, tz: string): Promise<Set<string>> {
  const rows = await ScheduleExceptionModel.find({ type: 'holiday', staffId: null, start: { $lt: startOfLocalDay(addDays(to, 1), tz) }, end: { $gt: startOfLocalDay(from, tz) } }).lean();
  const out = new Set<string>();
  for (const h of rows) for (const d of eachDate(localDate(h.start, tz), localDate(new Date(h.end.getTime() - 1), tz))) out.add(d);
  return out;
}

/** Working days between two dates (weekends and holidays excluded), 08 §4. */
export async function countLeaveDays(startDate: string, endDate: string, halfDay = false) {
  const { tz, weekendDays } = await hrSettings();
  const holidays = await holidayDates(startDate, endDate, tz);
  const days = eachDate(startDate, endDate).filter((d) => !weekendDays.includes(weekdayOf(d)) && !holidays.has(d)).length;
  return halfDay && days === 1 ? 0.5 : days;
}

/* ---------- shift expectation ---------- */

async function expectedFor(staffId: string, date: string, tz: string) {
  const staff = await StaffModel.findById(staffId).select('shiftId').lean();
  const shift = staff?.shiftId ? await ShiftModel.findById(staff.shiftId).lean() : await ShiftModel.findOne({ isDefault: true, isActive: true }).lean();
  const day = shift?.weekly.find((w) => w.weekday === weekdayOf(date));
  if (!day?.start || !day.end) return null;
  return { start: atLocal(date, day.start, tz), end: atLocal(date, day.end, tz), breakMinutes: day.breakMinutes ?? 0, grace: shift?.graceMinutes ?? 0 };
}

function compute(row: InstanceType<typeof AttendanceModel>, exp: Awaited<ReturnType<typeof expectedFor>>) {
  const inAt = row.checkIn?.at;
  const outAt = row.checkOut?.at;
  row.scheduledStart = exp?.start ?? undefined;
  row.scheduledEnd = exp?.end ?? undefined;
  row.lateMinutes = exp && inAt ? Math.max(0, Math.round((inAt.getTime() - exp.start.getTime()) / MIN) - exp.grace) : 0;
  row.earlyLeaveMinutes = exp && outAt ? Math.max(0, Math.round((exp.end.getTime() - outAt.getTime()) / MIN)) : 0;
  const worked = inAt && outAt ? Math.max(0, Math.round((outAt.getTime() - inAt.getTime()) / MIN) - (exp?.breakMinutes ?? 0)) : 0;
  row.workedMinutes = worked;
  const scheduled = exp ? Math.round((exp.end.getTime() - exp.start.getTime()) / MIN) - exp.breakMinutes : 0;
  row.overtimeMinutes = outAt && exp ? Math.max(0, worked - scheduled) : 0;
}

/* ---------- attendance (08 §3) ---------- */

export function attendanceDto(a: Record<string, unknown> & { _id: Types.ObjectId; __v?: number }) {
  return { ...a, id: String(a._id), version: a.__v ?? 0, staffId: String(a.staffId), _id: undefined, __v: undefined, clinicId: undefined, leaveRequestId: id(a.leaveRequestId), payrollRunId: id(a.payrollRunId), locked: Boolean(a.payrollRunId) };
}

export async function punch(auth: AuthContext, kind: 'in' | 'out', method: 'web' | 'qr', geo?: { lat: number; lng: number }) {
  if (!auth.staffId) throw ApiError.forbidden();
  const { tz, overtimeRequiresApproval } = await hrSettings();
  const now = new Date();
  const date = localDate(now, tz);
  let row = await AttendanceModel.findOne({ staffId: auth.staffId, date });
  if (kind === 'in') {
    if (row?.checkIn?.at) throw ApiError.conflict('ALREADY_CHECKED_IN', 'Already checked in today');
    row ??= new AttendanceModel({ staffId: auth.staffId, date });
    row.set('checkIn', { at: now, method, ...(geo ? { geo } : {}) });
    row.status = 'present';
  } else {
    if (!row?.checkIn?.at) throw ApiError.conflict('NOT_CHECKED_IN', 'Check in first');
    row.set('checkOut', { at: now, method, ...(geo ? { geo } : {}) });
  }
  if (row.payrollRunId) throw ApiError.conflict('ATTENDANCE_LOCKED', 'This day is already in a payroll');
  compute(row, await expectedFor(auth.staffId, date, tz));
  row.overtimeApproved = !overtimeRequiresApproval;
  await row.save();
  return attendanceDto(row.toObject() as never);
}

export async function myToday(auth: AuthContext) {
  if (!auth.staffId) return null;
  const { tz } = await hrSettings();
  const date = localDate(new Date(), tz);
  const [row, exp] = await Promise.all([AttendanceModel.findOne({ staffId: auth.staffId, date }).lean(), expectedFor(auth.staffId, date, tz)]);
  return { date, attendance: row ? attendanceDto(row as never) : null, expected: exp ? { start: localTime(exp.start, tz), end: localTime(exp.end, tz) } : null };
}

export async function listAttendance(auth: AuthContext, q: { from: string; to: string; staffId?: string }) {
  const own = scopeFor(auth, 'hr.attendance.read') === 'own';
  const filter: Record<string, unknown> = { date: { $gte: q.from, $lte: q.to } };
  if (own) filter.staffId = new Types.ObjectId(auth.staffId);
  else if (q.staffId) filter.staffId = new Types.ObjectId(q.staffId);
  const rows = await AttendanceModel.find(filter).sort({ date: 1 }).limit(5000).lean();
  return rows.map((r) => attendanceDto(r as never));
}

/** HR adjustment with a mandatory reason (audited). Payroll-locked rows can't change. */
export async function adjustAttendance(auth: AuthContext, b: { staffId: string; date: string; checkIn?: string | null; checkOut?: string | null; status?: 'present' | 'absent' | 'on_leave' | 'holiday' | 'weekend'; overtimeApproved?: boolean; reason: string }) {
  const { tz } = await hrSettings();
  let row = await AttendanceModel.findOne({ staffId: b.staffId, date: b.date });
  if (row?.payrollRunId) throw ApiError.conflict('ATTENDANCE_LOCKED', 'This day is already in a payroll');
  const before = row ? { checkIn: row.checkIn?.at, checkOut: row.checkOut?.at, status: row.status } : null;
  row ??= new AttendanceModel({ staffId: b.staffId, date: b.date });
  if (b.checkIn !== undefined) row.set('checkIn', b.checkIn ? { at: atLocal(b.date, b.checkIn, tz), method: 'manual' } : undefined);
  if (b.checkOut !== undefined) row.set('checkOut', b.checkOut ? { at: atLocal(b.date, b.checkOut, tz), method: 'manual' } : undefined);
  if (b.status) row.status = b.status;
  else if (row.checkIn?.at) row.status = 'present';
  compute(row, await expectedFor(b.staffId, b.date, tz));
  if (b.overtimeApproved !== undefined) row.overtimeApproved = b.overtimeApproved;
  row.adjustedBy = new Types.ObjectId(auth.userId);
  row.adjustmentReason = b.reason;
  await row.save();
  await recordAudit({ action: 'update', entity: 'attendance', entityId: row._id, before, after: { status: row.status }, reason: b.reason });
  return attendanceDto(row.toObject() as never);
}

/** Rotating QR for the reception screen: valid for the current and previous 60 s window. */
export function qrToken(clinicId: string, windowOffset = 0) {
  const w = Math.floor(Date.now() / 60_000) - windowOffset;
  return `${w}.${createHmac('sha256', env.JWT_ACCESS_SECRET).update(`att:${clinicId}:${w}`).digest('base64url').slice(0, 22)}`;
}
export function verifyQr(clinicId: string, token: string) {
  return token === qrToken(clinicId) || token === qrToken(clinicId, 1);
}

/** Nightly (08 §3): yesterday's rows for staff without a check-in → absent / on leave / holiday / weekend. */
export async function closeDay(date: string) {
  const { tz, weekendDays } = await hrSettings();
  const holidays = await holidayDates(date, date, tz);
  const staff = await StaffModel.find({ status: 'active' }).select('_id').lean();
  let created = 0;
  for (const s of staff) {
    if (await AttendanceModel.exists({ staffId: s._id, date })) continue;
    const leave = await LeaveRequestModel.findOne({ staffId: s._id, status: 'approved', startDate: { $lte: date }, endDate: { $gte: date } }).lean();
    const exp = await expectedFor(String(s._id), date, tz);
    const status = leave ? 'on_leave' : holidays.has(date) ? 'holiday' : weekendDays.includes(weekdayOf(date)) || !exp ? 'weekend' : 'absent';
    await AttendanceModel.create({ staffId: s._id, date, status, ...(leave ? { leaveRequestId: leave._id } : {}), scheduledStart: exp?.start, scheduledEnd: exp?.end });
    created += 1;
  }
  return created;
}

/* ---------- leave balances & requests (08 §4) ---------- */

async function serviceYears(staffId: string, onDate: string) {
  const s = await StaffModel.findById(staffId).select('employment.hireDate').lean();
  const hire = s?.employment?.hireDate;
  return hire ? (Date.parse(onDate) - Date.parse(hire)) / (365.25 * 86_400_000) : 0;
}

export async function ensureBalance(staffId: string, leaveTypeId: string, year: number) {
  const existing = await LeaveBalanceModel.findOne({ staffId, leaveTypeId, year });
  if (existing) return existing;
  const type = await LeaveTypeModel.findById(leaveTypeId).lean();
  if (!type) throw ApiError.validation([{ path: 'leaveTypeId', code: 'not_found' }]);
  const yrs = await serviceYears(staffId, `${year}-01-01`);
  const annual = type.seniorityRule?.afterYears && yrs >= type.seniorityRule.afterYears ? (type.seniorityRule.days ?? type.annualEntitlementDays) : type.annualEntitlementDays;
  const prev = await LeaveBalanceModel.findOne({ staffId, leaveTypeId, year: year - 1 }).lean();
  const carried = prev ? Math.min(type.carryOverMaxDays ?? 0, Math.max(0, (prev.entitled ?? 0) + (prev.carriedOver ?? 0) - (prev.taken ?? 0))) : 0;
  return LeaveBalanceModel.create({ staffId, leaveTypeId, year, entitled: annual, carriedOver: carried });
}

/** Monthly accrual: only months elapsed count (08 §4 accrual: monthly). */
function available(b: { entitled?: number | null; carriedOver?: number | null; taken?: number | null; pending?: number | null }, type: { accrual?: string | null }, month: number) {
  const entitled = type.accrual === 'monthly' ? Math.floor(((b.entitled ?? 0) * month) / 12 * 2) / 2 : (b.entitled ?? 0);
  return entitled + (b.carriedOver ?? 0) - (b.taken ?? 0) - (b.pending ?? 0);
}

export async function balancesFor(staffId: string, year: number) {
  const types = await LeaveTypeModel.find({ isActive: true }).lean();
  const month = new Date().getUTCFullYear() === year ? new Date().getUTCMonth() + 1 : 12;
  const out = [];
  for (const t of types) {
    const b = await ensureBalance(staffId, String(t._id), year);
    out.push({ leaveTypeId: String(t._id), code: t.code, name: t.name, systemKey: t.systemKey, paid: t.paid, year, entitled: b.entitled, carriedOver: b.carriedOver, taken: b.taken, pending: b.pending, remaining: t.paid ? available(b, t, month) : null });
  }
  return out;
}

export function leaveDto(r: Record<string, unknown> & { _id: Types.ObjectId; __v?: number }, staffName?: string) {
  return { ...r, id: String(r._id), version: r.__v ?? 0, _id: undefined, __v: undefined, clinicId: undefined, staffId: String(r.staffId), leaveTypeId: String(r.leaveTypeId), staffName, attachmentFileId: id(r.attachmentFileId), scheduleExceptionId: id(r.scheduleExceptionId) };
}

export async function listLeave(auth: AuthContext, q: { status?: string; staffId?: string; from?: string; to?: string }) {
  const own = scopeFor(auth, 'hr.leave.read') === 'own' && !scopeFor(auth, 'hr.leave.approve');
  const filter: Record<string, unknown> = {};
  if (own) filter.staffId = new Types.ObjectId(auth.staffId);
  else if (q.staffId) filter.staffId = new Types.ObjectId(q.staffId);
  if (q.status) filter.status = q.status;
  if (q.from) filter.endDate = { $gte: q.from };
  if (q.to) filter.startDate = { $lte: q.to };
  const rows = await LeaveRequestModel.find(filter).sort({ startDate: -1 }).limit(500).lean();
  const names = new Map((await StaffModel.find({ _id: { $in: rows.map((r) => r.staffId) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
  return rows.map((r) => leaveDto(r as never, names.get(String(r.staffId))));
}

export async function requestLeave(auth: AuthContext, b: { staffId?: string; leaveTypeId: string; startDate: string; endDate: string; halfDay?: boolean; reason?: string; attachmentFileId?: string }) {
  const staffId = b.staffId ?? auth.staffId;
  if (!staffId) throw ApiError.forbidden();
  if (staffId !== auth.staffId && !(auth.isOwner || scopeFor(auth, 'hr.leave.approve'))) throw ApiError.forbidden();
  if (b.endDate < b.startDate) throw ApiError.validation([{ path: 'endDate', code: 'end_before_start' }]);
  const type = await LeaveTypeModel.findById(b.leaveTypeId).lean();
  if (!type || !type.isActive) throw ApiError.validation([{ path: 'leaveTypeId', code: 'not_found' }]);
  const days = await countLeaveDays(b.startDate, b.endDate, b.halfDay);
  if (days <= 0) throw ApiError.validation([{ path: 'endDate', code: 'out_of_range' }]);
  if (type.requiresAttachment && days > 1 && !b.attachmentFileId) throw ApiError.conflict('LEAVE_ATTACHMENT_REQUIRED', 'Attach a document for this leave');
  const overlap = await LeaveRequestModel.exists({ staffId, status: { $in: ['pending', 'approved'] }, startDate: { $lte: b.endDate }, endDate: { $gte: b.startDate } });
  if (overlap) throw ApiError.conflict('LEAVE_OVERLAP', 'Another request covers these dates');
  const year = Number(b.startDate.slice(0, 4));
  const bal = await ensureBalance(staffId, b.leaveTypeId, year);
  if (type.paid && available(bal, type, Math.max(Number(b.startDate.slice(5, 7)), new Date().getUTCMonth() + 1)) < days) {
    throw ApiError.conflict('LEAVE_INSUFFICIENT_BALANCE', 'Not enough leave balance', { remaining: available(bal, type, 12) });
  }
  const doc = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const [r] = await LeaveRequestModel.create([{ ...b, staffId, days, reason: b.reason ?? '' }], { session: s });
    if (type.paid) await LeaveBalanceModel.updateOne({ _id: bal._id }, { $inc: { pending: days } }, { session: s });
    return r!;
  });
  await recordAudit({ action: 'create', entity: 'leaveRequest', entityId: doc._id, after: { days, from: b.startDate, to: b.endDate } });
  return leaveDto(doc.toObject() as never);
}

/** Approve (08 §4): balance moves pending → taken; dentists get time off on the calendar. */
export async function decideLeave(auth: AuthContext, requestId: string, to: 'approved' | 'rejected', b: { comment?: string; confirmConflicts?: boolean }) {
  const req = await LeaveRequestModel.findById(requestId);
  if (!req) throw ApiError.notFound();
  if (req.status !== 'pending') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Only pending requests can be decided');
  if (String(req.staffId) === auth.staffId && !auth.isOwner) throw ApiError.forbidden('FORBIDDEN', 'You cannot approve your own leave');
  const type = await LeaveTypeModel.findById(req.leaveTypeId).lean();
  const staff = await StaffModel.findById(req.staffId).select('staffType name').lean();
  const { tz } = await hrSettings();
  const start = startOfLocalDay(req.startDate, tz);
  const end = startOfLocalDay(addDays(req.endDate, 1), tz);
  const conflicts = to === 'approved' && staff && ['dentist', 'hygienist'].includes(staff.staffType)
    ? await AppointmentModel.find({ dentistId: req.staffId, start: { $gte: start, $lt: end }, status: { $in: ['scheduled', 'confirmed'] } }).select('number start patientId').lean()
    : [];
  if (conflicts.length && !b.confirmConflicts) {
    throw ApiError.conflict('LEAVE_OVERLAP', 'The dentist has booked appointments in this range', { appointments: conflicts.map((c) => ({ id: String(c._id), number: c.number, start: c.start })) });
  }
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    req.status = to;
    req.set('decision', { byStaffId: auth.staffId, byUserId: auth.userId, at: new Date(), comment: b.comment ?? '' });
    const year = Number(req.startDate.slice(0, 4));
    if (type?.paid) {
      await LeaveBalanceModel.updateOne({ staffId: req.staffId, leaveTypeId: req.leaveTypeId, year }, { $inc: { pending: -req.days, ...(to === 'approved' ? { taken: req.days } : {}) } }, { session: s });
    }
    if (to === 'approved' && staff && ['dentist', 'hygienist'].includes(staff.staffType)) {
      const [ex] = await ScheduleExceptionModel.create([{ staffId: req.staffId, type: 'time_off', start, end, reason: type?.code ?? 'leave', leaveRequestId: req._id }], { session: s });
      req.scheduleExceptionId = ex!._id;
    }
    await req.save({ session: s });
  });
  if (to === 'approved') await emit('leave.approved', { clinicId: String(currentClinicId()), leaveRequestId: requestId });
  await recordAudit({ action: to === 'approved' ? 'approve' : 'status_change', entity: 'leaveRequest', entityId: requestId, after: { status: to, conflicts: conflicts.length } });
  return { ...leaveDto(req.toObject() as never, staff?.name), conflicts: conflicts.map((c) => ({ id: String(c._id), number: c.number, start: c.start })) };
}

export async function cancelLeave(auth: AuthContext, requestId: string) {
  const req = await LeaveRequestModel.findById(requestId);
  if (!req) throw ApiError.notFound();
  const isOwnerOfRequest = String(req.staffId) === auth.staffId;
  const isHr = auth.isOwner || Boolean(scopeFor(auth, 'hr.leave.approve'));
  if (!isOwnerOfRequest && !isHr) throw ApiError.notFound();
  const { tz } = await hrSettings();
  const today = localDate(new Date(), tz);
  if (!['pending', 'approved'].includes(req.status) || (req.status === 'approved' && req.startDate <= today && !isHr)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'This request can no longer be cancelled');
  const type = await LeaveTypeModel.findById(req.leaveTypeId).lean();
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    const year = Number(req.startDate.slice(0, 4));
    if (type?.paid) await LeaveBalanceModel.updateOne({ staffId: req.staffId, leaveTypeId: req.leaveTypeId, year }, { $inc: req.status === 'pending' ? { pending: -req.days } : { taken: -req.days } }, { session: s });
    if (req.scheduleExceptionId) await ScheduleExceptionModel.deleteOne({ _id: req.scheduleExceptionId }, { session: s });
    req.status = 'cancelled';
    await req.save({ session: s });
  });
  await recordAudit({ action: 'status_change', entity: 'leaveRequest', entityId: requestId, after: { status: 'cancelled' } });
  return leaveDto(req.toObject() as never);
}

