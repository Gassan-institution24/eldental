import { Router } from 'express';
import { Schema, Types, model } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import { AuditLogModel } from '@/core/audit/auditLog.model';
import type { AuthContext } from '@/core/auth/auth.types';
import { crudRouter, updateOf } from '@/core/crud/crudRouter';
import { withTransaction } from '@/core/db/transaction';
import { applyBase } from '@/core/db/plugins';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { ActivityLogModel, ClientIssueModel } from '@/core/logging/telemetry.models';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { currentClinicId, tenantField } from '@/core/tenancy/tenantPlugin';
import { body, query, validate } from '@/core/validation/validate';
import { AccountModel } from '@/modules/accounting/accounting.models';
import { clinicToday, loadAccountMap, postEntry } from '@/modules/accounting/journal.service';
import { InvoiceModel, PaymentModel } from '@/modules/billing/billing.models';
import { dues } from '@/modules/billing/invoice.service';
import { ClinicalNoteModel, LabOrderModel, PerformedProcedureModel, TreatmentPlanModel } from '@/modules/clinical/clinical.models';
import { LeaveRequestModel } from '@/modules/hr/hr.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { AppointmentModel, RecallModel } from '@/modules/scheduling/scheduling.models';
import { loadClinic } from '@/modules/scheduling/scheduling.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, localDate, startOfLocalDay } from '@/shared/dates';
import { mulFraction, sum } from '@/shared/money';
import { dateOnly, entityName, freeText, money, objectId, optional } from '@/shared/validation/fields';

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
    const procs = await PerformedProcedureModel.find({ status: 'completed', performedAt: range, ...ownDentist }).select('unitPrice quantity discount performedAt').lean();
    const value = (p: (typeof procs)[number]) => (p.unitPrice ?? 0) * (p.quantity ?? 1) - (p.discount ?? 0);
    out.production = { today: sum(procs.filter((p) => p.performedAt >= dayStart).map(value)), month: sum(procs.map(value)) };
  }
  if (can('billing.payment.read')) {
    const pays = await PaymentModel.find({ date: { $gte: monthStart, $lte: today }, status: { $ne: 'void' } }).select('amount refunded date').lean();
    const net = (p: (typeof pays)[number]) => p.amount - (p.refunded ?? 0);
    out.collections = { today: sum(pays.filter((p) => p.date === today).map(net)), month: sum(pays.map(net)) };
  }
  if (can('billing.invoice.read')) {
    const open = await InvoiceModel.find({ type: 'invoice', status: { $in: ['issued', 'partially_paid'] } }).lean();
    out.receivables = { patients: sum(open.map((i) => dues(i).patientDue)), insurance: sum(open.map((i) => dues(i).insuranceDue)), overdue: sum(open.filter((i) => (i.dueDate ?? today) < today).map((i) => dues(i).patientDue)) };
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
  if (can('billing.invoice.read')) todo.draftInvoices = await InvoiceModel.countDocuments({ status: 'draft' });
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

/* ---------- inventory (03 §10) ---------- */

const itemSchema = new Schema(
  {
    clinicId: tenantField,
    sku: { type: String, default: '' },
    name: { type: String, required: true },
    searchName: String,
    unit: { type: String, default: 'pcs' },
    category: { type: String, default: '' },
    reorderLevel: { type: Number, default: 0 },
    quantityOnHand: { type: Number, default: 0 },
    averageCost: { type: Number, default: 0 },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'inventoryItems' },
);
applyBase(itemSchema);
itemSchema.index({ clinicId: 1, name: 1 });
export const InventoryItemModel = model('InventoryItem', itemSchema);

const movementSchema = new Schema(
  {
    clinicId: tenantField,
    itemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    type: { type: String, enum: ['purchase', 'consumption', 'adjustment', 'return'], required: true },
    quantity: { type: Number, required: true },
    unitCost: { type: Number, default: 0 },
    date: { type: String, required: true },
    note: { type: String, default: '' },
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    byUserId: Schema.Types.ObjectId,
  },
  { timestamps: true, collection: 'stockMovements' },
);
applyBase(movementSchema, { softDelete: false });
movementSchema.index({ clinicId: 1, itemId: 1, date: -1 });
export const StockMovementModel = model('StockMovement', movementSchema);

const itemShape = {
  sku: optional(freeText(40)),
  name: entityName({ max: 120 }),
  unit: optional(freeText(20)),
  category: optional(freeText(60)),
  reorderLevel: z.number().min(0).max(1_000_000).default(0),
  supplierId: optional(objectId()),
  isActive: z.boolean().default(true),
};
insightsRouter.use(
  crudRouter({
    path: '/inventory-items',
    entity: 'inventoryItem',
    tag: 'inventory',
    model: InventoryItemModel as never,
    perms: { read: 'inventory.item.read', create: 'inventory.item.manage' },
    createSchema: z.object(itemShape).strict(),
    updateSchema: updateOf(itemShape),
    filters: { low: z.enum(['true', 'false']).optional() },
    buildFilter: (q) => ({ ...(q.includeInactive === 'true' ? {} : { isActive: true }), ...(q.low === 'true' ? { $expr: { $lte: ['$quantityOnHand', '$reorderLevel'] } } : {}) }),
    sortable: ['name', 'quantityOnHand', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => [b.name, b.sku].filter(Boolean).join(' '),
    unpaged: true,
  }),
);

/**
 * Stock movement with average costing. Purchases: Dr INVENTORY / Cr paid-from account.
 * Consumption & negative adjustments: Dr SUPPLIES_COST / Cr INVENTORY at average cost.
 */
const movementBody = z
  .object({ itemId: objectId(), type: z.enum(['purchase', 'consumption', 'adjustment', 'return']), quantity: z.number().refine((v) => v !== 0 && Math.abs(v) <= 1_000_000, { message: 'invalid_quantity' }), unitCost: money().optional(), paidFromAccountId: optional(objectId()), date: optional(dateOnly()), note: optional(freeText(300)) })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'purchase' && (!v.unitCost || !v.paidFromAccountId)) ctx.addIssue({ code: 'custom', path: [v.unitCost ? 'paidFromAccountId' : 'unitCost'], message: 'required' });
    if (v.type !== 'adjustment' && v.quantity < 0) ctx.addIssue({ code: 'custom', path: ['quantity'], message: 'must_be_positive' });
  });
insightsRouter.post(
  '/stock-movements',
  authorize('inventory.stock.adjust'),
  validate({ body: movementBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, movementBody);
    const date = b.date ?? (await clinicToday());
    const result = await withTransaction(async (session) => {
      const s = session ?? undefined;
      const item = await InventoryItemModel.findById(b.itemId).session(s ?? null);
      if (!item) throw ApiError.notFound();
      const delta = b.type === 'purchase' || b.type === 'return' ? b.quantity : b.type === 'consumption' ? -b.quantity : b.quantity;
      if ((item.quantityOnHand ?? 0) + delta < 0) throw ApiError.conflict('INSUFFICIENT_STOCK', 'Not enough stock', { onHand: item.quantityOnHand });
      const accounts = await loadAccountMap(s);
      let value = 0;
      let lines: { accountId: string; debit: number; credit: number; description?: string }[] = [];
      if (b.type === 'purchase') {
        const paidFrom = await AccountModel.findById(b.paidFromAccountId).lean();
        if (!paidFrom || paidFrom.isGroup) throw ApiError.validation([{ path: 'paidFromAccountId', code: 'invalid_option' }]);
        value = Math.round((b.unitCost ?? 0) * b.quantity);
        const totalQty = (item.quantityOnHand ?? 0) + b.quantity;
        item.averageCost = totalQty > 0 ? mulFraction((item.averageCost ?? 0) * (item.quantityOnHand ?? 0) + value, 1, Math.round(totalQty)) : (b.unitCost ?? 0);
        lines = [{ accountId: accounts('INVENTORY'), debit: value, credit: 0, description: item.name }, { accountId: String(paidFrom._id), debit: 0, credit: value }];
      } else {
        value = Math.round(Math.abs(delta) * (item.averageCost ?? 0));
        const out = delta < 0;
        if (value > 0) lines = out ? [{ accountId: accounts('SUPPLIES_COST'), debit: value, credit: 0, description: item.name }, { accountId: accounts('INVENTORY'), debit: 0, credit: value }] : [{ accountId: accounts('INVENTORY'), debit: value, credit: 0, description: item.name }, { accountId: accounts('SUPPLIES_COST'), debit: 0, credit: value }];
      }
      item.quantityOnHand = (item.quantityOnHand ?? 0) + delta;
      await item.save({ session: s });
      const [mv] = await StockMovementModel.create([{ itemId: item._id, type: b.type, quantity: delta, unitCost: b.type === 'purchase' ? (b.unitCost ?? 0) : (item.averageCost ?? 0), date, note: b.note ?? '', byUserId: req.auth!.userId }], { session: s });
      if (lines.length) {
        const je = await postEntry(req.auth!, { date, source: 'expense', sourceId: mv!._id, memo: `Stock ${b.type}: ${item.name}`, lines: lines.map((l) => ({ ...l, description: l.description ?? '' })) }, s);
        mv!.journalEntryId = je._id;
        await mv!.save({ session: s });
      }
      return { item, mv: mv! };
    });
    await recordAudit({ action: 'create', entity: 'stockMovement', entityId: result.mv._id, after: { item: String(result.item._id), quantity: result.mv.quantity } });
    if ((result.item.quantityOnHand ?? 0) <= (result.item.reorderLevel ?? 0) && result.item.reorderLevel) {
      const { notify, usersOf } = await import('@/modules/notifications/notifications');
      const clinicId = String(currentClinicId());
      await notify(clinicId, await usersOf(clinicId, { owners: true, staffTypes: ['manager', 'receptionist'] }), { type: 'low_stock', titleKey: 'notifications:types.low_stock', bodyKey: 'notifications:msg.lowStock', params: { item: result.item.name, qty: result.item.quantityOnHand ?? 0 }, link: '/clinic/inventory' });
    }
    created(res, { item: { id: String(result.item._id), quantityOnHand: result.item.quantityOnHand, averageCost: result.item.averageCost }, movement: { id: String(result.mv._id), quantity: result.mv.quantity } });
  }),
);
const movementQuery = z.object({ itemId: optional(objectId()) }).strict();
insightsRouter.get('/stock-movements', authorize('inventory.item.read'), validate({ query: movementQuery }), asyncHandler(async (req, res) => {
  const q = query(req, movementQuery);
  const rows = await StockMovementModel.find(q.itemId ? { itemId: q.itemId } : {}).sort({ createdAt: -1 }).limit(300).lean();
  ok(res, rows.map((r) => ({ id: String(r._id), itemId: String(r.itemId), type: r.type, quantity: r.quantity, unitCost: r.unitCost, date: r.date, note: r.note })));
}));

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

