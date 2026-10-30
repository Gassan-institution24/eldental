import { describe, expect, it } from 'vitest';
import { sum } from '@/shared/money';
import type { JournalLine } from '../accounting.models';
import * as r from '../posting/postingRules';
import { computeTotals } from '@/modules/billing/invoice.service';

const a: r.AccountMap = (key) => `acc:${key}`;
const dr = (lines: JournalLine[]) => sum(lines.map((l) => l.debit));
const cr = (lines: JournalLine[]) => sum(lines.map((l) => l.credit));
const on = (lines: JournalLine[], key: string, side: 'debit' | 'credit') => sum(lines.filter((l) => l.accountId === `acc:${key}`).map((l) => l[side]));

const line = (over: Partial<r.InvoiceForPosting['lines'][number]> = {}) => ({ revenueAccountId: 'acc:REVENUE_RESTORATIVE', gross: 100_000, discount: 10_000, tax: 0, patientShare: 90_000, insuranceShare: 0, ...over });

describe('posting rules are balanced', () => {
  const fixtures: r.InvoiceForPosting[] = [
    { patientId: 'p', discountsGross: true, lines: [line()] },
    { patientId: 'p', discountsGross: false, lines: [line()] },
    { patientId: 'p', discountsGross: true, lines: [line({ tax: 14_400, patientShare: 104_400 })] },
    { patientId: 'p', insuranceCompanyId: 'i', discountsGross: true, lines: [line({ patientShare: 18_000, insuranceShare: 72_000 }), line({ gross: 50_000, discount: 0, patientShare: 50_000, revenueAccountId: 'acc:REVENUE_PREVENTIVE' })] },
    { patientId: 'p', discountsGross: true, lines: [line({ discount: 0, patientShare: 100_000 }), line({ gross: 1, discount: 0, patientShare: 1 })] },
  ];

  it.each(fixtures.map((f, i) => [i, f] as const))('invoice fixture %i', (_i, f) => {
    const lines = r.invoiceIssued(f, a);
    expect(r.isBalanced(lines)).toBe(true);
    expect(dr(lines)).toBe(cr(lines));
    expect(r.isBalanced(r.creditNote(f, a))).toBe(true);
  });

  it('discounts are posted gross (contra-revenue) or net', () => {
    const gross = r.invoiceIssued(fixtures[0]!, a);
    expect(on(gross, 'DISCOUNTS', 'debit')).toBe(10_000);
    expect(cr(gross)).toBe(100_000);
    const net = r.invoiceIssued(fixtures[1]!, a);
    expect(on(net, 'DISCOUNTS', 'debit')).toBe(0);
    expect(cr(net)).toBe(90_000);
  });

  it('insurance split posts AR to both receivables', () => {
    const lines = r.invoiceIssued(fixtures[3]!, a);
    expect(on(lines, 'AR_PATIENTS', 'debit')).toBe(68_000);
    expect(on(lines, 'AR_INSURANCE', 'debit')).toBe(72_000);
  });

  it('payments, credit and refunds', () => {
    const p = r.paymentReceived({ amount: 100_000, depositAccountId: 'acc:CASH', payer: 'patient', patientId: 'p', allocated: 60_000 }, a);
    expect(r.isBalanced(p)).toBe(true);
    expect(on(p, 'PATIENT_CREDIT', 'credit')).toBe(40_000);
    expect(r.isBalanced(r.creditApplied(5_000, 'p', a))).toBe(true);
    const ref = r.refund({ amount: 50_000, fromCredit: 40_000, patientId: 'p', depositAccountId: 'acc:CASH', payer: 'patient' }, a);
    expect(r.isBalanced(ref)).toBe(true);
    expect(on(ref, 'AR_PATIENTS', 'debit')).toBe(10_000);
  });

  it('suppliers, expenses, cash, payroll, year-end', () => {
    expect(r.isBalanced(r.supplierBill({ supplierId: 's', payableAccountId: 'acc:AP', lines: [{ accountId: 'acc:LAB', amount: 45_000, tax: 7_200 }] }, a))).toBe(true);
    expect(r.isBalanced(r.expense({ accountId: 'acc:RENT', amount: 450_000, tax: 0, paidFromAccountId: 'acc:BANK' }, a))).toBe(true);
    expect(r.isBalanced(r.supplierPayment({ supplierId: 's', payableAccountId: 'acc:AP', amount: 10, paidFromAccountId: 'acc:BANK' }))).toBe(true);
    expect(r.cashOverShort(0, 'acc:CASH', a)).toEqual([]);
    expect(r.isBalanced(r.cashOverShort(-1_500, 'acc:CASH', a))).toBe(true);
    expect(on(r.cashOverShort(-1_500, 'acc:CASH', a), 'CASH_OVER_SHORT', 'debit')).toBe(1_500);
    const payroll = r.payrollApproved({ lines: [{ staffId: 's', gross: 1_000_000, commission: 200_000, employerSsc: 142_500, employeeSsc: 75_000, incomeTax: 20_000, advances: 50_000, otherDeductions: 0, net: 855_000 }] }, a);
    expect(r.isBalanced(payroll)).toBe(true);
    const close = r.yearEndClose([{ accountId: 'acc:REV', balance: -500_000 }, { accountId: 'acc:EXP', balance: 300_000 }], a);
    expect(r.isBalanced(close)).toBe(true);
    expect(on(close, 'RETAINED_EARNINGS', 'credit')).toBe(200_000);
  });

  it('rejects unbalanced or one-sided lines', () => {
    expect(r.isBalanced([{ accountId: 'x', debit: 10, credit: 0 }])).toBe(false);
    expect(r.isBalanced([{ accountId: 'x', debit: 10, credit: 10 }, { accountId: 'y', debit: 0, credit: 0 }])).toBe(false);
    expect(r.isBalanced([])).toBe(false);
  });
});

describe('invoice totals', () => {
  it('spreads the invoice discount, adds tax, splits insurance, caps by remaining max', () => {
    const t = computeTotals(
      [
        { quantity: 1, unitPrice: 100_000, discount: 0, taxRate: 1600, category: 'restorative' },
        { quantity: 2, unitPrice: 25_000, discount: 0, taxRate: 0, category: 'preventive' },
      ],
      15_000,
      (c) => (c === 'restorative' ? 80 : 0),
      50_000,
    );
    expect(t.discountTotal).toBe(15_000);
    expect(t.subtotal).toBe(150_000);
    expect(t.insuranceTotal).toBe(50_000); // capped
    expect(t.total).toBe(t.insuranceTotal + t.patientTotal);
    expect(t.total).toBe(150_000 - 15_000 + t.taxTotal);
  });
});
