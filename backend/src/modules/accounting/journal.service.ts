import { Types, type ClientSession } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { ApiError } from '@/core/http/ApiError';
import { scopeFor } from '@/core/rbac/authorize';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { daysInMonth, localDate } from '@/shared/dates';
import { sum } from '@/shared/money';
import { AccountModel, FiscalPeriodModel, FiscalYearModel, JournalEntryModel, type JournalLine, type JournalSource } from './accounting.models';
import { isBalanced, mirror, type AccountMap } from './posting/postingRules';
import { CHART_OF_ACCOUNTS, normalBalanceOf } from './seed/chartOfAccounts.jo';

/* ---------- ledger setup (chart of accounts + fiscal year) ---------- */

/** Idempotent: seeds the chart of accounts and the current fiscal year for a clinic. */
export async function ensureLedger(session?: ClientSession, today = new Date()) {
  if (!(await AccountModel.exists({}).session(session ?? null))) {
    const byCode = new Map<string, Types.ObjectId>();
    for (const a of CHART_OF_ACCOUNTS) {
      const id = new Types.ObjectId();
      byCode.set(a.code, id);
      await AccountModel.create(
        [
          {
            _id: id,
            code: a.code,
            name: null,
            systemKey: a.key,
            searchName: a.code,
            type: a.type,
            subtype: a.subtype ?? '',
            parentId: a.parent ? byCode.get(a.parent) : undefined,
            isGroup: Boolean(a.group),
            isSystem: Boolean(a.key),
            normalBalance: a.subtype === 'contra_revenue' ? 'debit' : normalBalanceOf(a.type),
          },
        ],
        { session },
      );
    }
  }
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.fiscalYearStartMonth').lean());
  const startMonth = clinic?.settings?.fiscalYearStartMonth ?? 1;
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth() + 1;
  await ensureFiscalYear(m >= startMonth ? y : y - 1, startMonth, session);
}

export async function ensureFiscalYear(year: number, startMonth: number, session?: ClientSession) {
  const existing = await FiscalYearModel.findOne({ year }).session(session ?? null);
  if (existing) return existing;
  const pad = (n: number) => String(n).padStart(2, '0');
  const startDate = `${year}-${pad(startMonth)}-01`;
  const endY = startMonth === 1 ? year : year + 1;
  const endM = startMonth === 1 ? 12 : startMonth - 1;
  const endDate = `${endY}-${pad(endM)}-${pad(daysInMonth(endY, endM))}`;
  const [fy] = await FiscalYearModel.create([{ year, startDate, endDate }], { session });
  const periods = Array.from({ length: 12 }, (_, i) => {
    const mm = ((startMonth - 1 + i) % 12) + 1;
    const yy = startMonth - 1 + i >= 12 ? year + 1 : year;
    return { fiscalYearId: fy!._id, year: yy, month: mm, startDate: `${yy}-${pad(mm)}-01`, endDate: `${yy}-${pad(mm)}-${pad(daysInMonth(yy, mm))}` };
  });
  await FiscalPeriodModel.insertMany(periods, { session });
  return fy!;
}

/* ---------- account map ---------- */

/** Loads system-key → account id once per operation (09 §1.5). Missing keys throw. */
export async function loadAccountMap(session?: ClientSession): Promise<AccountMap> {
  const rows = await AccountModel.find({ systemKey: { $type: 'string' } }).select('systemKey').session(session ?? null).lean();
  const map = new Map(rows.map((r) => [r.systemKey!, String(r._id)]));
  return (key: string) => {
    const id = map.get(key);
    if (!id) throw new Error(`Account with system key ${key} is missing`);
    return id;
  };
}

/* ---------- periods ---------- */

export async function periodFor(date: string, session?: ClientSession) {
  let p = await FiscalPeriodModel.findOne({ startDate: { $lte: date }, endDate: { $gte: date } }).session(session ?? null);
  if (!p) {
    // Next year's periods are created on demand (first posting of the new year).
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.fiscalYearStartMonth').lean());
    const start = clinic?.settings?.fiscalYearStartMonth ?? 1;
    const [y, m] = date.split('-').map(Number) as [number, number];
    await ensureFiscalYear(m >= start ? y : y - 1, start, session);
    p = await FiscalPeriodModel.findOne({ startDate: { $lte: date }, endDate: { $gte: date } }).session(session ?? null);
  }
  if (!p) throw ApiError.validation([{ path: 'date', code: 'out_of_range' }]);
  return p;
}

function assertPeriodOpen(period: { status: string }, auth: AuthContext | null) {
  if (period.status === 'closed') throw new ApiError(423, 'PERIOD_CLOSED', 'This accounting period is closed');
  if (period.status === 'soft_closed' && !(auth && (auth.isOwner || scopeFor(auth, 'accounting.period.manage')))) {
    throw new ApiError(423, 'PERIOD_CLOSED', 'This accounting period is soft-closed');
  }
}

/* ---------- posting ---------- */

export type EntryDraft = { date: string; source: JournalSource; sourceId?: Types.ObjectId | string; memo?: string; lines: JournalLine[]; allowControlAccounts?: boolean };

/**
 * Validates and posts a journal entry (09 §1): balanced, accounts postable, period open.
 * Must be called inside the business document's transaction.
 */
export async function postEntry(auth: AuthContext | null, d: EntryDraft, session?: ClientSession) {
  if (!d.lines.length || !isBalanced(d.lines)) throw ApiError.conflict('JOURNAL_NOT_BALANCED', 'Debits must equal credits', { debit: sum(d.lines.map((l) => l.debit)), credit: sum(d.lines.map((l) => l.credit)) });
  const ids = [...new Set(d.lines.map((l) => l.accountId))];
  const accounts = await AccountModel.find({ _id: { $in: ids } }).select('isGroup isActive systemKey subtype').session(session ?? null).lean();
  if (accounts.length !== ids.length) throw ApiError.validation([{ path: 'lines', code: 'not_found' }]);
  if (accounts.some((a) => a.isGroup)) throw ApiError.conflict('JOURNAL_GROUP_ACCOUNT', 'Group accounts cannot be posted to');
  if (d.source === 'manual' && !d.allowControlAccounts && accounts.some((a) => ['accounts_receivable', 'accounts_payable', 'patient_credit'].includes(a.subtype ?? ''))) {
    throw ApiError.conflict('JOURNAL_CONTROL_ACCOUNT', 'Receivable/payable control accounts are posted by documents only');
  }
  const period = await periodFor(d.date, session);
  assertPeriodOpen(period, auth);
  const year = Number(d.date.slice(0, 4));
  const [entry] = await JournalEntryModel.create(
    [
      {
        number: await nextNumber('journal', 'JE', { year, session: session ?? null }),
        date: d.date,
        fiscalPeriodId: period._id,
        source: d.source,
        sourceId: d.sourceId,
        memo: d.memo ?? '',
        lines: d.lines,
        total: sum(d.lines.map((l) => l.debit)),
        status: 'posted',
        postedAt: new Date(),
        postedBy: auth?.userId,
        createdByUserId: auth?.userId,
      },
    ],
    { session },
  );
  return entry!;
}

/** Mirror entry; the original becomes `reversed`. A reversal cannot itself be reversed. */
export async function reverseEntry(auth: AuthContext | null, id: Types.ObjectId | string, opts: { date: string; memo?: string; source?: JournalSource }, session?: ClientSession) {
  const orig = await JournalEntryModel.findById(id).session(session ?? null);
  if (!orig) throw ApiError.notFound();
  if (orig.status !== 'posted') throw ApiError.conflict('JOURNAL_ALREADY_REVERSED', 'Only posted entries can be reversed');
  if (orig.source === 'reversal' || orig.reversalOfId) throw ApiError.conflict('JOURNAL_REVERSAL_OF_REVERSAL', 'A reversal cannot be reversed');
  const lines = mirror(plainLines(orig.lines));
  const rev = await postEntry(auth, { date: opts.date, source: opts.source ?? 'reversal', sourceId: orig.sourceId ?? undefined, memo: opts.memo ?? `Reversal of ${orig.number}`, lines }, session);
  rev.reversalOfId = orig._id;
  await rev.save({ session });
  orig.status = 'reversed';
  orig.reversedById = rev._id;
  await orig.save({ session });
  return rev;
}

/* ---------- manual journals (09 §5) ---------- */

export async function createManualDraft(auth: AuthContext, b: { date: string; memo?: string; lines: JournalLine[] }) {
  const [e] = await JournalEntryModel.create([{ date: b.date, source: 'manual', memo: b.memo ?? '', lines: b.lines, total: sum(b.lines.map((l) => l.debit)), status: 'draft', createdByUserId: auth.userId }]);
  await recordAudit({ action: 'create', entity: 'journalEntry', entityId: e!._id, after: { date: b.date, total: e!.total } });
  return e!;
}

export async function postManual(auth: AuthContext, id: string, allowControlAccounts: boolean) {
  const draft = await JournalEntryModel.findOne({ _id: id, source: 'manual' });
  if (!draft) throw ApiError.notFound();
  if (draft.status !== 'draft') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Already posted');
  const lines = draft.lines.map((l) => ({ accountId: String(l.accountId), debit: l.debit ?? 0, credit: l.credit ?? 0, description: l.description ?? '' }));
  if (!isBalanced(lines)) throw ApiError.conflict('JOURNAL_NOT_BALANCED', 'Debits must equal credits');
  const posted = await postEntry(auth, { date: draft.date, source: 'manual', memo: draft.memo, lines, allowControlAccounts });
  await draft.deleteOne();
  await recordAudit({ action: 'post', entity: 'journalEntry', entityId: posted._id, after: { number: posted.number, total: posted.total } });
  return posted;
}

type StoredLine = { accountId: unknown; debit?: number | null; credit?: number | null; patientId?: unknown; supplierId?: unknown; staffId?: unknown; dentistId?: unknown; insuranceCompanyId?: unknown; description?: string | null };

/** Stored (ObjectId) lines → plain posting lines. */
export function plainLines(lines: readonly StoredLine[]): JournalLine[] {
  return lines.map((l) => ({
    accountId: String(l.accountId),
    debit: l.debit ?? 0,
    credit: l.credit ?? 0,
    ...(l.patientId ? { patientId: String(l.patientId) } : {}),
    ...(l.supplierId ? { supplierId: String(l.supplierId) } : {}),
    ...(l.staffId ? { staffId: String(l.staffId) } : {}),
    ...(l.dentistId ? { dentistId: String(l.dentistId) } : {}),
    ...(l.insuranceCompanyId ? { insuranceCompanyId: String(l.insuranceCompanyId) } : {}),
    description: l.description ?? '',
  }));
}

export async function clinicTimezone(): Promise<string> {
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('timezone').lean());
  return clinic?.timezone ?? 'Asia/Amman';
}

/** Today in the clinic timezone (document dates are clinic-local). */
export async function clinicToday(): Promise<string> {
  return localDate(new Date(), await clinicTimezone());
}
