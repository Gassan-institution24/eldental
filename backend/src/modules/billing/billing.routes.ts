import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { on } from '@/core/events/bus';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, noContent, ok, pageMeta } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize } from '@/core/rbac/authorize';
import { currentClinicId, runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { body, params, query, validate } from '@/core/validation/validate';
import { LabOrderModel } from '@/modules/clinical/clinical.models';
import { loadScopedPatient } from '@/modules/patients/patient.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { AccountModel } from '@/modules/accounting/accounting.models';
import { createBill } from '@/modules/accounting/operations.service';
import { pageQuery, skipOf } from '@/shared/pagination';
import { dateOnly, enumOf, freeText, money, objectId, optional, requiredText, toothNumber } from '@/shared/validation/fields';
import { InsuranceClaimModel, InvoiceModel, PAYMENT_METHODS, PaymentModel } from './billing.models';
import { doctorInvoiceFilter, ownDoctorOf, shareOf } from './attribution';
import * as inv from './invoice.service';
import * as pay from './payment.service';
import { resubmit } from './einvoice/jofotara.service';

export const billingRouter = Router();
const idParams = z.object({ id: objectId() }).strict();
const qty = z.number().int().min(1, { message: 'too_small' }).max(100, { message: 'too_big' });

/* ---------- invoices ---------- */

const lineBody = z
  .object({
    id: optional(objectId()),
    performedProcedureId: optional(objectId()),
    clinicProcedureId: optional(objectId()),
    description: optional(freeText(200)),
    toothNumbers: z.array(toothNumber()).max(32).optional(),
    quantity: qty.optional(),
    unitPrice: money().optional(),
    discount: money().optional(),
    taxRateId: objectId().nullable().optional(),
    dentistId: optional(objectId()),
  })
  .strict();
const draftShape = {
  appointmentId: optional(objectId()),
  dentistId: optional(objectId()),
  insurancePolicyId: objectId().nullable().optional(),
  lines: z.array(lineBody).max(100),
  invoiceDiscount: money().optional(),
  discountReason: optional(freeText(200)),
  dueDate: optional(dateOnly()),
  notes: optional(freeText(1000)),
  installmentPlan: z.array(z.object({ dueDate: dateOnly(), amount: money({ positive: true }) }).strict()).max(24).optional(),
};
const draftBody = z.object({ patientId: objectId(), ...draftShape }).strict();
const draftUpdateBody = z.object({ ...draftShape, lines: z.array(lineBody).max(100).optional(), version: z.number().int().min(0).optional() }).strict();
const invoiceListQuery = z
  .object({ ...pageQuery, status: z.enum(['draft', 'issued', 'partially_paid', 'paid', 'void', 'open']).optional(), type: z.enum(['invoice', 'credit_note']).optional(), patientId: optional(objectId()), from: optional(dateOnly()), to: optional(dateOnly()), insuranceCompanyId: optional(objectId()), dentistId: optional(objectId()), unclaimed: z.enum(['true', 'false']).optional() })
  .strict();

billingRouter.get(
  '/invoices',
  authorize('billing.invoice.read'),
  validate({ query: invoiceListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, invoiceListQuery);
    const filter: Record<string, unknown> = {};
    // Own scope and the doctor filter are both $or clauses (header or line doctor), so they are ANDed.
    filter.$and = [inv.ownInvoiceFilter(req.auth!), q.dentistId ? doctorInvoiceFilter(q.dentistId) : {}];
    if (q.status === 'open') filter.status = { $in: ['issued', 'partially_paid'] };
    else if (q.status) filter.status = q.status;
    if (q.type) filter.type = q.type;
    if (q.patientId) filter.patientId = new Types.ObjectId(q.patientId);
    if (q.insuranceCompanyId) filter.insuranceCompanyId = new Types.ObjectId(q.insuranceCompanyId);
    if (q.unclaimed === 'true') Object.assign(filter, { claimId: null, insuranceTotal: { $gt: 0 } });
    if (q.from || q.to) filter.issueDate = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.q) filter.number = { $regex: q.q.replace(/[^\w-]/g, ''), $options: 'i' };
    const [rows, total] = await Promise.all([InvoiceModel.find(filter).sort({ createdAt: -1 }).skip(skipOf(q)).limit(q.limit).lean(), InvoiceModel.countDocuments(filter)]);
    ok(res, await inv.serializeInvoices(req.auth!, rows as never), pageMeta(q.page, q.limit, total));
  }),
);

/** Minimal doctor list for the invoice doctor picker (id + name only; no staff directory access). */
billingRouter.get('/billing/dentists', authorize('billing.invoice.create', 'billing.invoice.read'), asyncHandler(async (req, res) => ok(res, await inv.listBillableDentists(req.auth!))));

billingRouter.get(
  '/invoices/:id',
  authorize('billing.invoice.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const doc = await inv.loadInvoice(req.auth!, params(req, idParams).id);
    const [dto] = await inv.serializeInvoices(req.auth!, [doc.toObject() as never]);
    const payments = await PaymentModel.find({ 'allocations.invoiceId': doc._id }).select('number receiptNumber method date allocations status').lean();
    const credits = await InvoiceModel.find({ originalInvoiceId: doc._id }).select('number total issueDate notes').lean();
    ok(res, {
      ...dto,
      payments: payments.map((p) => ({ id: String(p._id), number: p.number, receiptNumber: p.receiptNumber, method: p.method, date: p.date, status: p.status, amount: (p.allocations ?? []).filter((a) => String(a.invoiceId) === String(doc._id)).reduce((s, a) => s + (a.amount ?? 0), 0) })),
      creditNotes: credits.map((c) => ({ id: String(c._id), number: c.number, total: c.total, issueDate: c.issueDate, reason: c.notes })),
    });
  }),
);

billingRouter.post(
  '/invoices',
  authorize('billing.invoice.create'),
  validate({ body: draftBody }),
  asyncHandler(async (req, res) => {
    const b = body(req, draftBody);
    await loadScopedPatient({ ...req.auth!, scope: 'all' }, b.patientId);
    created(res, await inv.createDraft(req.auth!, b));
  }),
);

billingRouter.patch('/invoices/:id', authorize('billing.invoice.update'), validate({ params: idParams, body: draftUpdateBody }), asyncHandler(async (req, res) => ok(res, await inv.updateDraft(req.auth!, params(req, idParams).id, body(req, draftUpdateBody)))));

billingRouter.delete(
  '/invoices/:id',
  authorize('billing.invoice.update'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    await inv.deleteDraft(req.auth!, params(req, idParams).id);
    noContent(res);
  }),
);

const issueBody = z.object({ issueDate: optional(dateOnly()), dueDate: optional(dateOnly()) }).strict();
billingRouter.post('/invoices/:id/issue', authorize('billing.invoice.issue'), validate({ params: idParams, body: issueBody }), asyncHandler(async (req, res) => ok(res, await inv.issueInvoice(req.auth!, params(req, idParams).id, body(req, issueBody)))));

const reasonBody = z.object({ reason: requiredText(300) }).strict();
billingRouter.post('/invoices/:id/void', authorize('billing.invoice.void'), validate({ params: idParams, body: reasonBody }), asyncHandler(async (req, res) => ok(res, await inv.voidInvoice(req.auth!, params(req, idParams).id, body(req, reasonBody).reason))));

const creditBody = z.object({ amount: money({ positive: true }).optional(), reason: requiredText(300) }).strict();
billingRouter.post('/invoices/:id/credit-notes', authorize('billing.invoice.void'), validate({ params: idParams, body: creditBody }), asyncHandler(async (req, res) => created(res, await inv.createCreditNote(req.auth!, params(req, idParams).id, body(req, creditBody)))));

/** Letterhead data for the printable invoice / credit note. */
billingRouter.get(
  '/invoices/:id/print',
  authorize('billing.invoice.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const doc = await inv.loadInvoice(req.auth!, params(req, idParams).id);
    const [dto] = await inv.serializeInvoices(req.auth!, [doc.toObject() as never]);
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name phone email addressLine1 taxNumber commercialRegNo settings.invoiceFooter currency').lean());
    const { PatientModel } = await import('@/modules/patients/patient.models');
    const patient = await PatientModel.findById(doc.patientId).select('fullName fileNumber phone').lean();
    ok(res, { invoice: dto, clinic, patient: patient ? { fullName: patient.fullName, fileNumber: patient.fileNumber, phone: patient.phone?.e164 } : null });
  }),
);

/* ---------- payments ---------- */

const paymentBody = z
  .object({
    payerType: z.enum(['patient', 'insurance']).default('patient'),
    patientId: optional(objectId()),
    insuranceCompanyId: optional(objectId()),
    claimId: optional(objectId()),
    method: z.enum(PAYMENT_METHODS),
    amount: money({ positive: true }),
    date: optional(dateOnly()),
    reference: optional(freeText(80)),
    cheque: z.object({ number: requiredText(40), bank: optional(freeText(80)), dueDate: optional(dateOnly()) }).strict().optional(),
    allocations: z.array(z.object({ invoiceId: objectId(), amount: money({ positive: true }) }).strict()).max(50).optional(),
    autoAllocate: z.boolean().optional(),
    notes: optional(freeText(500)),
  })
  .strict();
const paymentListQuery = z.object({ ...pageQuery, patientId: optional(objectId()), method: z.enum(PAYMENT_METHODS).optional(), from: optional(dateOnly()), to: optional(dateOnly()), payerType: z.enum(['patient', 'insurance']).optional(), hasCredit: z.enum(['true', 'false']).optional() }).strict();

billingRouter.get(
  '/payments',
  authorize('billing.payment.read'),
  validate({ query: paymentListQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, paymentListQuery);
    const filter: Record<string, unknown> = {};
    if (q.patientId) filter.patientId = new Types.ObjectId(q.patientId);
    if (q.method) filter.method = q.method;
    if (q.payerType) filter.payerType = q.payerType;
    if (q.hasCredit === 'true') filter.unallocated = { $gt: 0 };
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    if (q.q) filter.$or = [{ number: { $regex: q.q.replace(/[^\w-]/g, ''), $options: 'i' } }, { receiptNumber: { $regex: q.q.replace(/[^\w-]/g, ''), $options: 'i' } }];
    const [rows, total] = await Promise.all([PaymentModel.find(filter).sort({ receivedAt: -1 }).skip(skipOf(q)).limit(q.limit).lean(), PaymentModel.countDocuments(filter)]);
    ok(res, await pay.serializePayments(req.auth!, rows as never), pageMeta(q.page, q.limit, total));
  }),
);

billingRouter.get(
  '/payments/:id',
  authorize('billing.payment.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await PaymentModel.findById(params(req, idParams).id).lean();
    if (!p) throw ApiError.notFound();
    ok(res, (await pay.serializePayments(req.auth!, [p as never]))[0]);
  }),
);

/** `Idempotency-Key` header makes retries safe (09 §3.2). */
billingRouter.post(
  '/payments',
  authorize('billing.payment.create'),
  validate({ body: paymentBody }),
  asyncHandler(async (req, res) => {
    const key = req.header('idempotency-key')?.slice(0, 100);
    created(res, await pay.recordPayment(req.auth!, body(req, paymentBody), key || undefined));
  }),
);

const allocateBody = z.object({ invoiceId: objectId(), amount: money({ positive: true }) }).strict();
billingRouter.post('/payments/:id/allocate', authorize('billing.payment.create'), validate({ params: idParams, body: allocateBody }), asyncHandler(async (req, res) => ok(res, await pay.allocateCredit(req.auth!, params(req, idParams).id, body(req, allocateBody)))));

const refundBody = z.object({ amount: money({ positive: true }), reason: requiredText(300) }).strict();
billingRouter.post('/payments/:id/refund', authorize('billing.payment.refund'), validate({ params: idParams, body: refundBody }), asyncHandler(async (req, res) => ok(res, await pay.refundPayment(req.auth!, params(req, idParams).id, body(req, refundBody)))));

const chequeBody = z.object({ to: z.enum(['cleared', 'bounced']) }).strict();
billingRouter.post('/payments/:id/cheque', authorize('billing.payment.create'), validate({ params: idParams, body: chequeBody }), asyncHandler(async (req, res) => ok(res, await pay.chequeStatus(req.auth!, params(req, idParams).id, body(req, chequeBody).to))));

billingRouter.get(
  '/payments/:id/receipt',
  authorize('billing.payment.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await PaymentModel.findById(params(req, idParams).id).lean();
    if (!p) throw ApiError.notFound();
    const [dto] = await pay.serializePayments(req.auth!, [p as never]);
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name phone addressLine1 taxNumber currency').lean());
    const balance = p.patientId ? await inv.patientLedgerBalance(String(p.patientId)) : null;
    ok(res, { payment: dto, clinic, balanceAfter: balance?.balance ?? null });
  }),
);

/* ---------- patient billing summary ---------- */

billingRouter.get(
  '/patients/:id/billing-summary',
  authorize('billing.invoice.read', 'billing.payment.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await loadScopedPatient({ ...req.auth!, scope: 'all' }, params(req, idParams).id);
    // A doctor with own scope sees only the invoices that include their work, and their share (09 §8.1).
    const me = ownDoctorOf(req.auth!, 'billing.invoice.read', 'billing.payment.read');
    if (me) {
      const mine = await InvoiceModel.find({ patientId: p._id, type: 'invoice', status: { $in: ['issued', 'partially_paid'] }, ...doctorInvoiceFilter(me) }).sort({ dueDate: 1 }).lean();
      const openInvoices = mine.map((i) => ({ id: String(i._id), number: i.number, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, ...inv.dues(i), myShare: shareOf(inv.dues(i).balanceDue, i, me) }));
      ok(res, { balance: openInvoices.reduce((a, i) => a + i.myShare, 0), scope: 'own', openInvoices, credits: [] });
      return;
    }
    const balance = await inv.refreshPatientBalance(String(p._id));
    const [open, credits] = await Promise.all([
      InvoiceModel.find({ patientId: p._id, type: 'invoice', status: { $in: ['issued', 'partially_paid'] } }).sort({ dueDate: 1 }).lean(),
      PaymentModel.find({ patientId: p._id, unallocated: { $gt: 0 }, status: { $ne: 'void' } }).select('number receiptNumber unallocated date').lean(),
    ]);
    ok(res, {
      ...balance,
      openInvoices: open.map((i) => ({ id: String(i._id), number: i.number, issueDate: i.issueDate, dueDate: i.dueDate, total: i.total, ...inv.dues(i) })),
      credits: credits.map((c) => ({ paymentId: String(c._id), number: c.receiptNumber ?? c.number, amount: c.unallocated, date: c.date })),
    });
  }),
);

/* ---------- cash sessions ---------- */

billingRouter.get('/cash-sessions/current', authorize('billing.cashSession.manage', 'billing.payment.create'), asyncHandler(async (_req, res) => ok(res, await pay.currentCashSession())));
billingRouter.get('/cash-sessions', authorize('billing.cashSession.manage'), asyncHandler(async (_req, res) => ok(res, await pay.cashSessionHistory())));
const openBody = z.object({ openingFloat: money() }).strict();
billingRouter.post('/cash-sessions/open', authorize('billing.cashSession.manage'), validate({ body: openBody }), asyncHandler(async (req, res) => created(res, await pay.openCashSession(req.auth!, body(req, openBody).openingFloat))));
const closeBody = z.object({ countedAmount: money(), notes: optional(freeText(500)) }).strict();
billingRouter.post('/cash-sessions/close', authorize('billing.cashSession.manage'), validate({ body: closeBody }), asyncHandler(async (req, res) => ok(res, await pay.closeCashSession(req.auth!, body(req, closeBody)))));

/* ---------- insurance claims ---------- */

const claimQuery = z.object({ status: optional(z.string().max(20)), insuranceCompanyId: optional(objectId()) }).strict();
billingRouter.get('/insurance-claims', authorize('billing.insurance.manage'), validate({ query: claimQuery }), asyncHandler(async (req, res) => ok(res, await pay.listClaims(query(req, claimQuery)))));
billingRouter.get(
  '/insurance-claims/:id',
  authorize('billing.insurance.manage'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const c = await InsuranceClaimModel.findById(params(req, idParams).id).lean();
    if (!c) throw ApiError.notFound();
    const invoices = await InvoiceModel.find({ _id: { $in: c.invoiceIds } }).lean();
    ok(res, { ...pay.claimDto(c as never), invoices: await inv.serializeInvoices(req.auth!, invoices as never) });
  }),
);
const claimBody = z.object({ invoiceIds: z.array(objectId()).min(1, { message: 'too_few' }).max(50), notes: optional(freeText(500)) }).strict();
billingRouter.post('/insurance-claims', authorize('billing.insurance.manage'), validate({ body: claimBody }), asyncHandler(async (req, res) => created(res, await pay.createClaim(req.auth!, body(req, claimBody)))));
const claimStatusBody = z.object({ to: z.enum(['submitted', 'approved', 'rejected']), approvedAmount: money().optional(), shortfallMode: enumOf(['write_off', 'rebill']).optional(), reason: optional(freeText(300)) }).strict();
billingRouter.post('/insurance-claims/:id/status', authorize('billing.insurance.manage'), validate({ params: idParams, body: claimStatusBody }), asyncHandler(async (req, res) => ok(res, await pay.claimTransition(req.auth!, params(req, idParams).id, body(req, claimStatusBody)))));

/* ---------- JoFotara (09 §7) ---------- */

const einvoiceQuery = z.object({ status: z.enum(['queued', 'accepted', 'rejected', 'disabled']).optional() }).strict();
billingRouter.get(
  '/einvoices',
  authorize('accounting.einvoice.manage'),
  validate({ query: einvoiceQuery }),
  asyncHandler(async (req, res) => {
    const q = query(req, einvoiceQuery);
    const rows = await InvoiceModel.find({ 'einvoice.status': q.status ?? { $ne: 'not_sent' }, number: { $type: 'string' } }).sort({ issueDate: -1 }).limit(300).lean();
    ok(res, await inv.serializeInvoices(req.auth!, rows as never));
  }),
);
billingRouter.post(
  '/einvoices/:id/resubmit',
  authorize('accounting.einvoice.manage'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const doc = await inv.loadInvoice(req.auth!, params(req, idParams).id);
    if (!doc.number) throw ApiError.conflict('INVOICE_NOT_DRAFT', 'Issue the invoice first');
    await resubmit(String(currentClinicId()), String(doc._id));
    noContent(res);
  }),
);

/* ---------- events: visits → draft invoices, lab cost → supplier bill ---------- */

on('procedure.completed', async ({ clinicId, procedureId }) => {
  await runInTenant(clinicId, () => inv.addProcedureToDraft(procedureId));
});
on('procedure.voided', async ({ clinicId, procedureId }) => {
  await runInTenant(clinicId, () => inv.removeProcedureFromDraft(procedureId));
});

/** Lab order received with a cost and a lab supplier → supplier bill draft (07 §8). */
export async function labBillDraft(auth: Parameters<typeof createBill>[0], labOrderId: string) {
  const lab = await LabOrderModel.findById(labOrderId).lean();
  if (!lab?.labSupplierId || !lab.cost) return null;
  const labCost = await AccountModel.findOne({ systemKey: 'LAB_COST' }).select('_id').lean();
  if (!labCost) return null;
  return createBill(auth, { supplierId: String(lab.labSupplierId), supplierRef: lab.number, billDate: new Date().toISOString().slice(0, 10), lines: [{ description: `${lab.number} ${lab.labName}`, expenseAccountId: String(labCost._id), amount: lab.cost, labOrderId: String(lab._id) }] });
}

registerPath({ method: 'get', path: '/billing/dentists', tags: ['billing'], summary: 'Active dentists and hygienists for the invoice doctor picker (id + name)' });
registerPath({ method: 'post', path: '/invoices/:id/issue', tags: ['billing'], summary: 'Issue: number + journal in one transaction (idempotent)', params: idParams, body: issueBody });
registerPath({ method: 'post', path: '/payments', tags: ['billing'], summary: 'Record a payment (Idempotency-Key header)', body: paymentBody });
registerPath({ method: 'post', path: '/invoices/:id/credit-notes', tags: ['billing'], summary: 'Credit note (full or partial)', params: idParams, body: creditBody });
