import { Types, type ClientSession } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { onCommit, withTransaction } from '@/core/db/transaction';
import { emit } from '@/core/events/bus';
import { ApiError } from '@/core/http/ApiError';
import { fieldPolicyOf } from '@/core/rbac/authorize';
import { applyFieldPolicy } from '@/core/rbac/fieldPolicy';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { InsuranceCompanyModel, PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { minOf, sum } from '@/shared/money';
import { clinicToday, loadAccountMap, postEntry, reverseEntry } from '@/modules/accounting/journal.service';
import { cashOverShort, chequeCleared, claimShortfall, creditApplied, paymentReceived, refund as refundLines } from '@/modules/accounting/posting/postingRules';
import { doctorWeights, splitByDoctor, UNASSIGNED } from './attribution';
import { CashSessionModel, InsuranceClaimModel, InvoiceModel, PaymentModel, type InvoiceDoc } from './billing.models';
import { dues, patientLedgerBalance, refreshPatientBalance, refreshStatus } from './invoice.service';

const id = (v: unknown) => (v ? String(v) : undefined);

/* ---------- DTO ---------- */

type Raw = Record<string, unknown> & { _id: Types.ObjectId; allocations?: { invoiceId: unknown; amount: number; at?: Date }[] };

export function toPaymentDto(p: Raw, extra: { patient?: { fullName?: string | null; fileNumber?: string | null } | null; invoices?: Map<string, string> } = {}) {
  return {
    id: String(p._id),
    number: p.number,
    receiptNumber: p.receiptNumber,
    payerType: p.payerType,
    patientId: id(p.patientId),
    patient: extra.patient ? { fullName: extra.patient.fullName ?? '', fileNumber: extra.patient.fileNumber ?? '' } : undefined,
    insuranceCompanyId: id(p.insuranceCompanyId),
    claimId: id(p.claimId),
    method: p.method,
    amount: p.amount,
    date: p.date,
    receivedAt: p.receivedAt,
    reference: p.reference ?? '',
    cheque: (p.cheque as { number?: string } | undefined)?.number ? p.cheque : undefined,
    depositAccountId: id(p.depositAccountId),
    cashSessionId: id(p.cashSessionId),
    allocations: (p.allocations ?? []).map((a) => ({ invoiceId: String(a.invoiceId), invoiceNumber: extra.invoices?.get(String(a.invoiceId)), amount: a.amount, at: a.at })),
    unallocated: p.unallocated,
    refunded: p.refunded ?? 0,
    status: p.status,
    refunds: p.refunds ?? [],
    notes: p.notes ?? '',
    createdAt: p.createdAt,
  };
}

export async function serializePayments(auth: AuthContext, rows: Raw[]) {
  const policy = fieldPolicyOf(auth, 'billing.payment', 'billing.payment.read');
  const patients = new Map((await PatientModel.find({ _id: { $in: rows.map((r) => r.patientId).filter(Boolean) } }).select('fullName fileNumber').lean()).map((p) => [String(p._id), p]));
  const invIds = rows.flatMap((r) => (r.allocations ?? []).map((a) => a.invoiceId));
  const invoices = new Map((await InvoiceModel.find({ _id: { $in: invIds } }).select('number').lean()).map((i) => [String(i._id), i.number ?? '']));
  return rows.map((r) => applyFieldPolicy(toPaymentDto(r, { patient: patients.get(String(r.patientId)), invoices }), policy));
}

/* ---------- deposit accounts (09 §3.2) ---------- */

async function depositFor(method: string, session?: ClientSession) {
  const a = await loadAccountMap(session);
  if (method === 'cash') {
    const sessionDoc = await CashSessionModel.findOne({ status: 'open', cashAccountId: a('CASH_DEFAULT') }).session(session ?? null);
    if (!sessionDoc) throw ApiError.conflict('CASH_SESSION_REQUIRED', 'Open the cash drawer before taking cash');
    return { accountId: a('CASH_DEFAULT'), cashSessionId: sessionDoc._id };
  }
  const key = method === 'card' ? 'CARD_CLEARING' : method === 'cheque' ? 'CHEQUES_UNDER_COLLECTION' : 'BANK_DEFAULT';
  return { accountId: a(key), cashSessionId: undefined };
}

/* ---------- payments ---------- */

export type PaymentInput = {
  payerType: 'patient' | 'insurance';
  patientId?: string;
  insuranceCompanyId?: string;
  claimId?: string;
  method: 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'wallet' | 'other';
  amount: number;
  date?: string;
  reference?: string;
  cheque?: { number: string; bank?: string; dueDate?: string };
  allocations?: { invoiceId: string; amount: number }[];
  autoAllocate?: boolean;
  notes?: string;
};

/** Patient payers settle the patient share; insurers the insurance share. */
const dueFor = (inv: InvoiceDoc, payer: 'patient' | 'insurance') => (payer === 'insurance' ? dues(inv).insuranceDue : dues(inv).patientDue);

function applyAllocation(inv: InvoiceDoc, payer: 'patient' | 'insurance', amount: number) {
  if (payer === 'insurance') inv.insurancePaid = (inv.insurancePaid ?? 0) + amount;
  else inv.amountPaid = (inv.amountPaid ?? 0) + amount;
  refreshStatus(inv);
}

async function resolveAllocations(b: PaymentInput, session?: ClientSession) {
  const owner = b.payerType === 'insurance' ? { insuranceCompanyId: b.insuranceCompanyId } : { patientId: b.patientId };
  let invoices: InvoiceDoc[];
  let wanted: { invoiceId: string; amount: number }[];
  if (b.allocations?.length) {
    invoices = await InvoiceModel.find({ _id: { $in: b.allocations.map((a) => a.invoiceId) }, ...owner }).session(session ?? null);
    wanted = b.allocations;
  } else if (b.autoAllocate || b.claimId) {
    const claim = b.claimId ? await InsuranceClaimModel.findById(b.claimId).session(session ?? null) : null;
    invoices = await InvoiceModel.find({ ...owner, type: 'invoice', status: { $in: ['issued', 'partially_paid'] }, ...(claim ? { _id: { $in: claim.invoiceIds } } : {}) })
      .sort({ dueDate: 1, issueDate: 1 })
      .session(session ?? null);
    let left = b.amount;
    wanted = [];
    for (const inv of invoices) {
      const take = minOf(left, dueFor(inv, b.payerType));
      if (take > 0) wanted.push({ invoiceId: String(inv._id), amount: take });
      left -= take;
      if (left <= 0) break;
    }
  } else return { invoices: [] as InvoiceDoc[], allocations: [] as { invoiceId: string; amount: number }[] };
  const byId = new Map(invoices.map((i) => [String(i._id), i]));
  wanted.forEach((a, i) => {
    const inv = byId.get(a.invoiceId);
    if (!inv || !['issued', 'partially_paid'].includes(inv.status) || inv.type !== 'invoice') throw ApiError.validation([{ path: `allocations.${i}.invoiceId`, code: 'not_found' }]);
    if (a.amount > dueFor(inv, b.payerType)) throw ApiError.conflict('ALLOCATION_EXCEEDS_BALANCE', 'More than the invoice still owes', { invoice: inv.number, due: dueFor(inv, b.payerType) });
  });
  if (sum(wanted.map((a) => a.amount)) > b.amount) throw ApiError.conflict('ALLOCATION_EXCEEDS_AMOUNT', 'Allocations exceed the payment');
  return { invoices, allocations: wanted };
}

export async function recordPayment(auth: AuthContext, b: PaymentInput, idempotencyKey?: string) {
  if (idempotencyKey) {
    const existing = await PaymentModel.findOne({ idempotencyKey }).lean();
    if (existing) return (await serializePayments(auth, [existing as unknown as Raw]))[0]!;
  }
  if (b.payerType === 'patient' && !b.patientId) throw ApiError.validation([{ path: 'patientId', code: 'required' }]);
  if (b.payerType === 'insurance' && !b.insuranceCompanyId) throw ApiError.validation([{ path: 'insuranceCompanyId', code: 'required' }]);
  if (b.method === 'cheque' && !b.cheque?.number) throw ApiError.validation([{ path: 'cheque.number', code: 'required' }]);
  const clinicId = String(currentClinicId());
  const pay = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const date = b.date ?? (await clinicToday());
    const deposit = await depositFor(b.method, s);
    const { invoices, allocations } = await resolveAllocations(b, s);
    const allocated = sum(allocations.map((a) => a.amount));
    const year = Number(date.slice(0, 4));
    const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('settings.numbering').lean());
    const accounts = await loadAccountMap(s);
    const payment = new PaymentModel({
      number: await nextNumber('payment', 'PAY', { year, session: s ?? null }),
      receiptNumber: await nextNumber('receipt', clinic?.settings?.numbering?.receipt ?? 'RCPT', { year, session: s ?? null }),
      payerType: b.payerType,
      patientId: b.patientId,
      insuranceCompanyId: b.insuranceCompanyId,
      claimId: b.claimId,
      method: b.method,
      amount: b.amount,
      date,
      reference: b.reference ?? '',
      ...(b.cheque ? { cheque: { ...b.cheque, status: 'under_collection' } } : {}),
      depositAccountId: deposit.accountId,
      cashSessionId: deposit.cashSessionId,
      allocations: allocations.map((a) => ({ ...a, at: new Date() })),
      unallocated: b.amount - allocated,
      idempotencyKey,
      notes: b.notes ?? '',
      receivedBy: auth.userId,
    });
    const lines = paymentReceived({ amount: b.amount, depositAccountId: deposit.accountId, payer: b.payerType, ...(b.patientId ? { patientId: b.patientId } : {}), ...(b.insuranceCompanyId ? { insuranceCompanyId: b.insuranceCompanyId } : {}), allocated }, accounts);
    const je = await postEntry(auth, { date, source: 'payment', sourceId: payment._id, memo: payment.receiptNumber ?? '', lines }, s);
    payment.journalEntryId = je._id;
    await payment.save({ session: s });
    for (const a of allocations) {
      const inv = invoices.find((i) => String(i._id) === a.invoiceId)!;
      applyAllocation(inv, b.payerType, a.amount);
      await inv.save({ session: s });
    }
    if (b.claimId) await InsuranceClaimModel.updateOne({ _id: b.claimId }, { $inc: { paidAmount: allocated } }, { session: s });
    onCommit(session, () => emit('payment.received', { clinicId, paymentId: String(payment._id) }));
    return payment;
  }).catch(async (err: unknown) => {
    // A concurrent request with the same key won the race: return its payment.
    if ((err as { code?: number }).code === 11000 && idempotencyKey) {
      const won = await PaymentModel.findOne({ idempotencyKey });
      if (won) return won;
    }
    throw err;
  });
  if (b.claimId) await settleClaimStatus(b.claimId);
  await touchBalances(pay);
  await recordAudit({ action: 'create', entity: 'payment', entityId: pay._id, after: { number: pay.number, amount: pay.amount, method: pay.method } });
  return (await serializePayments(auth, [pay.toObject() as unknown as Raw]))[0]!;
}

async function touchBalances(doc: { toObject(): unknown }) {
  const p = doc.toObject() as { patientId?: unknown; allocations?: { invoiceId: unknown }[] };
  const patientIds = new Set<string>();
  if (p.patientId) patientIds.add(String(p.patientId));
  if (p.allocations?.length) {
    const invs = await InvoiceModel.find({ _id: { $in: p.allocations.map((a) => a.invoiceId) } }).select('patientId').lean();
    for (const i of invs) patientIds.add(String(i.patientId));
  }
  for (const pid of patientIds) await refreshPatientBalance(pid);
}

/** Uses unallocated credit on an invoice (Dr PATIENT_CREDIT / Cr AR_PATIENTS). */
export async function allocateCredit(auth: AuthContext, paymentId: string, b: { invoiceId: string; amount: number }) {
  const pay = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const p = await PaymentModel.findById(paymentId).session(s ?? null);
    if (!p || p.status === 'void') throw ApiError.notFound();
    if (p.payerType !== 'patient' || !p.patientId) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Only patient credit can be applied');
    if (b.amount > (p.unallocated ?? 0)) throw ApiError.conflict('ALLOCATION_EXCEEDS_AMOUNT', 'More than the unused credit', { available: p.unallocated });
    const inv = await InvoiceModel.findOne({ _id: b.invoiceId, patientId: p.patientId }).session(s ?? null);
    if (!inv || !['issued', 'partially_paid'].includes(inv.status)) throw ApiError.validation([{ path: 'invoiceId', code: 'not_found' }]);
    if (b.amount > dues(inv).patientDue) throw ApiError.conflict('ALLOCATION_EXCEEDS_BALANCE', 'More than the invoice still owes');
    const accounts = await loadAccountMap(s);
    const je = await postEntry(auth, { date: await clinicToday(), source: 'credit_application', sourceId: p._id, memo: `${p.receiptNumber} → ${inv.number}`, lines: creditApplied(b.amount, String(p.patientId), accounts) }, s);
    p.allocations.push({ invoiceId: inv._id, amount: b.amount, at: new Date(), journalEntryId: je._id });
    p.unallocated = (p.unallocated ?? 0) - b.amount;
    await p.save({ session: s });
    applyAllocation(inv, 'patient', b.amount);
    await inv.save({ session: s });
    return p;
  });
  await touchBalances(pay);
  await recordAudit({ action: 'update', entity: 'payment', entityId: paymentId, summary: `credit applied ${b.amount}` });
  return (await serializePayments(auth, [pay.toObject() as unknown as Raw]))[0]!;
}

/**
 * Refund (09 §3.2): unallocated credit first; beyond that, the latest allocations are released
 * and those invoices reopen.
 */
export async function refundPayment(auth: AuthContext, paymentId: string, b: { amount: number; reason: string }) {
  const clinicId = String(currentClinicId());
  // Patient credit can also come from credit notes, not only from this payment's leftover.
  const before = await PaymentModel.findById(paymentId).select('patientId payerType').lean();
  const ledgerCredit = before?.payerType === 'patient' && before.patientId ? (await patientLedgerBalance(String(before.patientId))).credit : 0;
  const pay = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const p = await PaymentModel.findById(paymentId).session(s ?? null);
    if (!p || p.status === 'void') throw ApiError.notFound();
    const refundable = p.amount - (p.refunded ?? 0);
    if (b.amount <= 0 || b.amount > refundable) throw ApiError.conflict('REFUND_EXCEEDS_REFUNDABLE', 'More than can be refunded', { refundable });
    if (p.method === 'cheque' && p.cheque?.status !== 'cleared') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Refund a cheque only after it clears');
    const fromCredit = minOf(b.amount, Math.max(p.unallocated ?? 0, ledgerCredit));
    let fromAr = b.amount - fromCredit;
    const fromInvoices: { invoiceId: Types.ObjectId; amount: number }[] = [];
    for (let i = p.allocations.length - 1; i >= 0 && fromAr > 0; i -= 1) {
      const a = p.allocations[i]!;
      const take = minOf(fromAr, a.amount ?? 0);
      const inv = await InvoiceModel.findById(a.invoiceId).session(s ?? null);
      if (inv) {
        if (p.payerType === 'insurance') inv.insurancePaid = (inv.insurancePaid ?? 0) - take;
        else inv.amountPaid = (inv.amountPaid ?? 0) - take;
        refreshStatus(inv);
        await inv.save({ session: s });
      }
      if (take > 0) fromInvoices.push({ invoiceId: a.invoiceId as Types.ObjectId, amount: take });
      a.amount = (a.amount ?? 0) - take;
      fromAr -= take;
    }
    p.set('allocations', p.allocations.filter((a) => (a.amount ?? 0) > 0));
    const accounts = await loadAccountMap(s);
    let depositAccountId = String(p.depositAccountId);
    if (p.method === 'cash') {
      // Cash goes out of today's drawer, which must be open.
      const open = await CashSessionModel.findOne({ status: 'open', cashAccountId: accounts('CASH_DEFAULT') }).session(s ?? null);
      if (!open) throw ApiError.conflict('CASH_SESSION_REQUIRED', 'Open the cash drawer to refund cash');
      depositAccountId = accounts('CASH_DEFAULT');
    }
    if (p.method === 'cheque') depositAccountId = accounts('BANK_DEFAULT');
    const lines = refundLines({ amount: b.amount, fromCredit, depositAccountId, payer: p.payerType, ...(p.patientId ? { patientId: String(p.patientId) } : {}), ...(p.insuranceCompanyId ? { insuranceCompanyId: String(p.insuranceCompanyId) } : {}) }, accounts);
    const je = await postEntry(auth, { date: await clinicToday(), source: 'refund', sourceId: p._id, memo: `Refund ${p.receiptNumber}`, lines }, s);
    p.unallocated = (p.unallocated ?? 0) - minOf(fromCredit, p.unallocated ?? 0);
    p.refunded = (p.refunded ?? 0) + b.amount;
    p.refunds.push({ amount: b.amount, at: new Date(), reason: b.reason, journalEntryId: je._id, ...(fromInvoices.length ? { invoices: fromInvoices } : {}) });
    p.status = p.refunded >= p.amount ? 'refunded' : 'partially_refunded';
    await p.save({ session: s });
    onCommit(session, () => emit('payment.refunded', { clinicId, paymentId }));
    return p;
  });
  await touchBalances(pay);
  await recordAudit({ action: 'update', entity: 'payment', entityId: paymentId, summary: `refund ${b.amount}`, reason: b.reason });
  return (await serializePayments(auth, [pay.toObject() as unknown as Raw]))[0]!;
}

/** Cheque cleared → bank; bounced → the whole payment is reversed and invoices reopen. */
export async function chequeStatus(auth: AuthContext, paymentId: string, to: 'cleared' | 'bounced') {
  const pay = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const p = await PaymentModel.findById(paymentId).session(s ?? null);
    if (!p || p.method !== 'cheque' || p.cheque?.status !== 'under_collection') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Not a cheque under collection');
    const accounts = await loadAccountMap(s);
    const today = await clinicToday();
    if (to === 'cleared') {
      await postEntry(auth, { date: today, source: 'cheque', sourceId: p._id, memo: `Cheque ${p.cheque.number} cleared`, lines: chequeCleared(p.amount, accounts('BANK_DEFAULT'), accounts) }, s);
    } else {
      await reverseEntry(auth, p.journalEntryId!, { date: today, memo: `Cheque ${p.cheque.number} bounced` }, s);
      for (const a of p.allocations) {
        const inv = await InvoiceModel.findById(a.invoiceId).session(s ?? null);
        if (!inv) continue;
        if (p.payerType === 'insurance') inv.insurancePaid = (inv.insurancePaid ?? 0) - (a.amount ?? 0);
        else inv.amountPaid = (inv.amountPaid ?? 0) - (a.amount ?? 0);
        refreshStatus(inv);
        await inv.save({ session: s });
      }
      p.status = 'void';
    }
    p.set('cheque.status', to);
    await p.save({ session: s });
    return p;
  });
  await touchBalances(pay);
  await recordAudit({ action: 'status_change', entity: 'payment', entityId: paymentId, after: { cheque: to } });
  return (await serializePayments(auth, [pay.toObject() as unknown as Raw]))[0]!;
}

/* ---------- cash sessions (09 §3.3) ---------- */

export async function cashSessionSummary(sessionId: Types.ObjectId | string) {
  const sess = await CashSessionModel.findById(sessionId).lean();
  if (!sess) throw ApiError.notFound();
  const pays = await PaymentModel.find({ cashSessionId: sess._id }).lean();
  const received = sum(pays.map((p) => p.amount));
  const refunds = sum(pays.flatMap((p) => (p.refunds ?? []).filter((r) => r.at && r.at >= sess.openedAt && (!sess.closedAt || r.at <= sess.closedAt)).map((r) => r.amount ?? 0)));
  const expected = (sess.openingFloat ?? 0) + received - refunds;
  return { session: sess, payments: pays.length, received, refunds, expected };
}

export async function currentCashSession() {
  const accounts = await loadAccountMap();
  const open = await CashSessionModel.findOne({ status: 'open', cashAccountId: accounts('CASH_DEFAULT') }).lean();
  if (!open) return null;
  const s = await cashSessionSummary(open._id);
  // Card/transfer totals of the day help reconcile the POS too.
  const others = await PaymentModel.aggregate<{ _id: string; total: number; count: number }>([{ $match: { clinicId: new Types.ObjectId(currentClinicId()), receivedAt: { $gte: open.openedAt }, method: { $ne: 'cash' } } }, { $group: { _id: '$method', total: { $sum: '$amount' }, count: { $sum: 1 } } }]);
  return { id: String(open._id), openedAt: open.openedAt, openedBy: String(open.openedBy), openingFloat: open.openingFloat, received: s.received, refunds: s.refunds, expected: s.expected, payments: s.payments, byMethod: others.map((o) => ({ method: o._id, total: o.total, count: o.count })) };
}

export async function openCashSession(auth: AuthContext, openingFloat: number) {
  const accounts = await loadAccountMap();
  if (await CashSessionModel.exists({ status: 'open', cashAccountId: accounts('CASH_DEFAULT') })) throw ApiError.conflict('CASH_SESSION_ALREADY_OPEN', 'The cash drawer is already open');
  const s = await CashSessionModel.create({ cashAccountId: accounts('CASH_DEFAULT'), openedBy: auth.userId, openingFloat }).catch((err: unknown) => {
    if ((err as { code?: number }).code === 11000) throw ApiError.conflict('CASH_SESSION_ALREADY_OPEN', 'The cash drawer is already open');
    throw err;
  });
  await recordAudit({ action: 'create', entity: 'cashSession', entityId: s._id, after: { openingFloat } });
  return currentCashSession();
}

export async function closeCashSession(auth: AuthContext, b: { countedAmount: number; notes?: string }) {
  const accounts = await loadAccountMap();
  const open = await CashSessionModel.findOne({ status: 'open', cashAccountId: accounts('CASH_DEFAULT') });
  if (!open) throw ApiError.conflict('CASH_SESSION_REQUIRED', 'No open cash drawer');
  const summary = await cashSessionSummary(open._id);
  const difference = b.countedAmount - summary.expected;
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    const lines = cashOverShort(difference, accounts('CASH_DEFAULT'), accounts);
    if (lines.length) {
      const je = await postEntry(auth, { date: await clinicToday(), source: 'cash_session', sourceId: open._id, memo: difference < 0 ? 'Cash short' : 'Cash over', lines }, s);
      open.differenceJournalEntryId = je._id;
    }
    Object.assign(open, { status: 'closed', closedBy: auth.userId, closedAt: new Date(), countedAmount: b.countedAmount, expectedAmount: summary.expected, difference, notes: b.notes ?? '' });
    await open.save({ session: s });
  });
  await recordAudit({ action: 'status_change', entity: 'cashSession', entityId: open._id, after: { expected: summary.expected, counted: b.countedAmount, difference } });
  return { id: String(open._id), expected: summary.expected, counted: b.countedAmount, difference, received: summary.received, refunds: summary.refunds, payments: summary.payments, openingFloat: open.openingFloat, openedAt: open.openedAt, closedAt: open.closedAt };
}

export async function cashSessionHistory(limit = 30) {
  const rows = await CashSessionModel.find({ status: 'closed' }).sort({ closedAt: -1 }).limit(limit).lean();
  return rows.map((r) => ({ id: String(r._id), openedAt: r.openedAt, closedAt: r.closedAt, openingFloat: r.openingFloat, expected: r.expectedAmount, counted: r.countedAmount, difference: r.difference }));
}

/* ---------- insurance claims (09 §3.4) ---------- */

export async function createClaim(auth: AuthContext, b: { invoiceIds: string[]; notes?: string }) {
  const invoices = await InvoiceModel.find({ _id: { $in: b.invoiceIds }, type: 'invoice', status: { $in: ['issued', 'partially_paid'] }, claimId: null });
  if (!invoices.length || invoices.length !== b.invoiceIds.length) throw ApiError.validation([{ path: 'invoiceIds', code: 'not_found' }]);
  const companies = new Set(invoices.map((i) => String(i.insuranceCompanyId ?? '')));
  const patients = new Set(invoices.map((i) => String(i.patientId)));
  if (companies.size !== 1 || companies.has('') || patients.size !== 1) throw ApiError.validation([{ path: 'invoiceIds', code: 'invalid' }]);
  const claimed = sum(invoices.map((i) => dues(i).insuranceDue));
  if (claimed <= 0) throw ApiError.validation([{ path: 'invoiceIds', code: 'invalid_amount' }]);
  const claim = await InsuranceClaimModel.create({
    number: await nextNumber('claim', 'CLM', { year: Number((await clinicToday()).slice(0, 4)) }),
    insuranceCompanyId: invoices[0]!.insuranceCompanyId,
    patientId: invoices[0]!.patientId,
    policyId: invoices[0]!.insurancePolicyId,
    invoiceIds: invoices.map((i) => i._id),
    claimedAmount: claimed,
    notes: b.notes ?? '',
  });
  await InvoiceModel.updateMany({ _id: { $in: invoices.map((i) => i._id) } }, { $set: { claimId: claim._id } });
  await recordAudit({ action: 'create', entity: 'insuranceClaim', entityId: claim._id, after: { claimed } });
  return claimDto(claim.toObject() as never);
}

export function claimDto(c: Record<string, unknown> & { _id: Types.ObjectId; invoiceIds?: Types.ObjectId[] }) {
  return {
    id: String(c._id),
    number: c.number,
    insuranceCompanyId: String(c.insuranceCompanyId),
    patientId: String(c.patientId),
    policyId: id(c.policyId),
    invoiceIds: (c.invoiceIds ?? []).map(String),
    claimedAmount: c.claimedAmount,
    approvedAmount: c.approvedAmount,
    paidAmount: c.paidAmount,
    shortfallMode: c.shortfallMode,
    status: c.status,
    submittedAt: c.submittedAt,
    responseAt: c.responseAt,
    rejectionReason: c.rejectionReason,
    notes: c.notes ?? '',
    createdAt: c.createdAt,
  };
}

export async function listClaims(q: { status?: string; insuranceCompanyId?: string }) {
  const rows = await InsuranceClaimModel.find({ ...(q.status ? { status: q.status } : {}), ...(q.insuranceCompanyId ? { insuranceCompanyId: q.insuranceCompanyId } : {}) }).sort({ createdAt: -1 }).limit(300).lean();
  const [patients, companies] = await Promise.all([
    PatientModel.find({ _id: { $in: rows.map((r) => r.patientId) } }).select('fullName fileNumber').lean(),
    InsuranceCompanyModel.find({ _id: { $in: rows.map((r) => r.insuranceCompanyId) } }).select('name').lean(),
  ]);
  const pm = new Map(patients.map((p) => [String(p._id), p]));
  const cm = new Map(companies.map((c) => [String(c._id), c.name]));
  return rows.map((r) => ({ ...claimDto(r as never), patient: pm.get(String(r.patientId)) ? { fullName: pm.get(String(r.patientId))!.fullName, fileNumber: pm.get(String(r.patientId))!.fileNumber } : undefined, insuranceCompanyName: cm.get(String(r.insuranceCompanyId)) ?? '' }));
}

export async function claimTransition(auth: AuthContext, claimId: string, b: { to: 'submitted' | 'approved' | 'rejected'; approvedAmount?: number; shortfallMode?: 'write_off' | 'rebill'; reason?: string }) {
  const claim = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const c = await InsuranceClaimModel.findById(claimId).session(s ?? null);
    if (!c) throw ApiError.notFound();
    const flow: Record<string, string[]> = { draft: ['submitted'], submitted: ['approved', 'rejected'] };
    if (!flow[c.status]?.includes(b.to)) throw ApiError.conflict('INVALID_STATE_TRANSITION', `Cannot go from ${c.status} to ${b.to}`);
    const now = new Date();
    if (b.to === 'submitted') {
      c.status = 'submitted';
      c.submittedAt = now;
    } else {
      const approved = b.to === 'rejected' ? 0 : (b.approvedAmount ?? c.claimedAmount);
      if (approved > c.claimedAmount) throw ApiError.validation([{ path: 'approvedAmount', code: 'exceeds_amount', params: { max: c.claimedAmount } }]);
      const shortfall = c.claimedAmount - approved;
      if (shortfall > 0 && !b.shortfallMode) throw ApiError.validation([{ path: 'shortfallMode', code: 'required' }]);
      c.approvedAmount = approved;
      c.responseAt = now;
      c.status = b.to === 'rejected' ? 'rejected' : shortfall > 0 ? 'partially_approved' : 'approved';
      if (b.reason) c.rejectionReason = b.reason;
      if (shortfall > 0) {
        c.shortfallMode = b.shortfallMode;
        // Move the shortfall off the insurance share, spread over the claim's invoices.
        // A write-off is split per doctor by their outstanding share of each invoice (09 §8.1).
        let left = shortfall;
        const doctorParts = new Map<string, number>();
        const invs = await InvoiceModel.find({ _id: { $in: c.invoiceIds } }).session(s ?? null);
        for (const inv of invs) {
          const take = minOf(left, dues(inv).insuranceDue);
          if (take <= 0) continue;
          if (b.shortfallMode === 'write_off') {
            for (const [k, v] of splitByDoctor(take, splitByDoctor(dues(inv).balanceDue, doctorWeights(inv)))) doctorParts.set(k, (doctorParts.get(k) ?? 0) + v);
          }
          inv.insuranceTotal = (inv.insuranceTotal ?? 0) - take;
          if (b.shortfallMode === 'rebill') inv.patientTotal = (inv.patientTotal ?? 0) + take;
          else inv.writtenOff = (inv.writtenOff ?? 0) + take;
          refreshStatus(inv);
          await inv.save({ session: s });
          left -= take;
        }
        if (left > 0 && b.shortfallMode === 'write_off') doctorParts.set(UNASSIGNED, (doctorParts.get(UNASSIGNED) ?? 0) + left);
        const accounts = await loadAccountMap(s);
        const parts = [...doctorParts].filter(([, v]) => v > 0).map(([k, v]) => ({ amount: v, ...(k ? { dentistId: k } : {}) }));
        const je = await postEntry(auth, { date: await clinicToday(), source: 'claim', sourceId: c._id, memo: `${c.number} shortfall`, lines: claimShortfall({ amount: shortfall, patientId: String(c.patientId), insuranceCompanyId: String(c.insuranceCompanyId), mode: b.shortfallMode!, doctorParts: parts }, accounts) }, s);
        c.shortfallJournalId = je._id;
      }
    }
    await c.save({ session: s });
    return c;
  });
  await refreshPatientBalance(String(claim.patientId));
  await recordAudit({ action: 'status_change', entity: 'insuranceClaim', entityId: claimId, after: { status: claim.status, approved: claim.approvedAmount } });
  return claimDto(claim.toObject() as never);
}

async function settleClaimStatus(claimId: string) {
  const c = await InsuranceClaimModel.findById(claimId);
  if (c && ['approved', 'partially_approved'].includes(c.status) && (c.paidAmount ?? 0) >= (c.approvedAmount ?? 0)) {
    c.status = 'paid';
    await c.save();
  }
}
