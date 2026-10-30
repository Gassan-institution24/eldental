import { Schema, model, type ClientSession, Types } from 'mongoose';
import { currentClinicId } from '../tenancy/tenantPlugin';

const counterSchema = new Schema(
  {
    clinicId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true },
    year: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
  },
  { collection: 'counters', versionKey: false },
);
counterSchema.index({ clinicId: 1, key: 1, year: 1 }, { unique: true });

export const CounterModel = model('Counter', counterSchema);

type NextOpts = { year?: number; session?: ClientSession | null; clinicId?: string | Types.ObjectId };

/**
 * Atomic, gapless-within-transaction counter (02_ARCHITECTURE.md §6). One `$inc` per call.
 * Pass the transaction session for invoice numbers so a rollback releases the number.
 */
export async function nextSequence(key: string, opts: NextOpts = {}): Promise<number> {
  const clinic = opts.clinicId ?? currentClinicId();
  if (!clinic) throw new Error('nextSequence needs a clinic');
  const res = await CounterModel.findOneAndUpdate(
    { clinicId: new Types.ObjectId(String(clinic)), key, year: opts.year ?? 0 },
    { $inc: { value: 1 } },
    { upsert: true, new: true, session: opts.session ?? undefined },
  ).lean();
  return res.value;
}

/** Formats a sequence: `formatNumber('INV', 123, { year: 2026, pad: 6 })` → `INV-2026-000123`. */
export function formatNumber(prefix: string, value: number, opts: { year?: number; pad?: number } = {}): string {
  const num = String(value).padStart(opts.pad ?? 6, '0');
  return opts.year ? `${prefix}-${opts.year}-${num}` : `${prefix}-${num}`;
}

export async function nextNumber(key: string, prefix: string, opts: NextOpts & { pad?: number } = {}): Promise<string> {
  const v = await nextSequence(key, opts);
  return formatNumber(prefix, v, { year: opts.year, pad: opts.pad });
}
