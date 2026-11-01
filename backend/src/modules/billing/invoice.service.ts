import { Types, type ClientSession } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { onCommit, withTransaction } from '@/core/db/transaction';
import { emit } from '@/core/events/bus';
import { ApiError } from '@/core/http/ApiError';
import { fieldPolicyOf, scopeFor } from '@/core/rbac/authorize';
import { applyFieldPolicy } from '@/core/rbac/fieldPolicy';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicProcedureModel, TaxRateModel } from '@/modules/clinic/clinic.models';
import { policyCoverage } from '@/modules/clinical/chart.service';
import { PerformedProcedureModel } from '@/modules/clinical/clinical.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { allocate, maxOf, minOf, mul, mulRate, percentToBasisPoints, sub, sum } from '@/shared/money';
import { AccountModel, JournalEntryModel } from '@/modules/accounting/accounting.models';
import { clinicToday, loadAccountMap, postEntry, reverseEntry } from '@/modules/accounting/journal.service';
import { creditNote as creditNoteLines, invoiceIssued, type AccountMap } from '@/modules/accounting/posting/postingRules';
import { REVENUE_BY_CATEGORY } from '@/modules/accounting/seed/chartOfAccounts.jo';
import { StaffModel } from '@/modules/staff/staff.model';
import { doctorInvoiceFilter } from './attribution';
import { InvoiceModel, type InvoiceDoc } from './billing.models';

const RESOURCE = 'billing.invoice';

/* ---------- totals (server-side only, 09 §3.1) ---------- */

type LineIn = { quantity: number; unitPrice: number; discount: number; taxRate: number; category?: string | null };

/** Recomputes every money field of a draft. Client totals are never trusted. */
export function computeTotals(lines: LineIn[], invoiceDiscount: number, coveragePercent: (category: string) => number, insuranceRemaining: number | null) {
  const gross = lines.map((l) => mul(l.unitPrice, l.quantity));
  const lineNet = lines.map((l, i) => maxOf(0, sub(gross[i]!, l.discount)));
  // Invoice-level discount is spread across lines by their net value.
  const spread = invoiceDiscount > 0 ? allocate(minOf(invoiceDiscount, sum(lineNet)), lineNet.map((n) => n || 0)) : lines.map(() => 0);
  let remaining = insuranceRemaining;
  const out = lines.map((l, i) => {
    const discount = l.discount + spread[i]!;
    const net = maxOf(0, sub(gross[i]!, discount));
    const taxAmount = mulRate(net, l.taxRate);
    const lineTotal = net + taxAmount;
    let insuranceShare = coveragePercent(l.category ?? 'other') > 0 ? mulRate(net, percentToBasisPoints(coveragePercent(l.category ?? 'other'))) : 0;
    if (remaining !== null) {
      insuranceShare = minOf(insuranceShare, remaining);
      remaining = sub(remaining, insuranceShare);
    }
    return { gross: gross[i]!, discount, taxAmount, lineTotal, insuranceShare, patientShare: lineTotal - insuranceShare };
  });
  return {
    lines: out,
    subtotal: sum(out.map((l) => l.gross)),
    discountTotal: sum(out.map((l) => l.discount)),
    taxTotal: sum(out.map((l) => l.taxAmount)),
    total: sum(out.map((l) => l.lineTotal)),
    insuranceTotal: sum(out.map((l) => l.insuranceShare)),
    patientTotal: sum(out.map((l) => l.patientShare)),
  };
}

export function dues(inv: { total?: number | null; amountPaid?: number | null; insurancePaid?: number | null; creditedTotal?: number | null; writtenOff?: number | null; patientTotal?: number | null; insuranceTotal?: number | null }) {
  const total = inv.total ?? 0;
  const balanceDue = maxOf(0, total - (inv.amountPaid ?? 0) - (inv.insurancePaid ?? 0) - (inv.creditedTotal ?? 0) - (inv.writtenOff ?? 0));
  const insuranceDue = minOf(balanceDue, maxOf(0, (inv.insuranceTotal ?? 0) - (inv.insurancePaid ?? 0)));
  const patientDue = minOf(balanceDue, maxOf(0, (inv.patientTotal ?? 0) - (inv.amountPaid ?? 0) - (inv.creditedTotal ?? 0)));
  return { balanceDue, insuranceDue, patientDue };
}

/** Re-derives balance and status after payments, credits or write-offs. */
export function refreshStatus(inv: InvoiceDoc) {
  const d = dues(inv);
  inv.balanceDue = d.balanceDue;
  if (inv.type === 'credit_note' || inv.status === 'void' || inv.status === 'draft') return;
  const received = (inv.amountPaid ?? 0) + (inv.insurancePaid ?? 0);
  inv.status = d.balanceDue === 0 ? 'paid' : received > 0 ? 'partially_paid' : 'issued';
}

/* ---------- DTO ---------- */

type Raw = Record<string, unknown> & { _id: Types.ObjectId; __v?: number; lines?: Record<string, unknown>[] };
const id = (v: unknown) => (v ? String(v) : undefined);

export function toInvoiceDto(i: Raw, patient?: { fullName?: string | null; fileNumber?: string | null } | null, names: Map<string, string> = new Map()) {
  const d = dues(i as never);
  const header = id(i.dentistId);
  const doctorIds = [...new Set((i.lines ?? []).map((l) => id(l.dentistId) ?? header).filter((x): x is string => Boolean(x)))];
  return {
    id: String(i._id),
    version: i.__v ?? 0,
    number: i.number,
    type: i.type,
    status: i.status,
    patientId: String(i.patientId),
    patient: patient ? { fullName: patient.fullName ?? '', fileNumber: patient.fileNumber ?? '' } : undefined,
    insurancePolicyId: id(i.insurancePolicyId),
    insuranceCompanyId: id(i.insuranceCompanyId),
    appointmentId: id(i.appointmentId),
    dentistId: header,
    dentist: header ? { id: header, name: names.get(header) ?? '' } : undefined,
    doctors: doctorIds.map((x) => ({ id: x, name: names.get(x) ?? '' })),
    multipleDoctors: doctorIds.length > 1,
    lines: (i.lines ?? []).map((l) => ({
      id: String(l._id),
      performedProcedureId: id(l.performedProcedureId),
      clinicProcedureId: id(l.clinicProcedureId),
      description: l.description,
      category: l.category,
      toothNumbers: l.toothNumbers ?? [],
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discount: l.discount,
      taxRateId: id(l.taxRateId),
      taxAmount: l.taxAmount,
      lineTotal: l.lineTotal,
      insuranceShare: l.insuranceShare,
      patientShare: l.patientShare,
      dentistId: id(l.dentistId),
      dentistName: l.dentistId ? (names.get(String(l.dentistId)) ?? '') : undefined,
      // Lines from a recorded procedure keep the doctor who performed it (09 §3.1).
      dentistLocked: Boolean(l.performedProcedureId),
    })),
    invoiceDiscount: i.invoiceDiscount ?? 0,
    discountReason: i.discountReason ?? '',
    subtotal: i.subtotal,
    discountTotal: i.discountTotal,
    taxTotal: i.taxTotal,
    total: i.total,
    insuranceTotal: i.insuranceTotal,
    patientTotal: i.patientTotal,
    amountPaid: i.amountPaid,
    insurancePaid: i.insurancePaid,
    creditedTotal: i.creditedTotal,
    writtenOff: i.writtenOff ?? 0,
    balanceDue: d.balanceDue,
    patientDue: d.patientDue,
    insuranceDue: d.insuranceDue,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    installmentPlan: i.installmentPlan ?? [],
    originalInvoiceId: id(i.originalInvoiceId),
    journalEntryId: id(i.journalEntryId),
    claimId: id(i.claimId),
    notes: i.notes ?? '',
    voidReason: i.voidReason,
    einvoice: i.einvoice,
    createdAt: i.createdAt,
  };
}
export type InvoiceDto = ReturnType<typeof toInvoiceDto>;

export async function serializeInvoices(auth: AuthContext, rows: Raw[]) {
  const policy = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  const patients = new Map((await PatientModel.find({ _id: { $in: rows.map((r) => r.patientId) } }).select('fullName fileNumber').lean()).map((p) => [String(p._id), p]));
  const names = policy.visible.has('dentist') ? await dentistNames(rows) : new Map<string, string>();
  return rows.map((r) => applyFieldPolicy(toInvoiceDto(r, policy.visible.has('patient') ? patients.get(String(r.patientId)) : null, names), policy));
}

async function dentistNames(rows: Raw[]) {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.dentistId) ids.add(String(r.dentistId));
    for (const l of r.lines ?? []) if (l.dentistId) ids.add(String(l.dentistId));
  }
  if (!ids.size) return new Map<string, string>();
  const staff = await StaffModel.find({ _id: { $in: [...ids] } }).select('name').lean();
  return new Map(staff.map((x) => [String(x._id), x.name ?? '']));
}

/**
 * Own scope for invoices (04 §3): invoices where I am the header doctor or the doctor of any line.
 * A shared invoice is visible in full; changing it still needs the update/issue/void permissions.
 */
export function ownInvoiceFilter(auth: AuthContext): Record<string, unknown> {
  return scopeFor(auth, `${RESOURCE}.read`) === 'own' ? doctorInvoiceFilter(auth.staffId ?? '000000000000000000000000') : {};
}

/** A billable doctor: an active dentist or hygienist of this clinic (tenant-scoped query). */
export const BILLABLE_STAFF_TYPES = ['dentist', 'hygienist'] as const;
export async function assertDentists(entries: { path: string; id: string | undefined }[]) {
  const wanted = entries.filter((e): e is { path: string; id: string } => Boolean(e.id));
  if (!wanted.length) return;
  const ok = new Set(
    (await StaffModel.find({ _id: { $in: [...new Set(wanted.map((e) => e.id))].filter((x) => Types.ObjectId.isValid(x)) }, staffType: { $in: BILLABLE_STAFF_TYPES }, status: 'active' }).select('_id').lean()).map((x) => String(x._id)),
  );
  const bad = wanted.filter((e) => !ok.has(e.id));
  if (bad.length) throw ApiError.validation(bad.map((e) => ({ path: e.path, code: 'not_dentist' })));
}

export async function listBillableDentists(auth: AuthContext) {
  const own = scopeFor(auth, `${RESOURCE}.create`) !== 'all' && scopeFor(auth, `${RESOURCE}.read`) === 'own';
  const rows = await StaffModel.find({ staffType: { $in: BILLABLE_STAFF_TYPES }, status: 'active', ...(own ? { _id: new Types.ObjectId(auth.staffId) } : {}) }).select('name').sort({ name: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), name: r.name ?? '' }));
}

export async function loadInvoice(auth: AuthContext | null, invoiceId: string, session?: ClientSession) {
  if (!Types.ObjectId.isValid(invoiceId)) throw ApiError.notFound();
  const own = auth ? ownInvoiceFilter(auth) : {};
  const inv = await InvoiceModel.findOne({ _id: invoiceId, ...own }).session(session ?? null);
  if (!inv) throw ApiError.notFound();
  return inv;
}

/* ---------- drafts ---------- */

export type DraftLineInput = { id?: string; performedProcedureId?: string; clinicProcedureId?: string; description?: string; toothNumbers?: number[]; quantity?: number; unitPrice?: number; discount?: number; taxRateId?: string | null; dentistId?: string };

async function defaultTaxRate() {
  return TaxRateModel.findOne({ isDefault: true, isActive: true }).lean();
}

/** Resolves catalogue data for each line (price, tax, category, revenue account). */
async function buildLines(input: DraftLineInput[], existing: InvoiceDoc | null, canPrice: boolean, insuranceCompanyId?: string, headerDentistId?: string) {
  const accounts = await loadAccountMap();
  const defTax = await defaultTaxRate();
  const out = [];
  const toCheck: { path: string; id: string }[] = [];
  for (const [i, l] of input.entries()) {
    const prev = l.id ? existing?.lines.find((x) => String(x._id) === l.id) : undefined;
    const performedId = l.performedProcedureId ?? (prev?.performedProcedureId ? String(prev.performedProcedureId) : undefined);
    const performed = performedId ? await PerformedProcedureModel.findOne({ _id: performedId, status: 'completed' }).lean() : null;
    if (performedId && !performed) throw ApiError.validation([{ path: `lines.${i}.performedProcedureId`, code: 'not_found' }]);
    // The doctor of a recorded procedure is fixed (09 §3.1); billing never reassigns it.
    if (performed && l.dentistId && l.dentistId !== String(performed.dentistId)) {
      throw ApiError.conflict('PROCEDURE_DENTIST_LOCKED', 'The doctor of a recorded procedure cannot be changed on the invoice', { fields: [`lines.${i}.dentistId`] });
    }
    if (!performed && l.dentistId && l.dentistId !== (prev?.dentistId ? String(prev.dentistId) : undefined)) toCheck.push({ path: `lines.${i}.dentistId`, id: l.dentistId });
    const cpId = l.clinicProcedureId ?? (performed ? String(performed.clinicProcedureId) : prev?.clinicProcedureId ? String(prev.clinicProcedureId) : undefined);
    const cp = cpId ? await ClinicProcedureModel.findById(cpId).lean() : null;
    if (cpId && !cp) throw ApiError.validation([{ path: `lines.${i}.clinicProcedureId`, code: 'not_found' }]);
    if (!cp && !l.description) throw ApiError.validation([{ path: `lines.${i}.description`, code: 'required' }]);
    const listPrice = performed?.unitPrice ?? (cp ? (cp.insurancePrices?.find((p) => String(p.insuranceCompanyId) === insuranceCompanyId)?.price ?? cp.price) : 0);
    const unitPrice = l.unitPrice ?? prev?.unitPrice ?? listPrice ?? 0;
    if (l.unitPrice !== undefined && l.unitPrice !== listPrice && l.unitPrice !== prev?.unitPrice && !canPrice) {
      throw ApiError.forbidden('FIELD_FORBIDDEN', 'Changing the price needs discount rights', { fields: [`lines.${i}.unitPrice`] });
    }
    const taxId = l.taxRateId === null ? null : (l.taxRateId ?? (prev?.taxRateId ? String(prev.taxRateId) : cp?.taxRateId ? String(cp.taxRateId) : defTax ? String(defTax._id) : null));
    const tax = taxId ? await TaxRateModel.findById(taxId).lean() : null;
    const category = cp?.category ?? performed?.category ?? 'other';
    out.push({
      ...(prev ? { _id: prev._id } : {}),
      performedProcedureId: performed?._id,
      clinicProcedureId: cp?._id,
      description: l.description ?? prev?.description ?? cp?.code ?? '',
      category,
      toothNumbers: l.toothNumbers ?? performed?.toothNumbers ?? prev?.toothNumbers ?? [],
      quantity: l.quantity ?? performed?.quantity ?? prev?.quantity ?? 1,
      unitPrice,
      discount: l.discount ?? (performed ? performed.discount : (prev?.discount ?? 0)),
      taxRateId: tax?._id,
      taxRate: tax?.rate ?? 0,
      revenueAccountId: new Types.ObjectId(accounts(REVENUE_BY_CATEGORY[category] ?? 'REVENUE_DEFAULT')),
      dentistId: performed ? performed.dentistId : l.dentistId ? new Types.ObjectId(l.dentistId) : (prev?.dentistId ?? (headerDentistId ? new Types.ObjectId(headerDentistId) : undefined)),
    });
  }
  await assertDentists(toCheck);
  return out;
}

async function applyTotals(inv: InvoiceDoc) {
  const cov = await policyCoverage(inv.insurancePolicyId ? String(inv.insurancePolicyId) : null).catch(() => null);
  inv.insuranceCompanyId = cov ? new Types.ObjectId(cov.insuranceCompanyId) : undefined;
  const t = computeTotals(
    inv.lines.map((l) => ({ quantity: l.quantity ?? 1, unitPrice: l.unitPrice ?? 0, discount: l.discount ?? 0, taxRate: l.taxRate ?? 0, category: l.category })),
    inv.invoiceDiscount ?? 0,
    cov ? cov.percentFor : () => 0,
    cov?.remaining ?? null,
  );
  inv.lines.forEach((l, i) => {
    const c = t.lines[i]!;
    l.discount = c.discount;
    l.taxAmount = c.taxAmount;
    l.lineTotal = c.lineTotal;
    l.insuranceShare = c.insuranceShare;
    l.patientShare = c.patientShare;
  });
  Object.assign(inv, { subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, total: t.total, insuranceTotal: t.insuranceTotal, patientTotal: t.patientTotal });
  inv.balanceDue = t.total;
}

/** Discount above the clinic threshold needs `billing.invoice.discount` (09 §3.1). */
async function assertDiscountAllowed(auth: AuthContext, inv: InvoiceDoc) {
  if (auth.isOwner || scopeFor(auth, 'billing.invoice.discount')) return;
  if (!inv.discountTotal) return;
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.maxDiscountPercentWithoutApproval').lean());
  const max = (clinic?.settings as { maxDiscountPercentWithoutApproval?: number } | undefined)?.maxDiscountPercentWithoutApproval ?? 0;
  if (inv.subtotal && (inv.discountTotal * 100) / inv.subtotal > max) throw ApiError.forbidden('DISCOUNT_NEEDS_APPROVAL', 'This discount needs approval', { maxPercent: max });
}

const canPrice = (auth: AuthContext) => auth.isOwner || Boolean(scopeFor(auth, 'billing.invoice.discount'));

export type DraftInput = { patientId: string; appointmentId?: string; dentistId?: string; insurancePolicyId?: string | null; lines: DraftLineInput[]; invoiceDiscount?: number; discountReason?: string; dueDate?: string; notes?: string; installmentPlan?: { dueDate: string; amount: number }[] };

export async function createDraft(auth: AuthContext, b: DraftInput) {
  const patient = await PatientModel.findById(b.patientId).select('status').lean();
  if (!patient) throw ApiError.validation([{ path: 'patientId', code: 'not_found' }]);
  await assertDentists([{ path: 'dentistId', id: b.dentistId }]);
  const inv = new InvoiceModel({ patientId: b.patientId, appointmentId: b.appointmentId, dentistId: b.dentistId, insurancePolicyId: b.insurancePolicyId ?? undefined, invoiceDiscount: b.invoiceDiscount ?? 0, discountReason: b.discountReason ?? '', dueDate: b.dueDate, notes: b.notes ?? '', installmentPlan: b.installmentPlan ?? [] });
  const cov = await policyCoverage(b.insurancePolicyId ?? null).catch(() => null);
  inv.set('lines', await buildLines(b.lines, null, canPrice(auth), cov?.insuranceCompanyId, b.dentistId));
  await applyTotals(inv);
  await assertDiscountAllowed(auth, inv);
  await inv.save();
  await linkProcedures(inv);
  await recordAudit({ action: 'create', entity: 'invoice', entityId: inv._id, after: { patientId: b.patientId, total: inv.total, status: 'draft' } });
  return (await serializeInvoices(auth, [inv.toObject() as unknown as Raw]))[0]!;
}

export async function updateDraft(auth: AuthContext, invoiceId: string, b: Partial<DraftInput> & { version?: number }) {
  const inv = await loadInvoice(auth, invoiceId);
  if (inv.status !== 'draft') throw ApiError.conflict('INVOICE_NOT_DRAFT', 'Issued invoices cannot be edited; use a credit note');
  if (b.version !== undefined && b.version !== inv.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this invoice');
  if (b.dentistId !== undefined && b.dentistId !== (inv.dentistId ? String(inv.dentistId) : undefined)) await assertDentists([{ path: 'dentistId', id: b.dentistId }]);
  if (b.insurancePolicyId !== undefined) inv.set('insurancePolicyId', b.insurancePolicyId ?? undefined);
  for (const k of ['invoiceDiscount', 'discountReason', 'dueDate', 'notes', 'installmentPlan', 'dentistId'] as const) if (b[k] !== undefined) inv.set(k, b[k]);
  if (b.lines) {
    const cov = await policyCoverage(inv.insurancePolicyId ? String(inv.insurancePolicyId) : null).catch(() => null);
    const before = inv.lines.map((l) => (l.performedProcedureId ? String(l.performedProcedureId) : '')).filter(Boolean);
    inv.set('lines', await buildLines(b.lines, inv, canPrice(auth), cov?.insuranceCompanyId, inv.dentistId ? String(inv.dentistId) : undefined));
    const after = new Set(inv.lines.map((l) => (l.performedProcedureId ? String(l.performedProcedureId) : '')));
    await PerformedProcedureModel.updateMany({ _id: { $in: before.filter((x) => !after.has(x)) } }, { $unset: { invoiceId: 1 } });
  }
  await applyTotals(inv);
  await assertDiscountAllowed(auth, inv);
  await inv.save();
  await linkProcedures(inv);
  await recordAudit({ action: 'update', entity: 'invoice', entityId: inv._id, after: { total: inv.total } });
  return (await serializeInvoices(auth, [inv.toObject() as unknown as Raw]))[0]!;
}

async function linkProcedures(inv: InvoiceDoc, session?: ClientSession) {
  const ids = inv.lines.map((l) => l.performedProcedureId).filter(Boolean);
  if (ids.length) await PerformedProcedureModel.updateMany({ _id: { $in: ids } }, { $set: { invoiceId: inv._id } }, { session });
}

export async function deleteDraft(auth: AuthContext, invoiceId: string) {
  const inv = await loadInvoice(auth, invoiceId);
  if (inv.status !== 'draft') throw ApiError.conflict('INVOICE_NOT_DRAFT', 'Only drafts can be deleted');
  await PerformedProcedureModel.updateMany({ invoiceId: inv._id }, { $unset: { invoiceId: 1 } });
  await inv.deleteOne();
  await recordAudit({ action: 'delete', entity: 'invoice', entityId: invoiceId });
}

/* ---------- automatic drafts from visits (09 §3.1, 07 §4) ---------- */

/** Adds a performed procedure to the visit's open draft (or a new one). */
export async function addProcedureToDraft(procedureId: string) {
  const p = await PerformedProcedureModel.findById(procedureId).lean();
  if (!p || p.invoiceId || p.status !== 'completed') return;
  const filter = p.appointmentId ? { appointmentId: p.appointmentId, status: 'draft' } : { patientId: p.patientId, status: 'draft', appointmentId: null };
  let inv = await InvoiceModel.findOne(filter);
  if (!inv) {
    const { InsurancePolicyModel } = await import('@/modules/patients/patient.models');
    const policy = await InsurancePolicyModel.findOne({ patientId: p.patientId, isPrimary: true }).select('_id validTo').lean();
    const today = await clinicToday();
    inv = new InvoiceModel({ patientId: p.patientId, appointmentId: p.appointmentId, dentistId: p.dentistId, insurancePolicyId: policy && (!policy.validTo || policy.validTo >= today) ? policy._id : undefined });
  }
  const cov = await policyCoverage(inv.insurancePolicyId ? String(inv.insurancePolicyId) : null).catch(() => null);
  const [line] = await buildLines([{ performedProcedureId: procedureId }], null, true, cov?.insuranceCompanyId);
  inv.lines.push(line!);
  await applyTotals(inv);
  await inv.save();
  await PerformedProcedureModel.updateOne({ _id: procedureId }, { $set: { invoiceId: inv._id } });
}

export async function removeProcedureFromDraft(procedureId: string) {
  const inv = await InvoiceModel.findOne({ 'lines.performedProcedureId': new Types.ObjectId(procedureId), status: 'draft' });
  if (!inv) return;
  inv.set('lines', inv.lines.filter((l) => String(l.performedProcedureId) !== procedureId));
  if (!inv.lines.length) {
    await inv.deleteOne();
    return;
  }
  await applyTotals(inv);
  await inv.save();
}

/* ---------- issue (idempotent, transactional) ---------- */

function postingInput(inv: InvoiceDoc, discountsGross: boolean, accounts: AccountMap, taxAccounts: Map<string, string>, scale = 1) {
  const scaled = (n: number) => (scale === 1 ? n : Math.round(n * scale));
  return {
    patientId: String(inv.patientId),
    ...(inv.insuranceCompanyId ? { insuranceCompanyId: String(inv.insuranceCompanyId) } : {}),
    discountsGross,
    lines: inv.lines.map((l) => {
      const gross = scaled(mul(l.unitPrice ?? 0, l.quantity ?? 1));
      const discount = scaled(l.discount ?? 0);
      const tax = scaled(l.taxAmount ?? 0);
      const insuranceShare = scaled(l.insuranceShare ?? 0);
      return {
        revenueAccountId: l.revenueAccountId ? String(l.revenueAccountId) : accounts('REVENUE_DEFAULT'),
        gross,
        discount,
        tax,
        ...(l.taxRateId && taxAccounts.get(String(l.taxRateId)) ? { taxAccountId: taxAccounts.get(String(l.taxRateId))! } : {}),
        ...(l.dentistId ? { dentistId: String(l.dentistId) } : {}),
        // Derived so each line balances exactly even after scaling/rounding.
        patientShare: gross - discount + tax - insuranceShare,
        insuranceShare,
      };
    }),
  };
}

async function taxAccountMap() {
  const rates = await TaxRateModel.find({ outputAccountId: { $exists: true, $ne: null } }).select('outputAccountId').lean();
  return new Map(rates.map((r) => [String(r._id), String(r.outputAccountId)]));
}

export async function issueInvoice(auth: AuthContext, invoiceId: string, opts: { issueDate?: string; dueDate?: string } = {}) {
  const clinicId = String(currentClinicId());
  const result = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const inv = await loadInvoice(auth, invoiceId, s);
    if (inv.status !== 'draft') return { inv, already: true };
    if (!inv.lines.length) throw ApiError.conflict('INVOICE_EMPTY', 'Add at least one line before issuing');
    // Every issued invoice is attributed (09 §3.1): a valid header doctor, and each line has a doctor.
    const header = inv.dentistId ? String(inv.dentistId) : undefined;
    const active = header ? await StaffModel.exists({ _id: header, staffType: { $in: BILLABLE_STAFF_TYPES }, status: 'active' }).session(s ?? null) : null;
    if (!active) throw ApiError.conflict('DENTIST_REQUIRED', 'Choose the responsible doctor before issuing', { fields: ['dentistId'] });
    for (const l of inv.lines) if (!l.dentistId) l.dentistId = inv.dentistId;
    await applyTotals(inv);
    await assertDiscountAllowed(auth, inv);
    const issueDate = opts.issueDate ?? (await clinicToday());
    const year = Number(issueDate.slice(0, 4));
    const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('settings.numbering settings.postDiscountsNet integrations.jofotara.enabled').lean());
    inv.number = await nextNumber('invoice', clinic?.settings?.numbering?.invoice ?? 'INV', { year, session: s ?? null });
    inv.issueDate = issueDate;
    inv.dueDate = opts.dueDate ?? inv.dueDate ?? issueDate;
    inv.issuedBy = new Types.ObjectId(auth.userId);
    inv.status = 'issued';
    if (inv.total > 0) {
      const accounts = await loadAccountMap(s);
      const lines = invoiceIssued(postingInput(inv, !(clinic?.settings as { postDiscountsNet?: boolean } | undefined)?.postDiscountsNet, accounts, await taxAccountMap()), accounts);
      const je = await postEntry(auth, { date: issueDate, source: 'invoice', sourceId: inv._id, memo: inv.number, lines }, s);
      inv.journalEntryId = je._id;
    }
    refreshStatus(inv);
    if (clinic?.integrations?.jofotara?.enabled) inv.set('einvoice.status', 'queued');
    // optimisticConcurrency: a second concurrent issue fails here instead of double posting.
    await inv.save({ session: s });
    await PerformedProcedureModel.updateMany({ invoiceId: inv._id }, { $set: { invoiceIssued: true } }, { session: s });
    onCommit(session, async () => {
      await emit('invoice.issued', { clinicId, invoiceId });
    });
    return { inv, already: false };
  }).catch(async (err: unknown) => {
    if ((err as { name?: string }).name === 'VersionError') return { inv: await loadInvoice(auth, invoiceId), already: true };
    throw err;
  });
  if (!result.already) {
    await refreshPatientBalance(String(result.inv.patientId));
    await recordAudit({ action: 'post', entity: 'invoice', entityId: result.inv._id, after: { number: result.inv.number, total: result.inv.total } });
  }
  return (await serializeInvoices(auth, [result.inv.toObject() as unknown as Raw]))[0]!;
}

/* ---------- void & credit note ---------- */

export async function voidInvoice(auth: AuthContext, invoiceId: string, reason: string) {
  const inv = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const doc = await loadInvoice(auth, invoiceId, s);
    if ((doc.amountPaid ?? 0) + (doc.insurancePaid ?? 0) > 0 || (doc.creditedTotal ?? 0) > 0) throw ApiError.conflict('INVOICE_HAS_PAYMENTS', 'Invoices with payments or credits need a credit note');
    if (doc.type !== 'invoice' || doc.status !== 'issued') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Only issued invoices can be voided');
    const today = await clinicToday();
    if (doc.issueDate?.slice(0, 7) !== today.slice(0, 7)) throw ApiError.conflict('PERIOD_CLOSED', 'Voiding is only allowed in the same period; use a credit note');
    if (doc.journalEntryId) await reverseEntry(auth, doc.journalEntryId, { date: today, memo: `Void ${doc.number}`, source: 'void' }, s);
    doc.status = 'void';
    doc.voidReason = reason;
    doc.balanceDue = 0;
    await doc.save({ session: s });
    await PerformedProcedureModel.updateMany({ invoiceId: doc._id }, { $set: { invoiceIssued: false }, $unset: { invoiceId: 1 } }, { session: s });
    return doc;
  });
  await refreshPatientBalance(String(inv.patientId));
  await recordAudit({ action: 'status_change', entity: 'invoice', entityId: invoiceId, after: { status: 'void' }, reason });
  return (await serializeInvoices(auth, [inv.toObject() as unknown as Raw]))[0]!;
}

/**
 * Credit note (09 §3.1/§4.3) for all or part of an issued invoice. Credits beyond what the
 * patient still owes become patient credit (refundable or usable on other invoices).
 */
export async function createCreditNote(auth: AuthContext, invoiceId: string, b: { amount?: number; reason: string }) {
  const clinicId = String(currentClinicId());
  const result = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const orig = await loadInvoice(auth, invoiceId, s);
    if (orig.type !== 'invoice' || !['issued', 'partially_paid', 'paid'].includes(orig.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Only issued invoices can be credited');
    const creditable = (orig.total ?? 0) - (orig.creditedTotal ?? 0) - (orig.writtenOff ?? 0);
    const amount = b.amount ?? creditable;
    if (amount <= 0 || amount > creditable) throw ApiError.validation([{ path: 'amount', code: 'exceeds_amount', params: { max: creditable } }]);
    const scale = amount / (orig.total || 1);
    const today = await clinicToday();
    const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('settings.numbering settings.postDiscountsNet').lean());
    const accounts = await loadAccountMap(s);
    const input = postingInput(orig, !(clinic?.settings as { postDiscountsNet?: boolean } | undefined)?.postDiscountsNet, accounts, await taxAccountMap(), scale);
    // Make the scaled parts add up exactly to `amount` (rounding goes to the last line).
    const parts = input.lines.map((l) => l.gross - (input.discountsGross ? 0 : l.discount) + l.tax - (input.discountsGross ? l.discount : 0));
    const drift = amount - sum(parts);
    if (drift && input.lines.length) {
      const last = input.lines[input.lines.length - 1]!;
      last.gross += drift;
      last.patientShare += drift;
    }
    const lines = creditNoteLines(input, accounts);
    // Patient part beyond what is still owed moves from AR to patient credit.
    const { patientDue } = dues(orig);
    const patientCredited = sum(input.lines.map((l) => l.patientShare));
    const excess = maxOf(0, patientCredited - patientDue);
    if (excess > 0) lines.push({ accountId: accounts('AR_PATIENTS'), debit: excess, credit: 0, patientId: String(orig.patientId) }, { accountId: accounts('PATIENT_CREDIT'), debit: 0, credit: excess, patientId: String(orig.patientId) });
    const number = await nextNumber('creditNote', clinic?.settings?.numbering?.creditNote ?? 'CN', { year: Number(today.slice(0, 4)), session: s ?? null });
    const cn = new InvoiceModel({
      number,
      type: 'credit_note',
      status: 'issued',
      patientId: orig.patientId,
      insuranceCompanyId: orig.insuranceCompanyId,
      dentistId: orig.dentistId,
      originalInvoiceId: orig._id,
      lines: orig.lines.map((l, i) => ({ description: l.description, category: l.category, clinicProcedureId: l.clinicProcedureId, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate, taxAmount: Math.round((l.taxAmount ?? 0) * scale), lineTotal: parts[i]! + (i === orig.lines.length - 1 ? drift : 0), dentistId: l.dentistId })),
      total: amount,
      subtotal: amount,
      issueDate: today,
      notes: b.reason,
      issuedBy: auth.userId,
    });
    const je = await postEntry(auth, { date: today, source: 'credit_note', sourceId: cn._id, memo: `${number} → ${orig.number}`, lines }, s);
    cn.journalEntryId = je._id;
    await cn.save({ session: s });
    orig.creditedTotal = (orig.creditedTotal ?? 0) + amount;
    refreshStatus(orig);
    await orig.save({ session: s });
    onCommit(session, () => emit('invoice.issued', { clinicId, invoiceId: String(cn._id) }));
    return { cn, orig };
  });
  await refreshPatientBalance(String(result.orig.patientId));
  await recordAudit({ action: 'create', entity: 'creditNote', entityId: result.cn._id, after: { invoice: result.orig.number, amount: result.cn.total }, reason: b.reason });
  return (await serializeInvoices(auth, [result.cn.toObject() as unknown as Raw]))[0]!;
}

/* ---------- patient balance cache (from the ledger) ---------- */

/** balance = AR_PATIENTS (Dr − Cr) − PATIENT_CREDIT (Cr − Dr) for the patient. */
export async function patientLedgerBalance(patientId: string) {
  const accts = await AccountModel.find({ systemKey: { $in: ['AR_PATIENTS', 'PATIENT_CREDIT'] } }).select('systemKey').lean();
  const ar = accts.find((a) => a.systemKey === 'AR_PATIENTS')?._id;
  const credit = accts.find((a) => a.systemKey === 'PATIENT_CREDIT')?._id;
  if (!ar || !credit) return { receivable: 0, credit: 0, balance: 0 };
  const rows = await JournalEntryModel.aggregate<{ _id: Types.ObjectId; d: number; c: number }>([
    { $match: { clinicId: new Types.ObjectId(currentClinicId()), status: { $in: ['posted', 'reversed'] }, 'lines.patientId': new Types.ObjectId(patientId) } },
    { $unwind: '$lines' },
    { $match: { 'lines.patientId': new Types.ObjectId(patientId), 'lines.accountId': { $in: [ar, credit] } } },
    { $group: { _id: '$lines.accountId', d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } },
  ]);
  const get = (aid: Types.ObjectId) => rows.find((r) => r._id.equals(aid)) ?? { d: 0, c: 0 };
  const receivable = get(ar).d - get(ar).c;
  const creditBal = get(credit).c - get(credit).d;
  return { receivable, credit: creditBal, balance: receivable - creditBal };
}

export async function refreshPatientBalance(patientId: string) {
  const b = await patientLedgerBalance(patientId);
  await PatientModel.updateOne({ _id: patientId }, { $set: { balance: b.balance } });
  return b;
}
