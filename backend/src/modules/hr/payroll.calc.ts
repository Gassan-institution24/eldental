import { maxOf, minOf, mulFraction, mulRate, percentToBasisPoints, sum } from '@/shared/money';

/**
 * Pure payslip calculation (08 §6). All money is integer minor units; rounding is banker's
 * rounding at line level (via shared/money). Legal rates are inputs, never constants here.
 */
export type ComponentLine = { componentId?: string; name: string; calc: 'fixed' | 'percent_of_basic' | 'per_hour'; value: number; taxable: boolean; subjectToSocialSecurity: boolean };

export type PayslipInput = {
  year: number;
  month: number;
  daysInMonth: number;
  /** Monthly basic salary. */
  basic: number;
  hireDate?: string;
  endDate?: string;
  earnings: ComponentLine[];
  deductions: ComponentLine[];
  /** Approved overtime minutes in the month. */
  overtimeMinutes: number;
  overtimeMultiplierBp: number;
  absentDays: number;
  unpaidLeaveDays: number;
  /** Working hours behind the hourly rate (default 30 days × 8 h). */
  monthlyHours?: number;
  commission?: { basis: 'production' | 'collection'; percent: number; base: number };
  ssc: { enrolled: boolean; employeeRateBp: number; employerRateBp: number; capMonthly: number };
  incomeTax: { mode: 'none' | 'brackets'; brackets: { upTo?: number | null; rateBp: number }[] };
  oneOff: { kind: 'earning' | 'deduction'; name: string; amount: number }[];
};

export type PayslipResult = {
  workedDays: number;
  basic: number;
  earnings: { componentId?: string; name: string; amount: number }[];
  deductions: { componentId?: string; name: string; amount: number }[];
  overtime: { minutes: number; amount: number };
  absenceDeduction: number;
  unpaidLeaveDeduction: number;
  commission: { basis?: string; base: number; percent: number; amount: number };
  socialSecurity: { base: number; employee: number; employer: number };
  incomeTax: number;
  advances: number;
  gross: number;
  totalDeductions: number;
  net: number;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar days the person was employed in the month (hires/terminations pro-rata). */
export function employedDays(i: Pick<PayslipInput, 'year' | 'month' | 'daysInMonth' | 'hireDate' | 'endDate'>): number {
  const first = `${i.year}-${pad(i.month)}-01`;
  const last = `${i.year}-${pad(i.month)}-${pad(i.daysInMonth)}`;
  const start = i.hireDate && i.hireDate > first ? i.hireDate : first;
  const end = i.endDate && i.endDate < last ? i.endDate : last;
  if (end < start) return 0;
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000) + 1;
}

/** Progressive brackets on the monthly taxable amount. */
export function progressiveTax(taxable: number, brackets: { upTo?: number | null; rateBp: number }[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Number.MAX_SAFE_INTEGER;
    if (taxable <= lower) break;
    const slice = minOf(taxable, upper) - lower;
    if (slice > 0) tax += mulRate(slice, b.rateBp);
    lower = upper;
  }
  return tax;
}

export function calculatePayslip(i: PayslipInput): PayslipResult {
  const workedDays = employedDays(i);
  const basic = workedDays === i.daysInMonth ? i.basic : mulFraction(i.basic, workedDays, i.daysInMonth);
  // Daily rate on a 30-day month and hourly on 240 h are the common Jordanian practice; both are inputs.
  const hours = i.monthlyHours ?? 240;
  const dailyRate = mulFraction(i.basic, 1, 30);

  const amountOf = (c: ComponentLine) => (c.calc === 'percent_of_basic' ? mulRate(basic, percentToBasisPoints(c.value)) : c.calc === 'per_hour' ? mulFraction(i.basic, Math.round(c.value * 100), hours * 100) : c.value);
  const earnLines = i.earnings.map((c) => ({ c, amount: amountOf(c) }));
  const earnings = earnLines.map(({ c, amount }) => ({ ...(c.componentId ? { componentId: c.componentId } : {}), name: c.name, amount }));
  const componentDeductions = i.deductions.map((c) => ({ ...(c.componentId ? { componentId: c.componentId } : {}), name: c.name, amount: amountOf(c) }));

  const overtimeAmount = i.overtimeMinutes > 0 ? mulRate(mulFraction(i.basic, i.overtimeMinutes, hours * 60), i.overtimeMultiplierBp) : 0;
  const absenceDeduction = minOf(basic, dailyRate * i.absentDays);
  const unpaidLeaveDeduction = minOf(basic - absenceDeduction, dailyRate * i.unpaidLeaveDays);
  const commissionAmount = i.commission && i.commission.base > 0 ? mulRate(i.commission.base, percentToBasisPoints(i.commission.percent)) : 0;
  const oneOffEarnings = i.oneOff.filter((o) => o.kind === 'earning');
  const oneOffDeductions = i.oneOff.filter((o) => o.kind === 'deduction');

  const gross = maxOf(0, basic - absenceDeduction - unpaidLeaveDeduction + sum(earnings.map((e) => e.amount)) + overtimeAmount + commissionAmount + sum(oneOffEarnings.map((o) => o.amount)));

  // Social security on basic (after absences) + components marked subject to SSC, capped.
  let sscBase = basic - absenceDeduction - unpaidLeaveDeduction + sum(earnLines.filter((e) => e.c.subjectToSocialSecurity).map((e) => e.amount));
  if (i.ssc.capMonthly > 0) sscBase = minOf(sscBase, i.ssc.capMonthly);
  sscBase = maxOf(0, sscBase);
  const sscEmployee = i.ssc.enrolled ? mulRate(sscBase, i.ssc.employeeRateBp) : 0;
  const sscEmployer = i.ssc.enrolled ? mulRate(sscBase, i.ssc.employerRateBp) : 0;

  const nonTaxable = sum(earnLines.filter((e) => !e.c.taxable).map((e) => e.amount));
  const taxable = maxOf(0, gross - nonTaxable - sscEmployee);
  const incomeTax = i.incomeTax.mode === 'brackets' ? progressiveTax(taxable, i.incomeTax.brackets) : 0;

  const advances = sum(componentDeductions.map((d) => d.amount)) + sum(oneOffDeductions.map((o) => o.amount));
  const totalDeductions = sscEmployee + incomeTax + advances;
  return {
    workedDays,
    basic,
    earnings: [...earnings, ...oneOffEarnings.map((o) => ({ name: o.name, amount: o.amount }))],
    deductions: [...componentDeductions, ...oneOffDeductions.map((o) => ({ name: o.name, amount: o.amount }))],
    overtime: { minutes: i.overtimeMinutes, amount: overtimeAmount },
    absenceDeduction,
    unpaidLeaveDeduction,
    commission: { ...(i.commission ? { basis: i.commission.basis } : {}), base: i.commission?.base ?? 0, percent: i.commission?.percent ?? 0, amount: commissionAmount },
    socialSecurity: { base: sscBase, employee: sscEmployee, employer: sscEmployer },
    incomeTax,
    advances,
    gross,
    totalDeductions,
    net: gross - totalDeductions,
  };
}
