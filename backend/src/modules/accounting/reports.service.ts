import { Types } from 'mongoose';
import { currentClinicId } from '@/core/tenancy/tenantPlugin';
import { collectionMovements, collectionsByDoctor, doctorInvoiceFilter, shareOf, UNASSIGNED } from '@/modules/billing/attribution';
import { InvoiceModel, PaymentModel, CashSessionModel } from '@/modules/billing/billing.models';
import { PerformedProcedureModel } from '@/modules/clinical/clinical.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, daysBetween } from '@/shared/dates';
import { sum } from '@/shared/money';
import { AccountModel, JournalEntryModel, SupplierBillModel, SupplierModel } from './accounting.models';

/** Reports are built from the ledger (09 §8). Reversed + reversal entries both count. */
const LIVE = { $in: ['posted', 'reversed'] };

type Totals = { _id: Types.ObjectId; debit: number; credit: number };

async function totalsByAccount(match: { from?: string; to?: string; dentistId?: string }) {
  const date: Record<string, string> = {};
  if (match.from) date.$gte = match.from;
  if (match.to) date.$lte = match.to;
  return JournalEntryModel.aggregate<Totals>([
    { $match: { clinicId: new Types.ObjectId(currentClinicId()), status: LIVE, ...(Object.keys(date).length ? { date } : {}) } },
    { $unwind: '$lines' },
    ...(match.dentistId ? [{ $match: { 'lines.dentistId': new Types.ObjectId(match.dentistId) } }] : []),
    { $group: { _id: '$lines.accountId', debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ]);
}

async function accountList() {
  return AccountModel.find({}).sort({ code: 1 }).lean();
}

type AccountRow = { id: string; code: string; name: string | null; systemKey?: string; type: string; isGroup: boolean; parentId?: string; debit: number; credit: number; balance: number };

function rows(accounts: Awaited<ReturnType<typeof accountList>>, totals: Totals[]): AccountRow[] {
  const t = new Map(totals.map((x) => [String(x._id), x]));
  return accounts.map((a) => {
    const x = t.get(String(a._id));
    const debit = x?.debit ?? 0;
    const credit = x?.credit ?? 0;
    // Natural sign: debit-normal accounts show Dr − Cr, credit-normal show Cr − Dr.
    const balance = a.normalBalance === 'debit' ? debit - credit : credit - debit;
    return { id: String(a._id), code: a.code, name: a.name ?? null, ...(a.systemKey ? { systemKey: a.systemKey } : {}), type: a.type, isGroup: Boolean(a.isGroup), ...(a.parentId ? { parentId: String(a.parentId) } : {}), debit, credit, balance };
  });
}

/** Rolls child balances up into group accounts. */
function rollUp(list: AccountRow[]): AccountRow[] {
  const byId = new Map(list.map((r) => [r.id, { ...r }]));
  const children = new Map<string, string[]>();
  for (const r of list) if (r.parentId) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r.id]);
  const total = (rid: string): { d: number; c: number } => {
    const r = byId.get(rid)!;
    const kids = children.get(rid) ?? [];
    if (!kids.length) return { d: r.debit, c: r.credit };
    const s = kids.map(total).reduce((a, b) => ({ d: a.d + b.d, c: a.c + b.c }), { d: r.debit, c: r.credit });
    r.debit = s.d;
    r.credit = s.c;
    r.balance = (['asset', 'expense'].includes(r.type) ? 1 : -1) * (s.d - s.c);
    return s;
  };
  for (const r of list) if (!r.parentId) total(r.id);
  return list.map((r) => byId.get(r.id)!);
}

export async function trialBalance(asOf: string) {
  const list = rows(await accountList(), await totalsByAccount({ to: asOf })).filter((r) => !r.isGroup && (r.debit || r.credit));
  const out = list.map((r) => ({ ...r, debitBalance: Math.max(0, r.debit - r.credit), creditBalance: Math.max(0, r.credit - r.debit) }));
  const totalDebit = sum(out.map((r) => r.debitBalance));
  const totalCredit = sum(out.map((r) => r.creditBalance));
  return { asOf, rows: out, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export async function profitAndLoss(from: string, to: string, opts: { compare?: boolean; dentistId?: string } = {}) {
  const build = async (f: string, t: string) => {
    const list = rollUp(rows(await accountList(), await totalsByAccount({ from: f, to: t, ...(opts.dentistId ? { dentistId: opts.dentistId } : {}) })));
    const revenue = list.filter((r) => r.type === 'revenue');
    const expense = list.filter((r) => r.type === 'expense');
    const leaf = (l: AccountRow[]) => l.filter((r) => !r.isGroup);
    const totalRevenue = sum(leaf(revenue).map((r) => r.balance));
    const totalExpense = sum(leaf(expense).map((r) => r.balance));
    return { revenue, expense, totalRevenue, totalExpense, netIncome: totalRevenue - totalExpense };
  };
  const current = await build(from, to);
  let previous: Awaited<ReturnType<typeof build>> | undefined;
  if (opts.compare) {
    const len = daysBetween(from, to) + 1;
    previous = await build(addDays(from, -len), addDays(from, -1));
  }
  return { from, to, ...current, ...(previous ? { previous: { totalRevenue: previous.totalRevenue, totalExpense: previous.totalExpense, netIncome: previous.netIncome } } : {}) };
}

export async function balanceSheet(asOf: string, fiscalYearStart: string) {
  const list = rollUp(rows(await accountList(), await totalsByAccount({ to: asOf })));
  const pick = (type: string) => list.filter((r) => r.type === type);
  const leafSum = (type: string) => sum(list.filter((r) => r.type === type && !r.isGroup).map((r) => r.balance));
  // Profit not yet closed into retained earnings shows as current-year earnings.
  const pl = await profitAndLoss(fiscalYearStart, asOf);
  const priorPl = await totalsByAccount({ to: addDays(fiscalYearStart, -1) });
  const priorRows = rows(await accountList(), priorPl).filter((r) => !r.isGroup);
  const priorUnclosed = sum(priorRows.filter((r) => r.type === 'revenue').map((r) => r.balance)) - sum(priorRows.filter((r) => r.type === 'expense').map((r) => r.balance));
  const assets = leafSum('asset');
  const liabilities = leafSum('liability');
  const equity = leafSum('equity') + pl.netIncome + priorUnclosed;
  return { asOf, assets: pick('asset'), liabilities: pick('liability'), equity: pick('equity'), currentEarnings: pl.netIncome + priorUnclosed, totalAssets: assets, totalLiabilities: liabilities, totalEquity: equity, balanced: assets === liabilities + equity };
}

export async function generalLedger(accountId: string, from: string, to: string) {
  const acc = await AccountModel.findById(accountId).lean();
  if (!acc) return null;
  const sign = acc.normalBalance === 'debit' ? 1 : -1;
  const aid = new Types.ObjectId(accountId);
  const before = await JournalEntryModel.aggregate<{ d: number; c: number }>([
    { $match: { clinicId: new Types.ObjectId(currentClinicId()), status: LIVE, date: { $lt: from } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': aid } },
    { $group: { _id: null, d: { $sum: '$lines.debit' }, c: { $sum: '$lines.credit' } } },
  ]);
  const opening = sign * ((before[0]?.d ?? 0) - (before[0]?.c ?? 0));
  const entries = await JournalEntryModel.find({ status: LIVE, date: { $gte: from, $lte: to }, 'lines.accountId': aid }).sort({ date: 1, createdAt: 1 }).limit(2000).lean();
  let running = opening;
  const lines = entries.flatMap((e) =>
    e.lines
      .filter((l) => l.accountId.equals(aid))
      .map((l) => {
        running += sign * ((l.debit ?? 0) - (l.credit ?? 0));
        return { entryId: String(e._id), number: e.number, date: e.date, source: e.source, sourceId: e.sourceId ? String(e.sourceId) : undefined, memo: e.memo, description: l.description, debit: l.debit ?? 0, credit: l.credit ?? 0, balance: running, patientId: l.patientId ? String(l.patientId) : undefined };
      }),
  );
  return { account: { id: String(acc._id), code: acc.code, name: acc.name, systemKey: acc.systemKey, type: acc.type }, from, to, opening, closing: running, lines };
}

const bucketOf = (days: number) => (days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over90');

/** AR aging by due date (installments respected), for patients or insurers. */
/** `dentistId` = own scope: only invoices with that doctor's work, and only their share of what is owed (09 §8.1). */
export async function arAging(asOf: string, payer: 'patient' | 'insurance', opts: { dentistId?: string } = {}) {
  const invs = await InvoiceModel.find({ type: 'invoice', status: { $in: ['issued', 'partially_paid'] }, issueDate: { $lte: asOf }, ...(opts.dentistId ? doctorInvoiceFilter(opts.dentistId) : {}) }).lean();
  const { dues } = await import('@/modules/billing/invoice.service');
  const groups = new Map<string, { key: string; current: number; d30: number; d60: number; d90: number; over90: number; total: number }>();
  for (const inv of invs) {
    const d = dues(inv);
    const due = payer === 'insurance' ? d.insuranceDue : d.patientDue;
    const owed = opts.dentistId ? shareOf(due, inv, opts.dentistId) : due;
    if (owed <= 0) continue;
    const key = payer === 'insurance' ? String(inv.insuranceCompanyId ?? '') : String(inv.patientId);
    const g = groups.get(key) ?? { key, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    const plan = (inv.installmentPlan ?? []).filter((p) => (p.amount ?? 0) > (p.paidAmount ?? 0));
    const parts = payer === 'patient' && plan.length ? plan.map((p) => ({ due: p.dueDate ?? inv.dueDate ?? asOf, amount: Math.min(owed, opts.dentistId ? shareOf((p.amount ?? 0) - (p.paidAmount ?? 0), inv, opts.dentistId) : (p.amount ?? 0) - (p.paidAmount ?? 0)) })) : [{ due: inv.dueDate ?? inv.issueDate ?? asOf, amount: owed }];
    for (const part of parts) {
      const b = bucketOf(daysBetween(part.due, asOf));
      g[b] += part.amount;
      g.total += part.amount;
    }
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total);
  const names = payer === 'insurance'
    ? new Map((await (await import('@/modules/patients/patient.models')).InsuranceCompanyModel.find({ _id: { $in: list.map((g) => g.key).filter(Boolean) } }).select('name').lean()).map((c) => [String(c._id), c.name ?? '']))
    : new Map((await PatientModel.find({ _id: { $in: list.map((g) => g.key) } }).select('fullName fileNumber').lean()).map((p) => [String(p._id), `${p.fullName} · ${p.fileNumber}`]));
  const totals = { current: sum(list.map((g) => g.current)), d30: sum(list.map((g) => g.d30)), d60: sum(list.map((g) => g.d60)), d90: sum(list.map((g) => g.d90)), over90: sum(list.map((g) => g.over90)), total: sum(list.map((g) => g.total)) };
  return { asOf, payer, rows: list.map((g) => ({ ...g, name: names.get(g.key) ?? '' })), totals };
}

export async function apAging(asOf: string) {
  const bills = await SupplierBillModel.find({ status: { $in: ['posted', 'partially_paid'] }, billDate: { $lte: asOf } }).lean();
  const groups = new Map<string, { key: string; current: number; d30: number; d60: number; d90: number; over90: number; total: number }>();
  for (const b of bills) {
    const owed = (b.total ?? 0) - (b.amountPaid ?? 0);
    if (owed <= 0) continue;
    const key = String(b.supplierId);
    const g = groups.get(key) ?? { key, current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
    g[bucketOf(daysBetween(b.dueDate ?? b.billDate, asOf))] += owed;
    g.total += owed;
    groups.set(key, g);
  }
  const list = [...groups.values()];
  const names = new Map((await SupplierModel.find({ _id: { $in: list.map((g) => g.key) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
  return { asOf, rows: list.map((g) => ({ ...g, name: names.get(g.key) ?? '' })), totals: { total: sum(list.map((g) => g.total)) } };
}

export async function vatReturn(from: string, to: string) {
  const accts = await AccountModel.find({ systemKey: { $in: ['VAT_OUTPUT', 'VAT_INPUT'] } }).lean();
  const totals = await totalsByAccount({ from, to });
  const get = (key: string) => {
    const a = accts.find((x) => x.systemKey === key);
    const t = totals.find((x) => a && x._id.equals(a._id));
    return { debit: t?.debit ?? 0, credit: t?.credit ?? 0 };
  };
  const out = get('VAT_OUTPUT');
  const inp = get('VAT_INPUT');
  const outputVat = out.credit - out.debit;
  const inputVat = inp.debit - inp.credit;
  return { from, to, outputVat, inputVat, payable: outputVat - inputVat };
}

export async function dailyCash(date: string) {
  const pays = await PaymentModel.find({ date }).lean();
  const byMethod = new Map<string, { method: string; count: number; total: number }>();
  for (const p of pays) {
    const m = byMethod.get(p.method) ?? { method: p.method, count: 0, total: 0 };
    m.count += 1;
    m.total += p.amount;
    byMethod.set(p.method, m);
  }
  const refunds = sum(pays.flatMap((p) => (p.refunds ?? []).map((r) => r.amount ?? 0)));
  const sessions = await CashSessionModel.find({ openedAt: { $lte: new Date(`${date}T23:59:59Z`) }, $or: [{ closedAt: null }, { closedAt: { $gte: new Date(`${date}T00:00:00Z`) } }] }).lean();
  return { date, byMethod: [...byMethod.values()], total: sum(pays.map((p) => p.amount)), refunds, sessions: sessions.map((s) => ({ id: String(s._id), openedAt: s.openedAt, closedAt: s.closedAt, openingFloat: s.openingFloat, expected: s.expectedAmount, counted: s.countedAmount, difference: s.difference, status: s.status })) };
}

/** Patient statement: opening balance, documents, closing (09 §8). */
export async function patientStatement(patientId: string, from: string, to: string, opts: { dentistId?: string; tz?: string } = {}) {
  if (opts.dentistId) return doctorPatientStatement(patientId, from, to, opts.dentistId, opts.tz ?? 'Asia/Amman');
  const accts = await AccountModel.find({ systemKey: { $in: ['AR_PATIENTS', 'PATIENT_CREDIT'] } }).lean();
  const ids = accts.map((a) => a._id);
  const pid = new Types.ObjectId(patientId);
  const sign = (accountId: Types.ObjectId, d: number, c: number) => {
    const a = accts.find((x) => x._id.equals(accountId));
    // Patient owes: AR debit balance minus credit held.
    return a?.systemKey === 'AR_PATIENTS' ? d - c : -(c - d);
  };
  const entries = await JournalEntryModel.find({ status: LIVE, 'lines.patientId': pid, date: { $lte: to } }).sort({ date: 1, createdAt: 1 }).lean();
  let opening = 0;
  let running = 0;
  const lines: { date: string; number?: string | null; source: string; memo: string; charge: number; credit: number; balance: number }[] = [];
  for (const e of entries) {
    const delta = e.lines.filter((l) => l.patientId?.equals(pid) && ids.some((x) => x.equals(l.accountId))).reduce((acc, l) => acc + sign(l.accountId, l.debit ?? 0, l.credit ?? 0), 0);
    if (!delta) continue;
    if (e.date < from) {
      opening += delta;
      running = opening;
      continue;
    }
    running += delta;
    lines.push({ date: e.date, number: e.number, source: e.source, memo: e.memo ?? '', charge: Math.max(0, delta), credit: Math.max(0, -delta), balance: running });
  }
  if (!lines.length) running = opening;
  const patient = await PatientModel.findById(patientId).select('fullName fileNumber phone').lean();
  return { patient: patient ? { fullName: patient.fullName, fileNumber: patient.fileNumber, phone: patient.phone?.e164 } : null, from, to, opening, closing: running, lines };
}

/** Insurance write-offs per doctor, straight from the ledger (claim journals' doctor-split DISCOUNTS debits, 09 §8.1). */
async function writeOffsByDoctor(from: string, to: string): Promise<Map<string, number>> {
  const acct = await AccountModel.findOne({ systemKey: 'DISCOUNTS' }).select('_id').lean();
  if (!acct) return new Map();
  const rows = await JournalEntryModel.aggregate<{ _id: Types.ObjectId | null; amount: number }>([
    { $match: { clinicId: new Types.ObjectId(currentClinicId()), status: LIVE, source: 'claim', date: { $gte: from, $lte: to } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountId': acct._id } },
    { $group: { _id: '$lines.dentistId', amount: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } },
  ]);
  return new Map(rows.map((r) => [r._id ? String(r._id) : UNASSIGNED, r.amount]));
}

/**
 * Own-scope statement (04 §3): built from the invoices that include this doctor's work only, never
 * from the patient's whole ledger. Those invoices are shown in full (shared invoices are visible in
 * full), with their credit notes and the money applied to them.
 */
async function doctorPatientStatement(patientId: string, from: string, to: string, dentistId: string, tz: string) {
  const invs = await InvoiceModel.find({ patientId: new Types.ObjectId(patientId), type: 'invoice', status: { $in: ['issued', 'partially_paid', 'paid'] }, issueDate: { $lte: to }, ...doctorInvoiceFilter(dentistId) }).select('number issueDate total').lean();
  const ids = new Set(invs.map((i) => String(i._id)));
  const credits = await InvoiceModel.find({ type: 'credit_note', originalInvoiceId: { $in: invs.map((i) => i._id) }, issueDate: { $lte: to } }).select('number issueDate total').lean();
  const moves = (await collectionMovements('0000-01-01', to, tz, { patientId })).filter((m) => ids.has(m.invoiceId));
  const events = [
    ...invs.map((i) => ({ date: i.issueDate ?? '', number: i.number, source: 'invoice', delta: i.total ?? 0 })),
    ...credits.map((c) => ({ date: c.issueDate ?? '', number: c.number, source: 'credit_note', delta: -(c.total ?? 0) })),
    ...moves.map((m) => ({ date: m.date, number: null, source: m.amount >= 0 ? 'payment' : 'refund', delta: -m.amount })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let opening = 0;
  let running = 0;
  const lines: { date: string; number?: string | null; source: string; memo: string; charge: number; credit: number; balance: number }[] = [];
  for (const e of events) {
    if (!e.delta) continue;
    if (e.date < from) {
      opening += e.delta;
      running = opening;
      continue;
    }
    running += e.delta;
    lines.push({ date: e.date, number: e.number, source: e.source, memo: '', charge: Math.max(0, e.delta), credit: Math.max(0, -e.delta), balance: running });
  }
  if (!lines.length) running = opening;
  const patient = await PatientModel.findById(patientId).select('fullName fileNumber').lean();
  return { patient: patient ? { fullName: patient.fullName, fileNumber: patient.fileNumber } : null, from, to, opening, closing: running, lines, scope: 'own' as const };
}

/**
 * Production (performed procedures, by performer) and collection (money applied to invoices, split
 * by each invoice's doctor weights, net of refunds) per doctor (09 §8.1). `dentistId` = own scope.
 */
export async function dentistProduction(from: string, to: string, opts: { dentistId?: string; tz?: string } = {}) {
  const prod = await PerformedProcedureModel.aggregate<{ _id: Types.ObjectId; production: number; count: number }>([
    { $match: { clinicId: new Types.ObjectId(currentClinicId()), status: 'completed', performedAt: { $gte: new Date(`${from}T00:00:00Z`), $lte: new Date(`${to}T23:59:59Z`) }, ...(opts.dentistId ? { dentistId: new Types.ObjectId(opts.dentistId) } : {}) } },
    { $group: { _id: '$dentistId', production: { $sum: { $subtract: [{ $multiply: ['$unitPrice', '$quantity'] }, '$discount'] } }, count: { $sum: 1 } } },
  ]);
  const coll = await collectionsByDoctor(from, to, opts.tz ?? 'Asia/Amman');
  const writtenOff = await writeOffsByDoctor(from, to);
  const keys = new Set([...prod.map((p) => String(p._id)), ...[...coll.entries(), ...writtenOff.entries()].filter(([, v]) => v !== 0).map(([k]) => k)]);
  // Own scope: never return another doctor's row, not even a zero one.
  const visible = opts.dentistId ? [opts.dentistId] : [...keys];
  const staff = new Map((await StaffModel.find({ _id: { $in: visible.filter((k) => k !== UNASSIGNED) } }).select('name').lean()).map((s) => [String(s._id), s.name]));
  const rows = visible.map((k) => ({ dentistId: k, name: staff.get(k) ?? '', procedures: prod.find((p) => String(p._id) === k)?.count ?? 0, production: prod.find((p) => String(p._id) === k)?.production ?? 0, collection: coll.get(k) ?? 0, writtenOff: writtenOff.get(k) ?? 0 }));
  return { from, to, rows, scope: opts.dentistId ? ('own' as const) : ('all' as const) };
}
