import { describe, expect, it } from 'vitest';
import { calculatePayslip, employedDays, progressiveTax, type PayslipInput } from '../payroll.calc';

const base = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  year: 2026,
  month: 11,
  daysInMonth: 30,
  basic: 600_000,
  earnings: [],
  deductions: [],
  overtimeMinutes: 0,
  overtimeMultiplierBp: 12500,
  absentDays: 0,
  unpaidLeaveDays: 0,
  ssc: { enrolled: true, employeeRateBp: 750, employerRateBp: 1425, capMonthly: 0 },
  incomeTax: { mode: 'none', brackets: [] },
  oneOff: [],
  ...over,
});

describe('calculatePayslip', () => {
  it('full month: SSC employee/employer, net = gross − deductions', () => {
    const r = calculatePayslip(base());
    expect(r.basic).toBe(600_000);
    expect(r.socialSecurity).toMatchObject({ employee: 45_000, employer: 85_500 });
    expect(r.net).toBe(555_000);
    expect(r.gross - r.totalDeductions).toBe(r.net);
  });

  it('pro-rata for a hire on the 16th (15 of 30 days)', () => {
    expect(employedDays({ year: 2026, month: 11, daysInMonth: 30, hireDate: '2026-11-16' })).toBe(15);
    expect(calculatePayslip(base({ hireDate: '2026-11-16' })).basic).toBe(300_000);
    expect(calculatePayslip(base({ endDate: '2026-11-10' })).basic).toBe(200_000);
    expect(calculatePayslip(base({ hireDate: '2026-12-02' })).basic).toBe(0);
  });

  it('overtime at 125% of the hourly rate; absences and unpaid leave by daily rate', () => {
    const r = calculatePayslip(base({ overtimeMinutes: 120, absentDays: 1, unpaidLeaveDays: 2 }));
    expect(r.overtime.amount).toBe(6_250); // 600 JOD / 240 h = 2.5 JOD × 2 h × 1.25
    expect(r.absenceDeduction).toBe(20_000);
    expect(r.unpaidLeaveDeduction).toBe(40_000);
    expect(r.gross).toBe(600_000 - 60_000 + 6_250);
  });

  it('components: fixed, percent of basic, non-taxable and SSC-subject', () => {
    const r = calculatePayslip(
      base({
        earnings: [
          { name: 'Transport', calc: 'fixed', value: 50_000, taxable: false, subjectToSocialSecurity: false },
          { name: 'Housing', calc: 'percent_of_basic', value: 10, taxable: true, subjectToSocialSecurity: true },
        ],
        deductions: [{ name: 'Loan', calc: 'fixed', value: 25_000, taxable: false, subjectToSocialSecurity: false }],
      }),
    );
    expect(r.earnings.map((e) => e.amount)).toEqual([50_000, 60_000]);
    expect(r.socialSecurity.base).toBe(660_000);
    expect(r.advances).toBe(25_000);
  });

  it('commission on production and collection bases', () => {
    expect(calculatePayslip(base({ commission: { basis: 'production', percent: 30, base: 2_000_000 } })).commission.amount).toBe(600_000);
    expect(calculatePayslip(base({ commission: { basis: 'collection', percent: 12.5, base: 1_000_001 } })).commission.amount).toBe(125_000);
  });

  it('SSC cap and income tax brackets', () => {
    const r = calculatePayslip(base({ basic: 5_000_000, ssc: { enrolled: true, employeeRateBp: 750, employerRateBp: 1425, capMonthly: 3_000_000 }, incomeTax: { mode: 'brackets', brackets: [{ upTo: 1_000_000, rateBp: 0 }, { upTo: 2_000_000, rateBp: 500 }, { upTo: null, rateBp: 1000 }] } }));
    expect(r.socialSecurity.employee).toBe(225_000);
    expect(r.incomeTax).toBe(progressiveTax(5_000_000 - 225_000, [{ upTo: 1_000_000, rateBp: 0 }, { upTo: 2_000_000, rateBp: 500 }, { upTo: null, rateBp: 1000 }]));
    expect(progressiveTax(1_500_000, [{ upTo: 1_000_000, rateBp: 0 }, { upTo: null, rateBp: 1000 }])).toBe(50_000);
  });

  it('banker’s rounding and one-off lines', () => {
    const r = calculatePayslip(base({ basic: 333_333, oneOff: [{ kind: 'earning', name: 'Bonus', amount: 10_000 }, { kind: 'deduction', name: 'Advance', amount: 5_000 }] }));
    expect(Number.isInteger(r.net)).toBe(true);
    expect(r.advances).toBe(5_000);
    expect(r.gross).toBe(343_333);
  });
});
