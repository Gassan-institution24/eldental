import { Types } from 'mongoose';
import type { AuthContext } from '@/core/auth/auth.types';
import { scopeFor } from '@/core/rbac/authorize';
import { localDate } from '@/shared/dates';
import { allocate } from '@/shared/money';
import { InvoiceModel, PaymentModel } from './billing.models';

/**
 * Doctor attribution of invoice money (09 §8.1).
 *
 * - Weight of a doctor on an invoice = sum of `lineTotal` of the lines they are responsible for
 *   (after line and invoice discounts, tax included). A line without a doctor falls back to the
 *   invoice header doctor, then to "unassigned" ('').
 * - Any amount on that invoice (a payment allocation, a refund, an open balance) is split by those
 *   weights with the largest-remainder method, so the parts always add up to the amount exactly.
 * - Credit notes scale every line by the same factor, so they never change the weights.
 */

export const UNASSIGNED = '';

type LineLike = { dentistId?: unknown; lineTotal?: number | null };
type InvoiceLike = { dentistId?: unknown; lines?: LineLike[] | null };

export function doctorWeights(inv: InvoiceLike): Map<string, number> {
  const header = inv.dentistId ? String(inv.dentistId) : UNASSIGNED;
  const out = new Map<string, number>();
  for (const l of inv.lines ?? []) {
    const k = l.dentistId ? String(l.dentistId) : header;
    out.set(k, (out.get(k) ?? 0) + Math.max(0, l.lineTotal ?? 0));
  }
  if (!out.size) out.set(header, 0);
  return out;
}

/** Splits `amount` (minor units, may be negative) across the invoice's doctors. */
export function splitByDoctor(amount: number, weights: Map<string, number>): Map<string, number> {
  const keys = [...weights.keys()];
  const parts = allocate(amount, keys.map((k) => weights.get(k) ?? 0));
  return new Map(keys.map((k, i) => [k, parts[i] ?? 0]));
}

export function shareOf(amount: number, inv: InvoiceLike, dentistId: string): number {
  return splitByDoctor(amount, doctorWeights(inv)).get(dentistId) ?? 0;
}

/** Invoices a doctor may see with `own` scope: header doctor or doctor of at least one line. */
export function doctorInvoiceFilter(dentistId: string): Record<string, unknown> {
  const me = new Types.ObjectId(dentistId);
  return { $or: [{ dentistId: me }, { 'lines.dentistId': me }] };
}

/** null = clinic-wide; otherwise the caller's staff id (own scope on every permission given). */
export function ownDoctorOf(auth: AuthContext, ...permissions: string[]): string | null {
  if (auth.isOwner || auth.isRoot) return null;
  if (permissions.some((p) => scopeFor(auth, p) === 'all')) return null;
  return auth.staffId ?? '000000000000000000000000';
}

type Movement = { date: string; invoiceId: string; paymentId: string; amount: number };

/**
 * Money applied to invoices, dated (09 §8.1):
 * - an allocation counts on the payment date, or on the day it was applied when it came later
 *   (an advance payment allocated afterwards);
 * - a refund taken back from an invoice counts, negative, on the refund date. Refunds recorded
 *   before per-invoice refund parts existed are already netted into the allocation amount.
 */
export async function collectionMovements(from: string, to: string, tz: string, opts: { patientId?: string } = {}): Promise<Movement[]> {
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const pays = await PaymentModel.find({
    status: { $ne: 'void' },
    date: { $lte: to },
    ...(opts.patientId ? { patientId: new Types.ObjectId(opts.patientId) } : {}),
    $or: [{ date: { $gte: from } }, { 'allocations.at': { $gte: start } }, { 'refunds.at': { $gte: start } }],
  })
    .select('date createdAt allocations refunds')
    .lean();
  const out: Movement[] = [];
  for (const p of pays) {
    const created = p.createdAt ? localDate(p.createdAt, tz) : p.date;
    const refundedBack = new Map<string, number>();
    for (const r of p.refunds ?? []) {
      for (const part of (r as { invoices?: { invoiceId?: unknown; amount?: number | null }[] }).invoices ?? []) {
        const k = String(part.invoiceId);
        refundedBack.set(k, (refundedBack.get(k) ?? 0) + (part.amount ?? 0));
        const d = r.at ? localDate(r.at, tz) : p.date;
        if (d >= from && d <= to) out.push({ date: d, invoiceId: k, paymentId: String(p._id), amount: -(part.amount ?? 0) });
      }
    }
    for (const a of p.allocations ?? []) {
      const k = String(a.invoiceId);
      const applied = a.at ? localDate(a.at, tz) : p.date;
      const d = applied > created ? applied : p.date;
      // The allocation was reduced by refunds that are now counted separately on their own date.
      const gross = (a.amount ?? 0) + (refundedBack.get(k) ?? 0);
      refundedBack.delete(k);
      if (gross && d >= from && d <= to) out.push({ date: d, invoiceId: k, paymentId: String(p._id), amount: gross });
    }
    // Fully refunded allocations are removed from the payment; their gross still counts.
    for (const [k, amount] of refundedBack) {
      if (amount && p.date >= from && p.date <= to) out.push({ date: p.date, invoiceId: k, paymentId: String(p._id), amount });
    }
  }
  return out;
}

/** Each movement split across the invoice's doctors. */
export async function attributedMovements(from: string, to: string, tz: string) {
  const moves = await collectionMovements(from, to, tz);
  const invs = new Map(
    (await InvoiceModel.find({ _id: { $in: [...new Set(moves.map((m) => m.invoiceId))] } }).select('dentistId lines.dentistId lines.lineTotal').lean()).map((i) => [String(i._id), i]),
  );
  return moves.map((m) => {
    const inv = invs.get(m.invoiceId);
    return { ...m, parts: splitByDoctor(m.amount, inv ? doctorWeights(inv) : new Map([[UNASSIGNED, 0]])) };
  });
}

/** Collections per doctor (minor units) for the range, proportional to each invoice's weights. */
export async function collectionsByDoctor(from: string, to: string, tz: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const m of await attributedMovements(from, to, tz)) for (const [k, v] of m.parts) out.set(k, (out.get(k) ?? 0) + v);
  return out;
}
