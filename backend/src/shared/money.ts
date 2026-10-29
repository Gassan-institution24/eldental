/**
 * Money helpers (09_MODULE_ACCOUNTING.md §1). Amounts are integer minor units
 * (JOD fils: 1 JOD = 1000). Floats never hold money; every operation returns a safe integer.
 */
export type Money = number;

export const CURRENCY_DECIMALS: Record<string, number> = {
  JOD: 3,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  USD: 2,
  EUR: 2,
  SAR: 2,
  AED: 2,
  EGP: 2,
};

export function decimalsOf(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

function assertMoney(v: number, label = 'amount'): void {
  if (!Number.isSafeInteger(v)) {
    throw new RangeError(`${label} must be a safe integer (minor units), got ${v}`);
  }
}

export function add(...values: Money[]): Money {
  let total = 0;
  for (const v of values) {
    assertMoney(v);
    total += v;
  }
  assertMoney(total, 'sum');
  return total;
}

export function sub(a: Money, b: Money): Money {
  assertMoney(a);
  assertMoney(b);
  return a - b;
}

export function sum(values: readonly Money[]): Money {
  return add(...values);
}

export function neg(a: Money): Money {
  assertMoney(a);
  return a === 0 ? 0 : -a;
}

/** Round half to even on an exact rational (numerator / denominator, both integers). */
function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  let q = n / d;
  const twice = (n % d) * 2n;
  if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
  return negative ? -q : q;
}

/** amount × rate, with rate in basis points (1600 = 16%). Banker's rounding. */
export function mulRate(amount: Money, basisPoints: number): Money {
  assertMoney(amount);
  if (!Number.isInteger(basisPoints)) throw new RangeError('basisPoints must be an integer');
  return Number(roundHalfEven(BigInt(amount) * BigInt(basisPoints), 10000n));
}

/** amount × quantity (integer). */
export function mul(amount: Money, quantity: number): Money {
  assertMoney(amount);
  if (!Number.isInteger(quantity)) throw new RangeError('quantity must be an integer');
  const r = amount * quantity;
  assertMoney(r, 'product');
  return r;
}

/** amount × numerator / denominator with banker's rounding (pro-rata, hourly rates…). */
export function mulFraction(amount: Money, numerator: number, denominator: number): Money {
  assertMoney(amount);
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || denominator === 0) {
    throw new RangeError('numerator and denominator must be integers, denominator ≠ 0');
  }
  return Number(roundHalfEven(BigInt(amount) * BigInt(numerator), BigInt(denominator)));
}

/** Percent (0–100, up to 2 decimals) → basis points. */
export function percentToBasisPoints(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * Splits `total` across `weights` proportionally. The parts always sum to `total`;
 * remainders go to the largest fractional parts first (largest-remainder method).
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  assertMoney(total);
  if (weights.length === 0) return [];
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) throw new RangeError('weights must be ≥ 0');
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum === 0) {
    const parts = weights.map(() => 0);
    parts[0] = total;
    return parts;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / weightSum);
  const parts = raw.map((r) => Math.floor(r));
  let remainder = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder -= 1) {
    const idx = order[k]?.i ?? 0;
    parts[idx] = (parts[idx] ?? 0) + 1;
  }
  return parts.map((p) => (p === 0 ? 0 : p * sign));
}

/** Parses a decimal string ("1,234.5") into minor units; null if invalid or too precise. */
export function parseDecimal(input: string, currency: string): Money | null {
  const decimals = decimalsOf(currency);
  const s = input.replace(/,/g, '').trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? '';
  if (frac.length > decimals) return null;
  const minor = Number(`${m[2]}${frac.padEnd(decimals, '0')}`);
  if (!Number.isSafeInteger(minor)) return null;
  return m[1] ? -minor : minor;
}

/** Minor units → fixed decimal string ("1.500"). */
export function toDecimalString(amount: Money, currency: string): string {
  assertMoney(amount);
  const decimals = decimalsOf(currency);
  const negative = amount < 0;
  const abs = String(Math.abs(amount)).padStart(decimals + 1, '0');
  const whole = abs.slice(0, abs.length - decimals);
  const frac = abs.slice(abs.length - decimals);
  return `${negative ? '-' : ''}${whole}${decimals ? `.${frac}` : ''}`;
}

export function format(amount: Money, currency: string, locale = 'en'): string {
  const decimals = decimalsOf(currency);
  const value = Number(toDecimalString(amount, currency));
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-JO-u-nu-latn' : 'en-JO', {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export const isZero = (a: Money) => a === 0;
export const minOf = (a: Money, b: Money) => (a < b ? a : b);
export const maxOf = (a: Money, b: Money) => (a > b ? a : b);
