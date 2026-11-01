import { Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { withTransaction } from '@/core/db/transaction';
import { emit } from '@/core/events/bus';
import { ApiError } from '@/core/http/ApiError';
import { fieldPolicyOf, scopeFor } from '@/core/rbac/authorize';
import { applyFieldPolicy } from '@/core/rbac/fieldPolicy';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { attributedMovements } from '@/modules/billing/attribution';
import { LabOrderModel, PerformedProcedureModel } from '@/modules/clinical/clinical.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { AccountModel } from '@/modules/accounting/accounting.models';
import { clinicTimezone, clinicToday, loadAccountMap, postEntry } from '@/modules/accounting/journal.service';
import { payrollApproved, payrollPaid } from '@/modules/accounting/posting/postingRules';
import { daysInMonth } from '@/shared/dates';
import { sum } from '@/shared/money';
import { AttendanceModel, LeaveRequestModel, LeaveTypeModel, PayrollRunModel, PayslipModel, SalaryComponentModel } from './hr.models';
import { calculatePayslip, type ComponentLine } from './payroll.calc';
import { countLeaveDays } from './hr.service';

const pad = (n: number) => String(n).padStart(2, '0');
const id = (v: unknown) => (v ? String(v) : undefined);

export function runDto(r: Record<string, unknown> & { _id: Types.ObjectId; __v?: number }) {
  return { ...r, id: String(r._id), version: r.__v ?? 0, _id: undefined, __v: undefined, clinicId: undefined, journalEntryId: id(r.journalEntryId), paymentJournalEntryId: id(r.paymentJournalEntryId), paidFromAccountId: id(r.paidFromAccountId) };
}

export function payslipDto(auth: AuthContext, p: Record<string, unknown> & { _id: Types.ObjectId }, staffName?: string) {
  const dto = { ...p, id: String(p._id), _id: undefined, clinicId: undefined, staffId: String(p.staffId), payrollRunId: String(p.payrollRunId), staffName };
  return applyFieldPolicy(dto, fieldPolicyOf(auth, 'hr.payroll', 'hr.payroll.read'));
}

async function loadRun(runId: string) {
  if (!Types.ObjectId.isValid(runId)) throw ApiError.notFound();
  const run = await PayrollRunModel.findById(runId);
  if (!run) throw ApiError.notFound();
  return run;
}

export async function listRuns() {
  const rows = await PayrollRunModel.find({}).sort({ year: -1, month: -1 }).limit(60).lean();
  return rows.map((r) => runDto(r as never));
}

export async function createRun(auth: AuthContext, year: number, month: number) {
  if (await PayrollRunModel.exists({ year, month, status: { $ne: 'cancelled' } })) throw ApiError.conflict('PAYROLL_EXISTS', 'A payroll for this month already exists');
  const run = await PayrollRunModel.create({ year, month }).catch((err: unknown) => {
    if ((err as { code?: number }).code === 11000) throw ApiError.conflict('PAYROLL_EXISTS', 'A payroll for this month already exists');
    throw err;
  });
  await recordAudit({ action: 'create', entity: 'payrollRun', entityId: run._id, after: { year, month } });
  return runDto(run.toObject() as never);
}

export async function getRun(auth: AuthContext, runId: string) {
  const run = await loadRun(runId);
  const slips = await PayslipModel.find({ payrollRunId: run._id }).lean();
  const names = new Map((await StaffModel.find({ _id: { $in: slips.map((s) => s.staffId) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
  return { ...runDto(run.toObject() as never), payslips: slips.map((s) => payslipDto(auth, s as never, names.get(String(s.staffId)))) };
}

/** Commission base for the month (08 §5): production or collection, optionally net of lab cost. */
async function commissionBase(staffId: Types.ObjectId, c: { basis?: string | null; appliesTo?: string[] | null; netOfLabCost?: boolean | null }, from: string, to: string) {
  const range = { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${to}T23:59:59Z`) };
  let base = 0;
  const sourceIds: Types.ObjectId[] = [];
  if (c.basis === 'collection') {
    // The doctor's proportional share of money applied to invoices (09 §8.1), net of refunds.
    const me = String(staffId);
    const payIds = new Set<string>();
    for (const m of await attributedMovements(from, to, await clinicTimezone())) {
      const part = m.parts.get(me) ?? 0;
      if (!part) continue;
      base += part;
      payIds.add(m.paymentId);
    }
    sourceIds.push(...[...payIds].map((x) => new Types.ObjectId(x)));
  } else {
    const procs = await PerformedProcedureModel.find({ dentistId: staffId, status: 'completed', performedAt: range, ...(c.appliesTo?.length ? { category: { $in: c.appliesTo } } : {}) }).lean();
    base = sum(procs.map((p) => (p.unitPrice ?? 0) * (p.quantity ?? 1) - (p.discount ?? 0)));
    sourceIds.push(...procs.map((p) => p._id));
  }
  if (c.netOfLabCost) {
    const labs = await LabOrderModel.find({ dentistId: staffId, receivedAt: range }).select('cost').lean();
    base -= sum(labs.map((l) => l.cost ?? 0));
  }
  return { base: Math.max(0, base), sourceIds };
}

/** Idempotent while draft/calculated: replaces every payslip of the run (08 §6.2). */
export async function calculateRun(auth: AuthContext, runId: string) {
  const run = await loadRun(runId);
  if (!['draft', 'calculated'].includes(run.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Approved payrolls cannot be recalculated');
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings').lean());
  const st = (clinic?.settings ?? {}) as { overtimeMultiplierBp?: number; ssc?: { employeeRateBp?: number; employerRateBp?: number; capMonthly?: number }; incomeTax?: { mode?: 'none' | 'brackets'; brackets?: { upTo?: number; rateBp: number }[] } };
  const dim = daysInMonth(run.year, run.month);
  const from = `${run.year}-${pad(run.month)}-01`;
  const to = `${run.year}-${pad(run.month)}-${pad(dim)}`;
  const components = new Map((await SalaryComponentModel.find({}).lean()).map((c) => [String(c._id), c]));
  const unpaidTypes = (await LeaveTypeModel.find({ paid: false }).select('_id').lean()).map((t) => t._id);
  const staff = await StaffModel.find({ status: { $in: ['active', 'inactive', 'terminated'] }, 'compensation.basicSalary': { $gt: 0 } }).lean();
  const slips: (ReturnType<typeof calculatePayslip> & { staffId: Types.ObjectId; year: number; month: number; daysInMonth: number; absentDays: number; unpaidLeaveDays: number; commission: ReturnType<typeof calculatePayslip>['commission'] & { sourceIds: Types.ObjectId[] } })[] = [];
  for (const s of staff) {
    const end = s.employment?.endDate;
    if (s.status !== 'active' && (!end || end < from)) continue;
    if (s.employment?.hireDate && s.employment.hireDate > to) continue;
    const comp = s.compensation!;
    const line = (l: { componentId?: Types.ObjectId | null; amount?: number | null }): ComponentLine => {
      const c = l.componentId ? components.get(String(l.componentId)) : undefined;
      return { ...(c ? { componentId: String(c._id) } : {}), name: c?.name ?? 'Other', calc: (c?.calc as ComponentLine['calc']) ?? 'fixed', value: l.amount ?? 0, taxable: c?.taxable ?? true, subjectToSocialSecurity: c?.subjectToSocialSecurity ?? false };
    };
    const att = await AttendanceModel.find({ staffId: s._id, date: { $gte: from, $lte: to } }).lean();
    const absentDays = att.filter((a) => a.status === 'absent').length;
    const overtimeMinutes = sum(att.filter((a) => a.overtimeApproved).map((a) => a.overtimeMinutes ?? 0));
    let unpaidLeaveDays = 0;
    for (const l of await LeaveRequestModel.find({ staffId: s._id, status: 'approved', leaveTypeId: { $in: unpaidTypes }, startDate: { $lte: to }, endDate: { $gte: from } }).lean()) {
      unpaidLeaveDays += await countLeaveDays(l.startDate < from ? from : l.startDate, l.endDate > to ? to : l.endDate, l.halfDay);
    }
    const cm = comp.commission?.basis && comp.commission.percent ? await commissionBase(s._id, comp.commission, from, to) : null;
    const r = calculatePayslip({
      year: run.year,
      month: run.month,
      daysInMonth: dim,
      basic: comp.basicSalary ?? 0,
      ...(s.employment?.hireDate ? { hireDate: s.employment.hireDate } : {}),
      ...(end ? { endDate: end } : {}),
      earnings: (comp.allowances ?? []).map(line),
      deductions: (comp.deductions ?? []).map(line),
      overtimeMinutes,
      overtimeMultiplierBp: st.overtimeMultiplierBp ?? 12500,
      absentDays,
      unpaidLeaveDays,
      ...(cm ? { commission: { basis: comp.commission!.basis as 'production', percent: comp.commission!.percent!, base: cm.base } } : {}),
      ssc: { enrolled: comp.socialSecurity?.enrolled ?? true, employeeRateBp: comp.socialSecurity?.employeeRateBp ?? st.ssc?.employeeRateBp ?? 750, employerRateBp: comp.socialSecurity?.employerRateBp ?? st.ssc?.employerRateBp ?? 1425, capMonthly: st.ssc?.capMonthly ?? 0 },
      incomeTax: { mode: st.incomeTax?.mode ?? 'none', brackets: st.incomeTax?.brackets ?? [] },
      oneOff: run.oneOffLines.filter((o) => String(o.staffId) === String(s._id)).map((o) => ({ kind: o.kind as 'earning', name: o.name ?? '', amount: o.amount ?? 0 })),
    });
    slips.push({ staffId: s._id, year: run.year, month: run.month, daysInMonth: dim, absentDays, unpaidLeaveDays, ...r, commission: { ...r.commission, sourceIds: cm?.sourceIds ?? [] } });
  }
  await withTransaction(async (session) => {
    const ss = session ?? undefined;
    await PayslipModel.deleteMany({ payrollRunId: run._id }, { session: ss });
    if (slips.length) await PayslipModel.insertMany(slips.map((p) => ({ ...p, payrollRunId: run._id })), { session: ss });
    run.set('totals', { gross: sum(slips.map((p) => p.gross)), deductions: sum(slips.map((p) => p.totalDeductions)), employerContributions: sum(slips.map((p) => p.socialSecurity.employer)), net: sum(slips.map((p) => p.net)) });
    run.status = 'calculated';
    run.calculatedBy = new Types.ObjectId(auth.userId);
    run.calculatedAt = new Date();
    await run.save({ session: ss });
  });
  await recordAudit({ action: 'update', entity: 'payrollRun', entityId: runId, summary: `calculated ${slips.length} payslips` });
  return getRun(auth, runId);
}

export async function addOneOff(auth: AuthContext, runId: string, b: { staffId: string; kind: 'earning' | 'deduction'; name: string; amount: number; reason: string }) {
  const run = await loadRun(runId);
  if (!['draft', 'calculated'].includes(run.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Payroll is locked');
  run.oneOffLines.push(b);
  run.status = 'draft';
  await run.save();
  await recordAudit({ action: 'update', entity: 'payrollRun', entityId: runId, summary: `one-off ${b.kind}`, reason: b.reason });
  return calculateRun(auth, runId);
}

export async function removeOneOff(auth: AuthContext, runId: string, lineId: string) {
  const run = await loadRun(runId);
  if (!['draft', 'calculated'].includes(run.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Payroll is locked');
  run.set('oneOffLines', run.oneOffLines.filter((l) => String(l._id) !== lineId));
  await run.save();
  return calculateRun(auth, runId);
}

/** Approve (08 §6.4): four-eyes, lock attendance, post the payroll journal. */
export async function approveRun(auth: AuthContext, runId: string) {
  const run = await loadRun(runId);
  if (run.status !== 'calculated') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Calculate the payroll first');
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.payrollFourEyes').lean());
  if ((clinic?.settings as { payrollFourEyes?: boolean } | undefined)?.payrollFourEyes && String(run.calculatedBy) === auth.userId) throw ApiError.conflict('PAYROLL_FOUR_EYES', 'Another person must approve this payroll');
  const slips = await PayslipModel.find({ payrollRunId: run._id }).lean();
  const dim = daysInMonth(run.year, run.month);
  const from = `${run.year}-${pad(run.month)}-01`;
  const to = `${run.year}-${pad(run.month)}-${pad(dim)}`;
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    const accounts = await loadAccountMap(s);
    const lines = payrollApproved({ lines: slips.map((p) => ({ staffId: String(p.staffId), gross: p.gross ?? 0, commission: p.commission?.amount ?? 0, employerSsc: p.socialSecurity?.employer ?? 0, employeeSsc: p.socialSecurity?.employee ?? 0, incomeTax: p.incomeTax ?? 0, advances: p.advances ?? 0, otherDeductions: 0, net: p.net ?? 0 })) }, accounts);
    if (lines.length) {
      const je = await postEntry(auth, { date: to, source: 'payroll', sourceId: run._id, memo: `Payroll ${run.year}-${pad(run.month)}`, lines }, s);
      run.journalEntryId = je._id;
    }
    await PayslipModel.updateMany({ payrollRunId: run._id }, { $set: { status: 'final' } }, { session: s });
    await AttendanceModel.updateMany({ date: { $gte: from, $lte: to }, staffId: { $in: slips.map((p) => p.staffId) } }, { $set: { payrollRunId: run._id } }, { session: s });
    run.status = 'approved';
    run.approvedBy = new Types.ObjectId(auth.userId);
    run.approvedAt = new Date();
    await run.save({ session: s });
  });
  await emit('payroll.approved', { clinicId: String(currentClinicId()), payrollRunId: runId });
  await recordAudit({ action: 'approve', entity: 'payrollRun', entityId: runId, after: { net: run.totals?.net } });
  return getRun(auth, runId);
}

export async function payRun(auth: AuthContext, runId: string, paidFromAccountId: string) {
  const run = await loadRun(runId);
  if (run.status !== 'approved') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Approve the payroll first');
  const acc = await AccountModel.findById(paidFromAccountId).lean();
  if (!acc || acc.isGroup || !['cash', 'bank'].includes(acc.subtype ?? '')) throw ApiError.validation([{ path: 'paidFromAccountId', code: 'invalid_option' }]);
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    const net = run.totals?.net ?? 0;
    if (net > 0) {
      const accounts = await loadAccountMap(s);
      const je = await postEntry(auth, { date: await clinicToday(), source: 'payroll_payment', sourceId: run._id, memo: `Salaries ${run.year}-${pad(run.month)}`, lines: payrollPaid(net, paidFromAccountId, accounts) }, s);
      run.paymentJournalEntryId = je._id;
    }
    run.status = 'paid';
    run.paidAt = new Date();
    run.paidFromAccountId = new Types.ObjectId(paidFromAccountId);
    await run.save({ session: s });
  });
  await recordAudit({ action: 'status_change', entity: 'payrollRun', entityId: runId, after: { status: 'paid' } });
  return getRun(auth, runId);
}

export async function cancelRun(auth: AuthContext, runId: string) {
  const run = await loadRun(runId);
  if (!['draft', 'calculated'].includes(run.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Approved payrolls cannot be cancelled');
  await PayslipModel.deleteMany({ payrollRunId: run._id });
  run.status = 'cancelled';
  await run.save();
  await recordAudit({ action: 'status_change', entity: 'payrollRun', entityId: runId, after: { status: 'cancelled' } });
  return runDto(run.toObject() as never);
}

/* ---------- my payslips (own) ---------- */

export async function myPayslips(auth: AuthContext) {
  if (!auth.staffId) return [];
  const rows = await PayslipModel.find({ staffId: auth.staffId, status: 'final' }).sort({ year: -1, month: -1 }).limit(36).lean();
  return rows.map((r) => payslipDto(auth, r as never));
}

export async function getPayslip(auth: AuthContext, slipId: string) {
  if (!Types.ObjectId.isValid(slipId)) throw ApiError.notFound();
  const own = scopeFor(auth, 'hr.payroll.read') === 'own';
  const p = await PayslipModel.findOne({ _id: slipId, ...(own ? { staffId: new Types.ObjectId(auth.staffId), status: 'final' } : {}) }).lean();
  if (!p) throw ApiError.notFound();
  const staff = await StaffModel.findById(p.staffId).select('name jobTitle').lean();
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name addressLine1 phone').lean());
  return { payslip: payslipDto(auth, p as never, staff?.name), staff: { name: staff?.name, jobTitle: staff?.jobTitle }, clinic };
}

export async function acknowledge(auth: AuthContext, slipId: string) {
  const p = await PayslipModel.findOne({ _id: slipId, staffId: auth.staffId, status: 'final' });
  if (!p) throw ApiError.notFound();
  if (!p.acknowledgedAt) {
    p.acknowledgedAt = new Date();
    await p.save();
    await recordAudit({ action: 'update', entity: 'payslip', entityId: slipId, summary: 'acknowledged' });
  }
  return payslipDto(auth, p.toObject() as never);
}
