import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import { crudRouter, defaultDto, updateOf } from '@/core/crud/crudRouter';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, noContent, ok, pageMeta } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { body, params, query, validate } from '@/core/validation/validate';
import { ownDoctorOf } from '@/modules/billing/attribution';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { pageQuery, skipOf } from '@/shared/pagination';
import { dateOnly, email, entityName, enumOf, freeText, money, objectId, optional, phone, requiredText, taxNumber } from '@/shared/validation/fields';
import { toSearchName } from '@/shared/validation/normalize';
import { ACCOUNT_TYPES, AccountModel, ExpenseModel, FiscalPeriodModel, FiscalYearModel, JournalEntryModel, SupplierBillModel, SupplierModel, SupplierPaymentModel } from './accounting.models';
import { clinicTimezone, clinicToday, createManualDraft, postManual, reverseEntry } from './journal.service';
import * as ops from './operations.service';
import * as rep from './reports.service';
import { normalBalanceOf } from './seed/chartOfAccounts.jo';

export const accountingRouter = Router();
const idParams = z.object({ id: objectId() }).strict();
const id = (v: unknown) => (v ? String(v) : undefined);

/* ---------- chart of accounts ---------- */

const accountDto = (a: Record<string, unknown> & { _id: Types.ObjectId }) => ({ ...defaultDto(a as never), parentId: id(a.parentId) });

accountingRouter.get(
  '/accounts',
  authorize('accounting.account.read', 'billing.payment.create', 'accounting.expense.create'),
  asyncHandler(async (_req, res) => {
    const rows = await AccountModel.find({}).sort({ code: 1 }).lean();
    ok(res, rows.map((r) => accountDto(r as never)));
  }),
);

const accountBody = z
  .object({ code: z.string().trim().regex(/^\d{3,8}$/, { message: 'invalid_format' }), name: entityName({ max: 120 }), type: z.enum(ACCOUNT_TYPES), subtype: optional(z.string().max(40)), parentId: optional(objectId()), isGroup: z.boolean().default(false), isActive: z.boolean().default(true) })
  .strict();
const accountUpdateBody = z.object({ code: z.string().trim().regex(/^\d{3,8}$/, { message: 'invalid_format' }).optional(), name: entityName({ max: 120 }).nullable().optional(), parentId: objectId().nullable().optional(), isActive: z.boolean().optional(), version: z.number().int().min(0).optional() }).strict();

accountingRouter.post(
  '/accounts',
  authorize('accounting.account.manage'),
  validate({ body: accountBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, accountBody);
    if (await AccountModel.exists({ code: b.code })) throw ApiError.validation([{ path: 'code', code: 'duplicate' }]);
    if (b.parentId) {
      const parent = await AccountModel.findById(b.parentId).lean();
      if (!parent?.isGroup || parent.type !== b.type) throw ApiError.validation([{ path: 'parentId', code: 'invalid_option' }]);
    }
    const a = await AccountModel.create({ ...b, searchName: toSearchName(`${b.code} ${b.name}`), normalBalance: normalBalanceOf(b.type) });
    await recordAudit({ action: 'create', entity: 'account', entityId: a._id, after: { code: b.code } });
    created(res, accountDto(a.toObject() as never));
  }),
);

accountingRouter.patch(
  '/accounts/:id',
  authorize('accounting.account.manage'),
  validate({ params: idParams, body: accountUpdateBody }),
  asyncHandler(async (req, res) => {
    const a = await AccountModel.findById(params(req, idParams).id);
    if (!a) throw ApiError.notFound();
    const b = body(req, accountUpdateBody);
    if (b.code && b.code !== a.code && (await AccountModel.exists({ code: b.code }))) throw ApiError.validation([{ path: 'code', code: 'duplicate' }]);
    if (b.isActive === false && a.isSystem) throw ApiError.conflict('ACCOUNT_SYSTEM', 'System accounts stay active');
    for (const k of ['code', 'name', 'isActive'] as const) if (b[k] !== undefined) a.set(k, b[k]);
    if (b.parentId !== undefined) a.set('parentId', b.parentId ?? undefined);
    await a.save();
    await recordAudit({ action: 'update', entity: 'account', entityId: a._id });
    ok(res, accountDto(a.toObject() as never));
  }),
);

accountingRouter.delete(
  '/accounts/:id',
  authorize('accounting.account.manage'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const a = await AccountModel.findById(params(req, idParams).id);
    if (!a) throw ApiError.notFound();
    if (a.isSystem) throw ApiError.conflict('ACCOUNT_SYSTEM', 'System-mapped accounts cannot be deleted');
    if ((await JournalEntryModel.exists({ 'lines.accountId': a._id })) || (await AccountModel.exists({ parentId: a._id }))) throw ApiError.conflict('ACCOUNT_IN_USE', 'The account has postings or children');
    await a.deleteOne();
    await recordAudit({ action: 'delete', entity: 'account', entityId: a._id });
    noContent(res);
  }),
);

/* ---------- journals ---------- */

const journalListQuery = z.object({ ...pageQuery, source: optional(z.string().max(30)), from: optional(dateOnly()), to: optional(dateOnly()), accountId: optional(objectId()), status: z.enum(['draft', 'posted', 'reversed']).optional() }).strict();
const journalDto = (e: Record<string, unknown> & { _id: Types.ObjectId; lines?: Record<string, unknown>[] }) => ({
  id: String(e._id),
  number: e.number,
  date: e.date,
  source: e.source,
  sourceId: id(e.sourceId),
  memo: e.memo ?? '',
  total: e.total,
  status: e.status,
  reversalOfId: id(e.reversalOfId),
  reversedById: id(e.reversedById),
  postedAt: e.postedAt,
  lines: (e.lines ?? []).map((l) => ({ accountId: String(l.accountId), debit: l.debit, credit: l.credit, description: l.description ?? '', patientId: id(l.patientId), supplierId: id(l.supplierId), staffId: id(l.staffId), dentistId: id(l.dentistId) })),
});

accountingRouter.get(
  '/journals',
  authorize('accounting.journal.read'),
  validate({ query: journalListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, journalListQuery);
    const filter: Record<string, unknown> = {};
    if (q.source) filter.source = q.source;
    if (q.status) filter.status = q.status;
    if (q.accountId) filter['lines.accountId'] = new Types.ObjectId(q.accountId);
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.q) filter.$or = [{ number: { $regex: q.q.replace(/[^\w-]/g, ''), $options: 'i' } }, { memo: { $regex: q.q.replace(/[^\w\s-]/g, ''), $options: 'i' } }];
    const [rows, total] = await Promise.all([JournalEntryModel.find(filter).sort({ date: -1, createdAt: -1 }).skip(skipOf(q)).limit(q.limit).lean(), JournalEntryModel.countDocuments(filter)]);
    ok(res, rows.map((r) => journalDto(r as never)), pageMeta(q.page, q.limit, total));
  }),
);

accountingRouter.get(
  '/journals/:id',
  authorize('accounting.journal.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const e = await JournalEntryModel.findById(params(req, idParams).id).lean();
    if (!e) throw ApiError.notFound();
    ok(res, journalDto(e as never));
  }),
);

const manualLine = z.object({ accountId: objectId(), debit: money(), credit: money(), description: optional(freeText(200)) }).strict().refine((l) => (l.debit > 0) !== (l.credit > 0), { path: ['debit'], message: 'invalid_amount' });
const manualBody = z.object({ date: dateOnly(), memo: requiredText(300), lines: z.array(manualLine).min(2, { message: 'too_few' }).max(50) }).strict();

accountingRouter.post(
  '/journals',
  authorize('accounting.journal.create'),
  validate({ body: manualBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, manualBody);
    const e = await createManualDraft(req.auth!, { ...b, lines: b.lines.map((l) => ({ ...l, description: l.description ?? '' })) });
    created(res, journalDto(e.toObject() as never));
  }),
);

accountingRouter.post(
  '/journals/:id/post',
  authorize('accounting.journal.post'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.allowManualControlAccounts').lean());
    const e = await postManual(req.auth!, params(req, idParams).id, Boolean((clinic?.settings as { allowManualControlAccounts?: boolean } | undefined)?.allowManualControlAccounts));
    ok(res, journalDto(e.toObject() as never));
  }),
);

accountingRouter.delete(
  '/journals/:id',
  authorize('accounting.journal.create'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const e = await JournalEntryModel.findOne({ _id: params(req, idParams).id, status: 'draft' });
    if (!e) throw ApiError.notFound();
    await e.deleteOne();
    noContent(res);
  }),
);

const reverseBody = z.object({ date: optional(dateOnly()), reason: requiredText(300) }).strict();
accountingRouter.post(
  '/journals/:id/reverse',
  authorize('accounting.journal.reverse'),
  validate({ params: idParams, body: reverseBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, reverseBody);
    const orig = await JournalEntryModel.findById(params(req, idParams).id).lean();
    if (!orig) throw ApiError.notFound();
    // Document-generated entries are corrected through their documents (void, credit note…).
    if (!['manual', 'opening', 'reversal'].includes(orig.source)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Correct this entry through its source document');
    const rev = await reverseEntry(req.auth!, orig._id, { date: b.date ?? (await clinicToday()), memo: b.reason });
    await recordAudit({ action: 'reverse', entity: 'journalEntry', entityId: orig._id, reason: b.reason });
    ok(res, journalDto(rev.toObject() as never));
  }),
);

/* ---------- fiscal periods ---------- */

accountingRouter.get(
  '/fiscal-periods',
  authorize('accounting.journal.read', 'accounting.period.manage'),
  asyncHandler(async (_req, res) => {
    const [years, periods] = await Promise.all([FiscalYearModel.find({}).sort({ year: -1 }).lean(), FiscalPeriodModel.find({}).sort({ startDate: 1 }).lean()]);
    ok(res, years.map((y) => ({ id: String(y._id), year: y.year, startDate: y.startDate, endDate: y.endDate, status: y.status, periods: periods.filter((p) => String(p.fiscalYearId) === String(y._id)).map((p) => ({ id: String(p._id), year: p.year, month: p.month, startDate: p.startDate, endDate: p.endDate, status: p.status })) })));
  }),
);
const periodBody = z.object({ status: z.enum(['open', 'soft_closed', 'closed']), reason: optional(freeText(300)) }).strict();
accountingRouter.post('/fiscal-periods/:id/status', authorize('accounting.period.manage'), validate({ params: idParams, body: periodBody }), asyncHandler(async (req, res) => {
  const b = body(req, periodBody);
  ok(res, await ops.setPeriodStatus(req.auth!, params(req, idParams).id, b.status, b.reason));
}));
const yearParams = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).strict();
accountingRouter.post('/fiscal-years/:year/close', authorize('accounting.period.manage'), validate({ params: yearParams }), asyncHandler(async (req, res) => ok(res, await ops.closeFiscalYear(req.auth!, params(req, yearParams).year))));

/* ---------- suppliers ---------- */

const supplierShape = {
  name: entityName({ max: 120 }),
  kind: enumOf(['lab', 'supplies', 'equipment', 'services', 'other']).default('supplies'),
  taxNumber: optional(taxNumber()),
  contact: z.object({ phone: optional(phone()), email: optional(email()), person: optional(freeText(80)), address: optional(freeText(200)) }).strict().optional(),
  notes: optional(freeText(1000)),
  isActive: z.boolean().default(true),
};
accountingRouter.use(
  crudRouter({
    path: '/suppliers',
    entity: 'supplier',
    tag: 'accounting',
    model: SupplierModel as never,
    perms: { read: ['accounting.supplier.manage', 'accounting.expense.create', 'clinical.labOrder.manage'], create: 'accounting.supplier.manage' },
    createSchema: z.object(supplierShape).strict(),
    updateSchema: updateOf(supplierShape),
    filters: { kind: enumOf(['lab', 'supplies', 'equipment', 'services', 'other']).optional() },
    buildFilter: (q) => ({ ...(q.includeInactive === 'true' ? {} : { isActive: true }), ...(q.kind ? { kind: q.kind } : {}) }),
    sortable: ['name', 'balance', 'createdAt'],
    defaultSort: { name: 1 },
    searchFrom: (b) => b.name as string,
    unpaged: true,
  }),
);

/* ---------- supplier bills ---------- */

const billLine = z.object({ description: requiredText(200), expenseAccountId: objectId(), amount: money({ positive: true }), taxRateId: optional(objectId()), labOrderId: optional(objectId()) }).strict();
const billBody = z.object({ supplierId: objectId(), supplierRef: optional(freeText(60)), billDate: dateOnly(), dueDate: optional(dateOnly()), lines: z.array(billLine).min(1, { message: 'too_few' }).max(50), notes: optional(freeText(1000)) }).strict();
const billListQuery = z.object({ ...pageQuery, supplierId: optional(objectId()), status: optional(z.string().max(20)) }).strict();

accountingRouter.get(
  '/supplier-bills',
  authorize('accounting.supplier.manage'),
  validate({ query: billListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, billListQuery);
    const filter: Record<string, unknown> = { ...(q.supplierId ? { supplierId: q.supplierId } : {}), ...(q.status === 'open' ? { status: { $in: ['posted', 'partially_paid'] } } : q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([SupplierBillModel.find(filter).sort({ billDate: -1 }).skip(skipOf(q)).limit(q.limit).lean(), SupplierBillModel.countDocuments(filter)]);
    const names = new Map((await SupplierModel.find({ _id: { $in: rows.map((r) => r.supplierId) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    ok(res, rows.map((r) => ({ ...ops.billDto(r as never), supplierName: names.get(String(r.supplierId)) ?? '' })), pageMeta(q.page, q.limit, total));
  }),
);
accountingRouter.post('/supplier-bills', authorize('accounting.supplier.manage'), validate({ body: billBody }), asyncHandler(async (req, res) => created(res, await ops.createBill(req.auth!, body(req, billBody)))));
accountingRouter.patch('/supplier-bills/:id', authorize('accounting.supplier.manage'), validate({ params: idParams, body: billBody.extend({ version: z.number().int().min(0).optional() }) }), asyncHandler(async (req, res) => ok(res, await ops.updateBill(req.auth!, params(req, idParams).id, body(req, billBody.extend({ version: z.number().int().min(0).optional() }))))));
accountingRouter.post('/supplier-bills/:id/post', authorize('accounting.supplier.manage'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await ops.postBill(req.auth!, params(req, idParams).id))));
const reasonBody = z.object({ reason: requiredText(300) }).strict();
accountingRouter.post('/supplier-bills/:id/void', authorize('accounting.supplier.manage'), validate({ params: idParams, body: reasonBody }), asyncHandler(async (req, res) => ok(res, await ops.voidBill(req.auth!, params(req, idParams).id, body(req, reasonBody).reason))));

const supplierPaymentBody = z
  .object({ supplierId: objectId(), amount: money({ positive: true }), date: optional(dateOnly()), method: z.enum(['cash', 'bank_transfer', 'cheque', 'card', 'other']), paidFromAccountId: objectId(), reference: optional(freeText(80)), allocations: z.array(z.object({ billId: objectId(), amount: money({ positive: true }) }).strict()).max(50).optional() })
  .strict();
accountingRouter.get(
  '/supplier-payments',
  authorize('accounting.supplier.manage'),
  asyncHandler(async (_req, res) => {
    const rows = await SupplierPaymentModel.find({}).sort({ date: -1 }).limit(300).lean();
    const names = new Map((await SupplierModel.find({ _id: { $in: rows.map((r) => r.supplierId) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
    ok(res, rows.map((r) => ({ ...defaultDto(r as never), supplierId: String(r.supplierId), supplierName: names.get(String(r.supplierId)) ?? '' })));
  }),
);
accountingRouter.post('/supplier-payments', authorize('accounting.supplier.manage'), validate({ body: supplierPaymentBody }), asyncHandler(async (req, res) => created(res, await ops.paySupplier(req.auth!, body(req, supplierPaymentBody)))));

/* ---------- expenses ---------- */

const expenseBody = z.object({ date: dateOnly(), categoryAccountId: objectId(), amount: money({ positive: true }), taxRateId: optional(objectId()), paidFromAccountId: objectId(), payee: optional(freeText(120)), description: optional(freeText(300)), receiptFileId: optional(objectId()) }).strict();
const expenseQuery = z.object({ ...pageQuery, from: optional(dateOnly()), to: optional(dateOnly()), status: optional(z.string().max(20)) }).strict();
accountingRouter.get(
  '/expenses',
  authorize('accounting.expense.create', 'accounting.expense.approve', 'accounting.report.read'),
  validate({ query: expenseQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, expenseQuery);
    const filter: Record<string, unknown> = { ...(q.status ? { status: q.status } : {}), ...(q.from || q.to ? { date: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } } : {}) };
    const [rows, total] = await Promise.all([ExpenseModel.find(filter).sort({ date: -1, createdAt: -1 }).skip(skipOf(q)).limit(q.limit).lean(), ExpenseModel.countDocuments(filter)]);
    ok(res, rows.map((r) => ({ ...defaultDto(r as never), categoryAccountId: String(r.categoryAccountId), paidFromAccountId: String(r.paidFromAccountId), receiptFileId: id(r.receiptFileId) })), pageMeta(q.page, q.limit, total));
  }),
);
accountingRouter.post('/expenses', authorize('accounting.expense.create'), validate({ body: expenseBody }), asyncHandler(async (req, res) => created(res, await ops.createExpense(req.auth!, body(req, expenseBody)))));
accountingRouter.post('/expenses/:id/approve', authorize('accounting.expense.approve'), validate({ params: idParams }), asyncHandler(async (req, res) => ok(res, await ops.approveExpense(req.auth!, params(req, idParams).id))));
accountingRouter.post('/expenses/:id/void', authorize('accounting.expense.approve'), validate({ params: idParams, body: reasonBody }), asyncHandler(async (req, res) => ok(res, await ops.voidExpense(req.auth!, params(req, idParams).id, body(req, reasonBody).reason))));

/* ---------- reports (09 §8) ---------- */

const asOfQuery = z.object({ asOf: optional(dateOnly()) }).strict();
const rangeQuery = z.object({ from: dateOnly(), to: dateOnly(), compare: z.enum(['true', 'false']).optional(), dentistId: optional(objectId()) }).strict();
const R = 'accounting.report.read';

async function fiscalStart(asOf: string) {
  const fy = await FiscalYearModel.findOne({ startDate: { $lte: asOf }, endDate: { $gte: asOf } }).lean();
  return fy?.startDate ?? `${asOf.slice(0, 4)}-01-01`;
}

accountingRouter.get('/reports/trial-balance', authorize(R), validate({ query: asOfQuery }), asyncHandler(async (req, res) => ok(res, await rep.trialBalance(query(req, asOfQuery).asOf ?? (await clinicToday())))));
accountingRouter.get('/reports/profit-loss', authorize(R), validate({ query: rangeQuery }), asyncHandler(async (req, res) => {
  const q = query(req, rangeQuery);
  ok(res, await rep.profitAndLoss(q.from, q.to, { compare: q.compare === 'true', ...(q.dentistId ? { dentistId: q.dentistId } : {}) }));
}));
accountingRouter.get('/reports/balance-sheet', authorize(R), validate({ query: asOfQuery }), asyncHandler(async (req, res) => {
  const asOf = query(req, asOfQuery).asOf ?? (await clinicToday());
  ok(res, await rep.balanceSheet(asOf, await fiscalStart(asOf)));
}));
const glQuery = z.object({ accountId: objectId(), from: dateOnly(), to: dateOnly() }).strict();
accountingRouter.get('/reports/general-ledger', authorize(R, 'accounting.journal.read'), validate({ query: glQuery }), asyncHandler(async (req, res) => {
  const q = query(req, glQuery);
  const r = await rep.generalLedger(q.accountId, q.from, q.to);
  if (!r) throw ApiError.notFound();
  ok(res, r);
}));
const agingQuery = z.object({ asOf: optional(dateOnly()), payer: z.enum(['patient', 'insurance']).default('patient') }).strict();
// Own scope (04 §3): a doctor without accounting.report.read only gets invoices with their work.
const ownDoctor = (req: Request, perm: string) => ownDoctorOf(req.auth!, R, perm) ?? undefined;
accountingRouter.get('/reports/ar-aging', authorize(R, 'billing.invoice.read'), validate({ query: agingQuery }), asyncHandler(async (req, res) => {
  const q = query(req, agingQuery);
  const dentistId = ownDoctor(req, 'billing.invoice.read');
  ok(res, await rep.arAging(q.asOf ?? (await clinicToday()), q.payer, dentistId ? { dentistId } : {}));
}));
accountingRouter.get('/reports/ap-aging', authorize(R, 'accounting.supplier.manage'), validate({ query: asOfQuery }), asyncHandler(async (req, res) => ok(res, await rep.apAging(query(req, asOfQuery).asOf ?? (await clinicToday())))));
const plainRange = z.object({ from: dateOnly(), to: dateOnly() }).strict();
accountingRouter.get('/reports/vat', authorize(R), validate({ query: plainRange }), asyncHandler(async (req, res) => {
  const q = query(req, plainRange);
  ok(res, await rep.vatReturn(q.from, q.to));
}));
const dayQuery = z.object({ date: optional(dateOnly()) }).strict();
accountingRouter.get('/reports/daily-cash', authorize(R, 'billing.cashSession.manage'), validate({ query: dayQuery }), asyncHandler(async (req, res) => ok(res, await rep.dailyCash(query(req, dayQuery).date ?? (await clinicToday())))));
const statementQuery = z.object({ patientId: objectId(), from: dateOnly(), to: dateOnly() }).strict();
accountingRouter.get('/reports/patient-statement', authorize(R, 'billing.invoice.read'), validate({ query: statementQuery }), asyncHandler(async (req, res) => {
  const q = query(req, statementQuery);
  const dentistId = ownDoctor(req, 'billing.invoice.read');
  ok(res, await rep.patientStatement(q.patientId, q.from, q.to, { tz: await clinicTimezone(), ...(dentistId ? { dentistId } : {}) }));
}));
accountingRouter.get('/reports/production', authorize(R, 'reports.production.read'), validate({ query: plainRange }), asyncHandler(async (req, res) => {
  const q = query(req, plainRange);
  const dentistId = ownDoctor(req, 'reports.production.read');
  ok(res, await rep.dentistProduction(q.from, q.to, { tz: await clinicTimezone(), ...(dentistId ? { dentistId } : {}) }));
}));

registerPath({ method: 'get', path: '/reports/trial-balance', tags: ['accounting'], summary: 'Trial balance from the ledger', query: asOfQuery });
registerPath({ method: 'post', path: '/journals', tags: ['accounting'], summary: 'Manual journal draft', body: manualBody });
