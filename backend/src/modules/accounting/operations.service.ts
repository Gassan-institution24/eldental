import { Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { withTransaction } from '@/core/db/transaction';
import { ApiError } from '@/core/http/ApiError';
import { scopeFor } from '@/core/rbac/authorize';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { TaxRateModel } from '@/modules/clinic/clinic.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { minOf, mulRate, sum } from '@/shared/money';
import { AccountModel, ExpenseModel, FiscalPeriodModel, FiscalYearModel, JournalEntryModel, SupplierBillModel, SupplierModel, SupplierPaymentModel } from './accounting.models';
import { clinicToday, ensureFiscalYear, loadAccountMap, postEntry, reverseEntry } from './journal.service';
import { expense as expenseLines, supplierBill as billLines, supplierPayment as supplierPaymentLines, yearEndClose } from './posting/postingRules';

const id = (v: unknown) => (v ? String(v) : undefined);

async function payableFor(supplierId: string) {
  const sup = await SupplierModel.findById(supplierId).lean();
  if (!sup) throw ApiError.validation([{ path: 'supplierId', code: 'not_found' }]);
  const accounts = await loadAccountMap();
  return { sup, payableAccountId: sup.payableAccountId ? String(sup.payableAccountId) : accounts(sup.kind === 'lab' ? 'AP_LABS' : 'AP_SUPPLIERS') };
}

async function assertPostable(accountId: string, path: string) {
  const a = await AccountModel.findById(accountId).select('isGroup isActive type').lean();
  if (!a || a.isGroup || !a.isActive) throw ApiError.validation([{ path, code: 'invalid_option' }]);
  return a;
}

async function taxOf(taxRateId: string | undefined | null, amount: number) {
  if (!taxRateId) return 0;
  const t = await TaxRateModel.findById(taxRateId).lean();
  return t ? mulRate(amount, t.rate) : 0;
}

/* ---------- supplier bills (09 §3.5) ---------- */

export type BillInput = { supplierId: string; supplierRef?: string; billDate: string; dueDate?: string; lines: { description: string; expenseAccountId: string; amount: number; taxRateId?: string; labOrderId?: string }[]; notes?: string };

export function billDto(b: Record<string, unknown> & { _id: Types.ObjectId; __v?: number }) {
  return { ...b, id: String(b._id), version: b.__v ?? 0, _id: undefined, __v: undefined, clinicId: undefined, supplierId: String(b.supplierId), journalEntryId: id(b.journalEntryId), balanceDue: ((b.total as number) ?? 0) - ((b.amountPaid as number) ?? 0) };
}

async function buildBill(b: BillInput) {
  const lines = [];
  for (const [i, l] of b.lines.entries()) {
    await assertPostable(l.expenseAccountId, `lines.${i}.expenseAccountId`);
    lines.push({ ...l, taxAmount: await taxOf(l.taxRateId, l.amount) });
  }
  const subtotal = sum(lines.map((l) => l.amount));
  const taxTotal = sum(lines.map((l) => l.taxAmount));
  return { lines, subtotal, taxTotal, total: subtotal + taxTotal };
}

export async function createBill(auth: AuthContext, b: BillInput) {
  await payableFor(b.supplierId);
  const built = await buildBill(b);
  const bill = await SupplierBillModel.create({ ...b, ...built, number: await nextNumber('bill', 'BILL', { year: Number(b.billDate.slice(0, 4)) }) });
  await recordAudit({ action: 'create', entity: 'supplierBill', entityId: bill._id, after: { total: bill.total } });
  return billDto(bill.toObject() as never);
}

export async function updateBill(auth: AuthContext, billId: string, b: BillInput & { version?: number }) {
  const bill = await SupplierBillModel.findById(billId);
  if (!bill) throw ApiError.notFound();
  if (bill.status !== 'draft') throw ApiError.conflict('INVOICE_NOT_DRAFT', 'Posted bills cannot be edited');
  if (b.version !== undefined && b.version !== bill.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this bill');
  const built = await buildBill(b);
  bill.set({ ...b, ...built });
  await bill.save();
  await recordAudit({ action: 'update', entity: 'supplierBill', entityId: bill._id });
  return billDto(bill.toObject() as never);
}

export async function postBill(auth: AuthContext, billId: string) {
  const bill = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const doc = await SupplierBillModel.findById(billId).session(s ?? null);
    if (!doc) throw ApiError.notFound();
    if (doc.status !== 'draft') throw ApiError.conflict('INVOICE_NOT_DRAFT', 'Already posted');
    if (!doc.lines.length || !doc.total) throw ApiError.conflict('INVOICE_EMPTY', 'Add at least one line');
    const { payableAccountId } = await payableFor(String(doc.supplierId));
    const accounts = await loadAccountMap(s);
    const lines = billLines({ supplierId: String(doc.supplierId), payableAccountId, lines: doc.lines.map((l) => ({ accountId: String(l.expenseAccountId), amount: l.amount ?? 0, tax: l.taxAmount ?? 0 })) }, accounts);
    const je = await postEntry(auth, { date: doc.billDate, source: 'supplier_bill', sourceId: doc._id, memo: `${doc.number}${doc.supplierRef ? ` (${doc.supplierRef})` : ''}`, lines }, s);
    doc.journalEntryId = je._id;
    doc.status = 'posted';
    await doc.save({ session: s });
    await SupplierModel.updateOne({ _id: doc.supplierId }, { $inc: { balance: doc.total } }, { session: s });
    return doc;
  });
  await recordAudit({ action: 'post', entity: 'supplierBill', entityId: billId, after: { total: bill.total } });
  return billDto(bill.toObject() as never);
}

export async function voidBill(auth: AuthContext, billId: string, reason: string) {
  const bill = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const doc = await SupplierBillModel.findById(billId).session(s ?? null);
    if (!doc) throw ApiError.notFound();
    if (doc.status === 'draft') {
      doc.status = 'void';
      await doc.save({ session: s });
      return doc;
    }
    if (doc.status !== 'posted' || (doc.amountPaid ?? 0) > 0) throw ApiError.conflict('INVOICE_HAS_PAYMENTS', 'Bills with payments cannot be voided');
    await reverseEntry(auth, doc.journalEntryId!, { date: await clinicToday(), memo: `Void ${doc.number}: ${reason}`, source: 'void' }, s);
    doc.status = 'void';
    await doc.save({ session: s });
    await SupplierModel.updateOne({ _id: doc.supplierId }, { $inc: { balance: -(doc.total ?? 0) } }, { session: s });
    return doc;
  });
  await recordAudit({ action: 'status_change', entity: 'supplierBill', entityId: billId, after: { status: 'void' }, reason });
  return billDto(bill.toObject() as never);
}

/* ---------- supplier payments ---------- */

export async function paySupplier(auth: AuthContext, b: { supplierId: string; amount: number; date?: string; method: 'cash' | 'bank_transfer' | 'cheque' | 'card' | 'other'; paidFromAccountId: string; reference?: string; allocations?: { billId: string; amount: number }[] }) {
  const { payableAccountId } = await payableFor(b.supplierId);
  await assertPostable(b.paidFromAccountId, 'paidFromAccountId');
  const payment = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const date = b.date ?? (await clinicToday());
    let allocations = b.allocations ?? [];
    if (!allocations.length) {
      // Oldest open bills first.
      let left = b.amount;
      const open = await SupplierBillModel.find({ supplierId: b.supplierId, status: { $in: ['posted', 'partially_paid'] } }).sort({ dueDate: 1, billDate: 1 }).session(s ?? null);
      allocations = [];
      for (const bill of open) {
        const take = minOf(left, (bill.total ?? 0) - (bill.amountPaid ?? 0));
        if (take > 0) allocations.push({ billId: String(bill._id), amount: take });
        left -= take;
        if (left <= 0) break;
      }
    }
    if (sum(allocations.map((a) => a.amount)) > b.amount) throw ApiError.conflict('ALLOCATION_EXCEEDS_AMOUNT', 'Allocations exceed the payment');
    for (const [i, a] of allocations.entries()) {
      const bill = await SupplierBillModel.findOne({ _id: a.billId, supplierId: b.supplierId }).session(s ?? null);
      if (!bill || !['posted', 'partially_paid'].includes(bill.status)) throw ApiError.validation([{ path: `allocations.${i}.billId`, code: 'not_found' }]);
      if (a.amount > (bill.total ?? 0) - (bill.amountPaid ?? 0)) throw ApiError.conflict('ALLOCATION_EXCEEDS_BALANCE', 'More than the bill still owes');
      bill.amountPaid = (bill.amountPaid ?? 0) + a.amount;
      bill.status = bill.amountPaid >= (bill.total ?? 0) ? 'paid' : 'partially_paid';
      await bill.save({ session: s });
    }
    const [doc] = await SupplierPaymentModel.create([{ ...b, date, number: await nextNumber('supplierPayment', 'SPAY', { year: Number(date.slice(0, 4)), session: s ?? null }), allocations }], { session: s });
    const je = await postEntry(auth, { date, source: 'supplier_payment', sourceId: doc!._id, memo: doc!.number, lines: supplierPaymentLines({ supplierId: b.supplierId, payableAccountId, amount: b.amount, paidFromAccountId: b.paidFromAccountId }) }, s);
    doc!.journalEntryId = je._id;
    await doc!.save({ session: s });
    await SupplierModel.updateOne({ _id: b.supplierId }, { $inc: { balance: -b.amount } }, { session: s });
    return doc!;
  });
  await recordAudit({ action: 'create', entity: 'supplierPayment', entityId: payment._id, after: { amount: b.amount } });
  return { ...payment.toObject(), id: String(payment._id) };
}

/* ---------- quick expenses ---------- */

export async function createExpense(auth: AuthContext, b: { date: string; categoryAccountId: string; amount: number; taxRateId?: string; paidFromAccountId: string; payee?: string; description?: string; receiptFileId?: string }) {
  await assertPostable(b.categoryAccountId, 'categoryAccountId');
  await assertPostable(b.paidFromAccountId, 'paidFromAccountId');
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.expenseApprovalThreshold').lean());
  const threshold = (clinic?.settings as { expenseApprovalThreshold?: number } | undefined)?.expenseApprovalThreshold ?? 0;
  const needsApproval = threshold > 0 && b.amount > threshold && !(auth.isOwner || scopeFor(auth, 'accounting.expense.approve'));
  const taxAmount = await taxOf(b.taxRateId, b.amount);
  const exp = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const [doc] = await ExpenseModel.create([{ ...b, taxAmount, number: await nextNumber('expense', 'EXP', { year: Number(b.date.slice(0, 4)), session: s ?? null }), status: needsApproval ? 'pending_approval' : 'approved', ...(needsApproval ? {} : { approvedBy: auth.userId }) }], { session: s });
    if (!needsApproval) await postExpense(auth, doc!, s);
    return doc!;
  });
  await recordAudit({ action: 'create', entity: 'expense', entityId: exp._id, after: { amount: b.amount, status: exp.status } });
  return { ...exp.toObject(), id: String(exp._id) };
}

async function postExpense(auth: AuthContext, doc: InstanceType<typeof ExpenseModel>, s?: import('mongoose').ClientSession) {
  const accounts = await loadAccountMap(s);
  const je = await postEntry(auth, { date: doc.date, source: 'expense', sourceId: doc._id, memo: `${doc.number}${doc.payee ? ` · ${doc.payee}` : ''}`, lines: expenseLines({ accountId: String(doc.categoryAccountId), amount: doc.amount, tax: doc.taxAmount ?? 0, paidFromAccountId: String(doc.paidFromAccountId) }, accounts) }, s);
  doc.journalEntryId = je._id;
  await doc.save({ session: s });
}

export async function approveExpense(auth: AuthContext, expenseId: string) {
  const exp = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const doc = await ExpenseModel.findById(expenseId).session(s ?? null);
    if (!doc) throw ApiError.notFound();
    if (doc.status !== 'pending_approval') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Not waiting for approval');
    doc.status = 'approved';
    doc.approvedBy = new Types.ObjectId(auth.userId);
    await postExpense(auth, doc, s);
    return doc;
  });
  await recordAudit({ action: 'approve', entity: 'expense', entityId: expenseId });
  return { ...exp.toObject(), id: String(exp._id) };
}

export async function voidExpense(auth: AuthContext, expenseId: string, reason: string) {
  const exp = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const doc = await ExpenseModel.findById(expenseId).session(s ?? null);
    if (!doc || doc.status === 'void') throw ApiError.notFound();
    if (doc.journalEntryId) await reverseEntry(auth, doc.journalEntryId, { date: await clinicToday(), memo: `Void ${doc.number}: ${reason}`, source: 'void' }, s);
    doc.status = 'void';
    await doc.save({ session: s });
    return doc;
  });
  await recordAudit({ action: 'status_change', entity: 'expense', entityId: expenseId, after: { status: 'void' }, reason });
  return { ...exp.toObject(), id: String(exp._id) };
}

/* ---------- periods (09 §6) ---------- */

export async function setPeriodStatus(auth: AuthContext, periodId: string, status: 'open' | 'soft_closed' | 'closed', reason?: string) {
  const p = await FiscalPeriodModel.findById(periodId);
  if (!p) throw ApiError.notFound();
  if (status === 'open' && p.status !== 'open' && !reason) throw ApiError.validation([{ path: 'reason', code: 'required' }]);
  const before = p.status;
  p.status = status;
  p.history.push({ status, at: new Date(), byUserId: new Types.ObjectId(auth.userId), ...(reason ? { reason } : {}) });
  await p.save();
  await recordAudit({ action: 'status_change', entity: 'fiscalPeriod', entityId: periodId, before: { status: before }, after: { status }, ...(reason ? { reason } : {}) });
  return p.toObject();
}

/** Year-end close (09 §4.10): revenue/expense → retained earnings, periods locked, next year opened. */
export async function closeFiscalYear(auth: AuthContext, year: number) {
  const fy = await FiscalYearModel.findOne({ year });
  if (!fy) throw ApiError.notFound();
  if (fy.status === 'closed') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Year already closed');
  const accounts = await AccountModel.find({ type: { $in: ['revenue', 'expense'] }, isGroup: false }).select('_id').lean();
  const rows = await JournalEntryModel.aggregate<{ _id: Types.ObjectId; d: number; c: number }>([
    { $match: { clinicId: new Types.ObjectId(currentClinicId()), status: { $in: ['posted', 'reversed'] }, date: { $gte: fy.startDate, $lte: fy.endDate } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': { $in: accounts.map((a) => a._id) } } },
    { $group: { _id: '$lines.accountId', d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } },
  ]);
  const map = await loadAccountMap();
  const lines = yearEndClose(rows.map((r) => ({ accountId: String(r._id), balance: r.d - r.c })), map);
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    // Make sure the last period accepts the closing entry, then lock everything.
    await FiscalPeriodModel.updateMany({ fiscalYearId: fy._id }, { $set: { status: 'open' } }, { session: s });
    if (lines.length) {
      const je = await postEntry(auth, { date: fy.endDate, source: 'closing', sourceId: fy._id, memo: `Year-end close ${year}`, lines }, s);
      fy.closingEntryId = je._id;
    }
    await FiscalPeriodModel.updateMany({ fiscalYearId: fy._id }, { $set: { status: 'closed' } }, { session: s });
    fy.status = 'closed';
    await fy.save({ session: s });
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.fiscalYearStartMonth').lean());
    await ensureFiscalYear(year + 1, clinic?.settings?.fiscalYearStartMonth ?? 1, s);
  });
  await recordAudit({ action: 'status_change', entity: 'fiscalYear', entityId: fy._id, after: { status: 'closed' } });
  return fy.toObject();
}
