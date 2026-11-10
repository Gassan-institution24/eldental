import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import type { AuthContext } from '@/core/auth/auth.types';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { ok } from '@/core/http/response';
import { ActivityLogModel, ClientIssueModel } from '@/core/logging/telemetry.models';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { currentClinicId } from '@/core/tenancy/tenantPlugin';
import { query, validate } from '@/core/validation/validate';
import { InvoiceModel, PaymentModel } from '@/modules/billing/billing.models';
import { doctorInvoiceFilter, ownDoctorOf, shareOf } from '@/modules/billing/attribution';
import { dues } from '@/modules/billing/invoice.service';
import { ClinicalNoteModel, LabOrderModel, PerformedProcedureModel, TreatmentPlanModel } from '@/modules/clinical/clinical.models';
import { LeaveRequestModel } from '@/modules/hr/hr.models';
import { InventoryItemModel } from '@/modules/inventory/inventory.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { AppointmentModel, RecallModel } from '@/modules/scheduling/scheduling.models';
import { loadClinic } from '@/modules/scheduling/scheduling.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, localDate, startOfLocalDay } from '@/shared/dates';
import { sum } from '@/shared/money';
import { dateOnly, objectId, optional } from '@/shared/validation/fields';

export const insightsRouter = Router();
const cid = () => new Types.ObjectId(currentClinicId());

/* ---------- dashboard KPIs (Phase 10) ---------- */

/** Sections appear only when the user may see them; dentists with `own` scope get their own numbers. */
async function dashboard(auth: AuthContext) {
  const clinic = await loadClinic();
  const tz = clinic.timezone ?? 'Asia/Amman';
  const today = localDate(new Date(), tz);
  const monthStart = `${today.slice(0, 7)}-01`;
  const dayStart = startOfLocalDay(today, tz);
  const dayEnd = startOfLocalDay(addDays(today, 1), tz);
  const can = (p: string) => auth.isOwner || Boolean(scopeFor(auth, p));
  const ownDentist = scopeFor(auth, 'scheduling.appointment.read') === 'own' && auth.staffId ? { dentistId: new Types.ObjectId(auth.staffId) } : {};
  const out: Record<string, unknown> = { date: today };

  if (can('scheduling.appointment.read')) {
    const appts = await AppointmentModel.find({ start: { $gte: dayStart, $lt: dayEnd }, ...ownDentist }).select('status').lean();
    const by = (s: string[]) => appts.filter((a) => s.includes(a.status)).length;
    const since = startOfLocalDay(addDays(today, -30), tz);
    const [past, noShows] = await Promise.all([
      AppointmentModel.countDocuments({ start: { $gte: since, $lt: dayStart }, status: { $in: ['completed', 'no_show'] }, ...ownDentist }),
      AppointmentModel.countDocuments({ start: { $gte: since, $lt: dayStart }, status: 'no_show', ...ownDentist }),
    ]);
    out.today = { total: appts.filter((a) => a.status !== 'cancelled').length, waiting: by(['arrived']), inChair: by(['in_chair']), completed: by(['completed']), upcoming: by(['scheduled', 'confirmed']), noShowRate30d: past ? Math.round((noShows / past) * 1000) / 10 : 0 };
    out.recallsDue = await RecallModel.countDocuments({ status: { $in: ['due', 'upcoming'] }, dueDate: { $lte: addDays(today, 14) } });
  }
  if (can('reports.production.read') || can('accounting.report.read') || auth.isOwner) {
    const range = { $gte: startOfLocalDay(monthStart, tz), $lt: dayEnd };
    const meProd = ownDoctorOf(auth, 'reports.production.read', 'accounting.report.read');
    const procs = await PerformedProcedureModel.find({ status: 'completed', performedAt: range, ...(meProd ? { dentistId: new Types.ObjectId(meProd) } : {}) }).select('unitPrice quantity discount performedAt').lean();
    const value = (p: (typeof procs)[number]) => (p.unitPrice ?? 0) * (p.quantity ?? 1) - (p.discount ?? 0);
    out.production = { today: sum(procs.filter((p) => p.performedAt >= dayStart).map(value)), month: sum(procs.map(value)) };
  }
  if (can('billing.payment.read')) {
    const pays = await PaymentModel.find({ date: { $gte: monthStart, $lte: today }, status: { $ne: 'void' } }).select('amount refunded date').lean();
    const net = (p: (typeof pays)[number]) => p.amount - (p.refunded ?? 0);
    out.collections = { today: sum(pays.filter((p) => p.date === today).map(net)), month: sum(pays.map(net)) };
  }
  // Own scope (G3): only invoices with my work, and only my share of what is owed (09 §8.1).
  const meInv = ownDoctorOf(auth, 'billing.invoice.read', 'accounting.report.read');
  const invScope = meInv ? doctorInvoiceFilter(meInv) : {};
  if (can('billing.invoice.read')) {
    const open = await InvoiceModel.find({ type: 'invoice', status: { $in: ['issued', 'partially_paid'] }, ...invScope }).lean();
    const part = (i: (typeof open)[number], amount: number) => (meInv ? shareOf(amount, i, meInv) : amount);
    out.receivables = { patients: sum(open.map((i) => part(i, dues(i).patientDue))), insurance: sum(open.map((i) => part(i, dues(i).insuranceDue))), overdue: sum(open.filter((i) => (i.dueDate ?? today) < today).map((i) => part(i, dues(i).patientDue))), scope: meInv ? 'own' : 'all' };
  }
  if (can('patients.patient.read')) {
    out.newPatients = { month: await PatientModel.countDocuments({ createdAt: { $gte: startOfLocalDay(monthStart, tz) } }) };
  }
  if (can('clinical.treatmentPlan.read')) {
    const since = startOfLocalDay(addDays(today, -90), tz);
    const plans = await TreatmentPlanModel.find({ presentedAt: { $gte: since }, ...(scopeFor(auth, 'clinical.treatmentPlan.read') === 'own' ? { dentistId: new Types.ObjectId(auth.staffId) } : {}) }).select('status items').lean();
    const val = (p: (typeof plans)[number], f?: (s: string) => boolean) => sum(p.items.filter((i) => !f || f(i.status)).map((i) => (i.unitPrice ?? 0) * (i.quantity ?? 1) - (i.discount ?? 0)));
    const presented = sum(plans.map((p) => val(p)));
    const accepted = sum(plans.map((p) => val(p, (s) => ['accepted', 'scheduled', 'completed'].includes(s))));
    out.planConversion = { presented, accepted, percent: presented ? Math.round((accepted * 1000) / presented) / 10 : 0 };
  }
  const todo: Record<string, number> = {};
  if (auth.staffId && can('clinical.note.write')) todo.unsignedNotes = await ClinicalNoteModel.countDocuments({ authorId: auth.staffId, signedAt: null, createdAt: { $lt: new Date(Date.now() - 86_400_000) } });
  if (can('hr.leave.approve')) todo.pendingLeave = await LeaveRequestModel.countDocuments({ status: 'pending' });
  if (can('clinical.labOrder.read')) todo.labDueSoon = await LabOrderModel.countDocuments({ status: { $in: ['sent', 'in_progress', 'remake'] }, dueDate: { $lte: addDays(today, 2) }, ...ownDentist });
  if (can('inventory.item.read')) todo.lowStock = await InventoryItemModel.countDocuments({ isActive: true, $expr: { $lte: ['$quantityOnHand', '$reorderLevel'] } });
  if (can('billing.invoice.read')) todo.draftInvoices = await InvoiceModel.countDocuments({ status: 'draft', ...invScope });
  out.todo = todo;
  return out;
}

insightsRouter.get('/dashboard', authorize.self('staff'), asyncHandler(async (req, res) => {
  if (!req.auth!.clinicId) throw ApiError.forbidden('CLINIC_SELECTION_REQUIRED', 'Select a clinic first');
  ok(res, await dashboard(req.auth!));
}));

/* ---------- operational report ---------- */

const rangeQuery = z.object({ from: dateOnly(), to: dateOnly() }).strict();
insightsRouter.get(
  '/reports/operational',
  authorize('reports.operational.read'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, rangeQuery);
    const clinic = await loadClinic();
    const tz = clinic.timezone ?? 'Asia/Amman';
    const own = scopeFor(req.auth!, 'reports.operational.read') === 'own' && req.auth!.staffId ? { dentistId: new Types.ObjectId(req.auth!.staffId) } : {};
    const appts = await AppointmentModel.find({ start: { $gte: startOfLocalDay(q.from, tz), $lt: startOfLocalDay(addDays(q.to, 1), tz) }, ...own }).select('status dentistId source start end').lean();
    const staff = new Map((await StaffModel.find({}).select('name').lean()).map((s) => [String(s._id), s.name]));
    const statuses: Record<string, number> = {};
    const sources: Record<string, number> = {};
    const perDentist = new Map<string, { dentistId: string; name: string; total: number; completed: number; noShow: number; cancelled: number; bookedMinutes: number }>();
    for (const a of appts) {
      statuses[a.status] = (statuses[a.status] ?? 0) + 1;
      sources[a.source ?? 'staff'] = (sources[a.source ?? 'staff'] ?? 0) + 1;
      const k = String(a.dentistId);
      const d = perDentist.get(k) ?? { dentistId: k, name: staff.get(k) ?? '', total: 0, completed: 0, noShow: 0, cancelled: 0, bookedMinutes: 0 };
      d.total += 1;
      if (a.status === 'completed') d.completed += 1;
      if (a.status === 'no_show') d.noShow += 1;
      if (a.status === 'cancelled') d.cancelled += 1;
      else d.bookedMinutes += Math.round((a.end.getTime() - a.start.getTime()) / 60_000);
      perDentist.set(k, d);
    }
    const newPatients = await PatientModel.countDocuments({ createdAt: { $gte: startOfLocalDay(q.from, tz), $lt: startOfLocalDay(addDays(q.to, 1), tz) } });
    const done = (statuses.completed ?? 0) + (statuses.no_show ?? 0);
    ok(res, { from: q.from, to: q.to, total: appts.length, statuses, sources, newPatients, noShowRate: done ? Math.round(((statuses.no_show ?? 0) / done) * 1000) / 10 : 0, dentists: [...perDentist.values()].sort((a, b) => b.total - a.total) });
  }),
);

/* ---------- clinic logs (15) ---------- */

const logQuery = z.object({ kind: z.enum(['audit', 'activity', 'issues']).default('audit'), entity: optional(z.string().max(40)), userId: optional(objectId()), limit: z.coerce.number().int().min(1).max(200).default(100) }).strict();
insightsRouter.get(
  '/logs',
  authorize('logs.audit.read', 'logs.activity.read', 'logs.issues.read'),
  validate({ query: logQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, logQuery);
    const auth = req.auth!;
    const perm = q.kind === 'audit' ? 'logs.audit.read' : q.kind === 'activity' ? 'logs.activity.read' : 'logs.issues.read';
    const scope = auth.isOwner ? 'all' : scopeFor(auth, perm);
    if (!scope) throw ApiError.forbidden('FORBIDDEN', 'Missing permission', { permission: perm });
    const base: Record<string, unknown> = { clinicId: cid() };
    if (scope === 'own') base[q.kind === 'audit' ? 'actorUserId' : 'userId'] = new Types.ObjectId(auth.userId);
    else if (q.userId) base[q.kind === 'audit' ? 'actorUserId' : 'userId'] = new Types.ObjectId(q.userId);
    if (q.kind === 'audit') {
      const rows = await AuditLogModel.find({ ...base, ...(q.entity ? { entity: q.entity } : {}) }).sort({ at: -1 }).limit(q.limit).lean();
      return ok(res, rows.map((r) => ({ id: String(r._id), at: r.at, actorName: r.actorName, action: r.action, entity: r.entity, entityId: r.entityId, summary: r.summary, reason: r.reason })));
    }
    if (q.kind === 'activity') {
      const rows = await ActivityLogModel.find(base).sort({ at: -1 }).limit(q.limit).lean();
      return ok(res, rows.map((r) => ({ ...r, id: String(r._id), _id: undefined, clinicId: undefined })));
    }
    const rows = await ClientIssueModel.find(base).sort({ lastAt: -1 }).limit(q.limit).lean();
    ok(res, rows.map((r) => ({ ...r, id: String(r._id), _id: undefined, clinicId: undefined })));
  }),
);

