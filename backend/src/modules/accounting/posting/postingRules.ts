import { sum } from '@/shared/money';
import type { JournalLine } from '../accounting.models';

/**
 * Posting rules (09 §4): one pure builder per business event, `(doc, accounts) → lines`.
 * `accounts` maps system keys to account ids. Every builder returns balanced lines.
 */
export type AccountMap = (systemKey: string) => string;

const dr = (accountId: string, amount: number, extra: Partial<JournalLine> = {}): JournalLine => ({ accountId, debit: amount, credit: 0, ...extra });
const cr = (accountId: string, amount: number, extra: Partial<JournalLine> = {}): JournalLine => ({ accountId, debit: 0, credit: amount, ...extra });

/** Drops zero lines and merges identical account+dimension lines. */
export function compact(lines: JournalLine[]): JournalLine[] {
  const out = new Map<string, JournalLine>();
  for (const l of lines) {
    if (!l.debit && !l.credit) continue;
    const k = [l.accountId, l.patientId, l.supplierId, l.staffId, l.dentistId, l.insuranceCompanyId, l.debit ? 'd' : 'c'].join('|');
    const cur = out.get(k);
    if (cur) {
      cur.debit += l.debit;
      cur.credit += l.credit;
    } else out.set(k, { ...l });
  }
  return [...out.values()];
}

export function isBalanced(lines: JournalLine[]): boolean {
  const d = sum(lines.map((l) => l.debit));
  const c = sum(lines.map((l) => l.credit));
  return d === c && d > 0 && lines.every((l) => (l.debit > 0) !== (l.credit > 0) && l.debit >= 0 && l.credit >= 0);
}

/** Swaps debit and credit (reversals, credit notes). */
export function mirror(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
}

/* ---------- invoices (4.1–4.3) ---------- */

export type InvoiceForPosting = {
  patientId: string;
  insuranceCompanyId?: string;
  discountsGross: boolean;
  lines: { revenueAccountId: string; gross: number; discount: number; tax: number; taxAccountId?: string; dentistId?: string; patientShare: number; insuranceShare: number }[];
};

export function invoiceIssued(inv: InvoiceForPosting, a: AccountMap): JournalLine[] {
  const patientAr = sum(inv.lines.map((l) => l.patientShare));
  const insuranceAr = sum(inv.lines.map((l) => l.insuranceShare));
  const lines: JournalLine[] = [
    dr(a('AR_PATIENTS'), patientAr, { patientId: inv.patientId }),
    dr(a('AR_INSURANCE'), insuranceAr, { patientId: inv.patientId, ...(inv.insuranceCompanyId ? { insuranceCompanyId: inv.insuranceCompanyId } : {}) }),
  ];
  for (const l of inv.lines) {
    if (inv.discountsGross) {
      lines.push(cr(l.revenueAccountId, l.gross, { ...(l.dentistId ? { dentistId: l.dentistId } : {}), patientId: inv.patientId }));
      lines.push(dr(a('DISCOUNTS'), l.discount, { ...(l.dentistId ? { dentistId: l.dentistId } : {}) }));
    } else {
      lines.push(cr(l.revenueAccountId, l.gross - l.discount, { ...(l.dentistId ? { dentistId: l.dentistId } : {}), patientId: inv.patientId }));
    }
    lines.push(cr(l.taxAccountId ?? a('VAT_OUTPUT'), l.tax));
  }
  return compact(lines);
}

export function creditNote(inv: InvoiceForPosting, a: AccountMap): JournalLine[] {
  return mirror(invoiceIssued(inv, a));
}

/* ---------- payments (4.4–4.5) ---------- */

export type PaymentForPosting = {
  amount: number;
  depositAccountId: string;
  payer: 'patient' | 'insurance';
  patientId?: string;
  insuranceCompanyId?: string;
  allocated: number;
};

export function paymentReceived(p: PaymentForPosting, a: AccountMap): JournalLine[] {
  const ar = p.payer === 'insurance' ? a('AR_INSURANCE') : a('AR_PATIENTS');
  const dims = { ...(p.patientId ? { patientId: p.patientId } : {}), ...(p.insuranceCompanyId ? { insuranceCompanyId: p.insuranceCompanyId } : {}) };
  return compact([dr(p.depositAccountId, p.amount, dims), cr(ar, p.allocated, dims), cr(a('PATIENT_CREDIT'), p.amount - p.allocated, dims)]);
}

/** Using unallocated credit on an invoice: Dr PATIENT_CREDIT / Cr AR_PATIENTS. */
export function creditApplied(amount: number, patientId: string, a: AccountMap): JournalLine[] {
  return compact([dr(a('PATIENT_CREDIT'), amount, { patientId }), cr(a('AR_PATIENTS'), amount, { patientId })]);
}

/** Refund from credit (unallocated) or from AR (reopened invoice), out of the deposit account. */
export function refund(r: { amount: number; fromCredit: number; patientId?: string; depositAccountId: string; payer: 'patient' | 'insurance'; insuranceCompanyId?: string }, a: AccountMap): JournalLine[] {
  const dims = { ...(r.patientId ? { patientId: r.patientId } : {}), ...(r.insuranceCompanyId ? { insuranceCompanyId: r.insuranceCompanyId } : {}) };
  const ar = r.payer === 'insurance' ? a('AR_INSURANCE') : a('AR_PATIENTS');
  return compact([dr(a('PATIENT_CREDIT'), r.fromCredit, dims), dr(ar, r.amount - r.fromCredit, dims), cr(r.depositAccountId, r.amount, dims)]);
}

/** Cheque cleared: move from cheques under collection to the bank. */
export function chequeCleared(amount: number, bankAccountId: string, a: AccountMap): JournalLine[] {
  return [dr(bankAccountId, amount), cr(a('CHEQUES_UNDER_COLLECTION'), amount)];
}

/* ---------- insurance claims (3.4) ---------- */

/**
 * Approved < claimed: write off or re-bill the difference to the patient. A write-off is a revenue
 * reduction, so its debit carries the doctor dimension per part (09 §8.1); parts must add up to amount.
 */
export function claimShortfall(c: { amount: number; patientId: string; insuranceCompanyId: string; mode: 'write_off' | 'rebill'; doctorParts?: { amount: number; dentistId?: string }[] }, a: AccountMap): JournalLine[] {
  const credit = cr(a('AR_INSURANCE'), c.amount, { patientId: c.patientId, insuranceCompanyId: c.insuranceCompanyId });
  if (c.mode === 'rebill') return compact([dr(a('AR_PATIENTS'), c.amount, { patientId: c.patientId }), credit]);
  const parts = c.doctorParts?.length ? c.doctorParts : [{ amount: c.amount }];
  return compact([...parts.map((p) => dr(a('DISCOUNTS'), p.amount, { patientId: c.patientId, ...(p.dentistId ? { dentistId: p.dentistId } : {}) })), credit]);
}

/* ---------- suppliers & expenses (4.6) ---------- */

export function supplierBill(b: { supplierId: string; payableAccountId: string; lines: { accountId: string; amount: number; tax: number }[] }, a: AccountMap): JournalLine[] {
  const total = sum(b.lines.map((l) => l.amount + l.tax));
  return compact([...b.lines.flatMap((l) => [dr(l.accountId, l.amount, { supplierId: b.supplierId }), dr(a('VAT_INPUT'), l.tax)]), cr(b.payableAccountId, total, { supplierId: b.supplierId })]);
}

export function expense(e: { accountId: string; amount: number; tax: number; paidFromAccountId: string }, a: AccountMap): JournalLine[] {
  return compact([dr(e.accountId, e.amount), dr(a('VAT_INPUT'), e.tax), cr(e.paidFromAccountId, e.amount + e.tax)]);
}

export function supplierPayment(p: { supplierId: string; payableAccountId: string; amount: number; paidFromAccountId: string }): JournalLine[] {
  return [dr(p.payableAccountId, p.amount, { supplierId: p.supplierId }), cr(p.paidFromAccountId, p.amount, { supplierId: p.supplierId })];
}

/* ---------- cash close (4.8) ---------- */

/** difference = counted − expected. Short (negative): Dr over/short, Cr cash. */
export function cashOverShort(difference: number, cashAccountId: string, a: AccountMap): JournalLine[] {
  if (difference === 0) return [];
  return difference < 0 ? [dr(a('CASH_OVER_SHORT'), -difference), cr(cashAccountId, -difference)] : [dr(cashAccountId, difference), cr(a('CASH_OVER_SHORT'), difference)];
}

/* ---------- payroll (4.7) ---------- */

export function payrollApproved(
  p: { lines: { staffId: string; gross: number; commission: number; employerSsc: number; employeeSsc: number; incomeTax: number; advances: number; otherDeductions: number; net: number }[] },
  a: AccountMap,
): JournalLine[] {
  const out: JournalLine[] = [];
  for (const l of p.lines) {
    const s = { staffId: l.staffId };
    out.push(dr(a('SALARIES_EXPENSE'), l.gross - l.commission, s), dr(a('COMMISSIONS_EXPENSE'), l.commission, s), dr(a('SSC_EXPENSE'), l.employerSsc, s));
    out.push(cr(a('SSC_PAYABLE'), l.employeeSsc + l.employerSsc, s), cr(a('INCOME_TAX_PAYABLE'), l.incomeTax, s), cr(a('STAFF_ADVANCES'), l.advances, s), cr(a('SALARIES_PAYABLE'), l.net + l.otherDeductions, s));
  }
  return compact(out);
}

export function payrollPaid(amount: number, paidFromAccountId: string, a: AccountMap): JournalLine[] {
  return [dr(a('SALARIES_PAYABLE'), amount), cr(paidFromAccountId, amount)];
}

/** Year-end (4.10): close every revenue/expense balance into retained earnings. */
export function yearEndClose(balances: { accountId: string; balance: number }[], a: AccountMap): JournalLine[] {
  const lines: JournalLine[] = [];
  let net = 0;
  for (const b of balances) {
    // balance = debit − credit; closing posts the opposite side.
    if (b.balance > 0) lines.push(cr(b.accountId, b.balance));
    else if (b.balance < 0) lines.push(dr(b.accountId, -b.balance));
    net += b.balance;
  }
  if (net > 0) lines.push(dr(a('RETAINED_EARNINGS'), net));
  else if (net < 0) lines.push(cr(a('RETAINED_EARNINGS'), -net));
  return compact(lines);
}
