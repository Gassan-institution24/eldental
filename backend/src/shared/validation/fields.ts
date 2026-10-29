// SHARED FILE — the canonical copy lives in backend/src/shared/validation.
// The frontend copy is synced by `npm run sync:shared` (frontend) and checked by a test.
//
// Standard field rules from 16_UX_UI_AND_VALIDATION.md §5.3. Messages are error CODES,
// translated by the UI (`validation.<code>`); params go in the issue `params`.
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { z } from 'zod';
import { collapseSpaces, stripControlChars, toWesternDigits } from './normalize';

type Opts = { min?: number; max?: number };

const str = (v: unknown) => (typeof v === 'string' ? v : v);
const trimmed = (v: unknown) => (typeof v === 'string' ? stripControlChars(v).trim() : str(v));
const collapsed = (v: unknown) => (typeof v === 'string' ? collapseSpaces(stripControlChars(v)) : v);
const digits = (v: unknown) => (typeof v === 'string' ? toWesternDigits(v).trim() : v);

/** Empty strings from forms count as "not provided" for optional fields. */
export function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
}

/** Like optional(), but `null` is kept so PATCH can clear a value. */
export function nullable<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
}

function lengthRule(s: z.ZodString, min: number, max: number) {
  return s
    .min(1, { message: 'required' })
    .min(min, { message: 'too_short' })
    .max(max, { message: 'too_long' });
}

const PERSON_NAME_CHARS = /^[\p{Script=Arabic}\p{Script=Latin}\s'\-.]+$/u;
const NO_DIGITS = /^[^0-9]*$/;

/** One part of a person's name (first, father, grandfather, family). */
export function personName(opts: Opts = {}) {
  return z.preprocess(
    collapsed,
    lengthRule(z.string({ required_error: 'required' }), opts.min ?? 2, opts.max ?? 60)
      .regex(NO_DIGITS, { message: 'invalid_chars' })
      .regex(PERSON_NAME_CHARS, { message: 'invalid_chars' }),
  );
}

/** Clinic, item, procedure, role… names: one input, any language, digits allowed. */
export function entityName(opts: Opts = {}) {
  return z.preprocess(
    collapsed,
    lengthRule(z.string({ required_error: 'required' }), opts.min ?? 2, opts.max ?? 120).regex(
      /^[^<>{}\\]*$/,
      { message: 'invalid_chars' },
    ),
  );
}

/** Free text (notes, descriptions). */
export function freeText(max = 2000) {
  return z.preprocess(trimmed, z.string().max(max, { message: 'too_long' }));
}

export function requiredText(max = 2000) {
  return z.preprocess(
    trimmed,
    z.string({ required_error: 'required' }).min(1, { message: 'required' }).max(max, { message: 'too_long' }),
  );
}

export const email = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z
      .string({ required_error: 'required' })
      .min(1, { message: 'required' })
      .max(254, { message: 'too_long' })
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, { message: 'invalid_email' }),
  );

const JO_MOBILE = /^\+9627[789]\d{7}$/;

export function normalizePhone(raw: string, defaultCountry: CountryCode = 'JO'): string | null {
  const cleaned = toWesternDigits(raw).replace(/[\s\-().]/g, '');
  const withPlus = cleaned.startsWith('00') ? `+${cleaned.slice(2)}` : cleaned;
  const parsed = parsePhoneNumberFromString(withPlus, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export function isMobile(e164: string): boolean {
  if (e164.startsWith('+962')) return JO_MOBILE.test(e164);
  const parsed = parsePhoneNumberFromString(e164);
  const type = parsed?.getType();
  return type === undefined || type === 'MOBILE' || type === 'FIXED_LINE_OR_MOBILE';
}

/** Any phone; output is E.164 (`+962791234567`). `mobile` enforces a mobile number (WhatsApp/OTP). */
export function phone(opts: { mobile?: boolean; defaultCountry?: CountryCode } = {}) {
  return z
    .string({ required_error: 'required' })
    .min(1, { message: 'required' })
    .transform((v, ctx) => {
      const e164 = normalizePhone(v, opts.defaultCountry ?? 'JO');
      if (!e164) {
        ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
        return z.NEVER;
      }
      if (opts.mobile && !isMobile(e164)) {
        ctx.addIssue({ code: 'custom', message: 'not_mobile' });
        return z.NEVER;
      }
      return e164;
    });
}

const COMMON_PASSWORDS = new Set([
  'password123', 'password1234', '1234567890', 'qwertyuiop', 'password12', 'iloveyou12',
  'admin12345', 'welcome123', 'qwerty1234', 'abc1234567', '123456789a', 'a123456789',
  'password!1', 'passw0rd12', 'letmein123', '1q2w3e4r5t', 'zaq12wsxcde',
]);

/** ≥ 10 chars, at least one letter and one digit, not a common password. */
export function password() {
  return z
    .string({ required_error: 'required' })
    .min(1, { message: 'required' })
    .max(128, { message: 'too_long' })
    .superRefine((v, ctx) => {
      const weak =
        v.length < 10 ||
        !/\p{L}/u.test(v) ||
        !/\d/.test(v) ||
        COMMON_PASSWORDS.has(v.toLowerCase());
      if (weak) ctx.addIssue({ code: 'custom', message: 'weak_password' });
    });
}

export const otpCode = () =>
  z.preprocess(digits, z.string({ required_error: 'required' }).regex(/^\d{6}$/, { message: 'invalid_code' }));

/** Jordanian national number: 10 digits. Other nationalities use `passportNo`. */
export const nationalId = () =>
  z.preprocess(digits, z.string().regex(/^\d{10}$/, { message: 'invalid_national_id' }));

export const passportNo = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? toWesternDigits(v).trim().toUpperCase() : v),
    z.string().regex(/^[A-Z0-9]{5,20}$/, { message: 'invalid_national_id' }),
  );

/** Clinic-local calendar date `YYYY-MM-DD`. */
export const dateOnly = () =>
  z.preprocess(
    digits,
    z
      .string({ required_error: 'required' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' })
      .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
        message: 'invalid_date',
      }),
  );

export function ageOn(dob: string, today: Date = new Date()): number {
  const d = new Date(`${dob}T00:00:00Z`);
  let age = today.getUTCFullYear() - d.getUTCFullYear();
  const m = today.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

export const dateOfBirth = () =>
  dateOnly().superRefine((v, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    if (v > today) ctx.addIssue({ code: 'custom', message: 'date_in_future' });
    else if (ageOn(v) > 120) ctx.addIssue({ code: 'custom', message: 'invalid_date' });
  });

/** ISO-8601 instant (UTC). */
export const instant = () =>
  z.preprocess(
    (v) => (typeof v === 'string' || v instanceof Date ? new Date(v as string) : v),
    z.date({ required_error: 'required', invalid_type_error: 'invalid_date' }).refine((d) => !Number.isNaN(d.getTime()), {
      message: 'invalid_date',
    }),
  );

export const timeOfDay = () =>
  z.preprocess(digits, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'invalid_time' }));

export const MONEY_MAX_MINOR = 1_000_000_000; // 1,000,000 JOD in fils

/** Money in integer minor units (03_DATA_MODEL.md §1). */
export function money(opts: { positive?: boolean; max?: number } = {}) {
  return z
    .number({ required_error: 'required', invalid_type_error: 'invalid_amount' })
    .int({ message: 'too_many_decimals' })
    .min(opts.positive ? 1 : 0, { message: opts.positive ? 'must_be_positive' : 'invalid_amount' })
    .max(opts.max ?? MONEY_MAX_MINOR, { message: 'invalid_amount' });
}

/** Percentage 0–100 with up to 2 decimals. */
export const percent = () =>
  z
    .number({ required_error: 'required', invalid_type_error: 'out_of_range' })
    .min(0, { message: 'out_of_range' })
    .max(100, { message: 'out_of_range' })
    .refine((v) => Math.round(v * 100) === v * 100, { message: 'too_many_decimals' });

/** Rate in basis points (1600 = 16%). */
export const basisPoints = () =>
  z.number().int({ message: 'out_of_range' }).min(0, { message: 'out_of_range' }).max(10000, { message: 'out_of_range' });

export const quantity = () =>
  z
    .number({ required_error: 'required', invalid_type_error: 'invalid_quantity' })
    .int({ message: 'invalid_quantity' })
    .min(1, { message: 'invalid_quantity' })
    .max(999, { message: 'invalid_quantity' });

export const color = () => z.string().regex(/^#[0-9A-Fa-f]{6}$/, { message: 'invalid_color' });

export const slug = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.string({ required_error: 'required' }).regex(/^[a-z0-9-]{3,40}$/, { message: 'invalid_slug' }),
  );

export const taxNumber = () =>
  z.preprocess(digits, z.string().regex(/^\d{8,15}$/, { message: 'invalid_tax_number' }));

/** IBAN with mod-97 checksum; Jordanian IBANs must match JO\d{2}[A-Z]{4}\d{22}. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith('JO') && !/^JO\d{2}[A-Z]{4}\d{22}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const n = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

export const iban = () =>
  z.preprocess(
    (v) => (typeof v === 'string' ? toWesternDigits(v).replace(/\s+/g, '').toUpperCase() : v),
    z.string().refine(isValidIban, { message: 'invalid_iban' }),
  );

export const objectId = () => z.string().regex(/^[a-f0-9]{24}$/i, { message: 'invalid_id' });

export const PERMANENT_TEETH = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
] as const;
export const PRIMARY_TEETH = [
  55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75,
] as const;
const ALL_TEETH = new Set<number>([...PERMANENT_TEETH, ...PRIMARY_TEETH]);

export const isValidTooth = (n: number) => ALL_TEETH.has(n);
/** Incisors and canines (positions 1–3 in each quadrant). */
export const isAnterior = (n: number) => n % 10 >= 1 && n % 10 <= 3;

export const SURFACES = ['M', 'O', 'D', 'B', 'L', 'I', 'F', 'P'] as const;
export type Surface = (typeof SURFACES)[number];

/** O only on posterior teeth; I and F only on anterior teeth. */
export function isValidSurface(tooth: number, surface: Surface): boolean {
  if (surface === 'O') return !isAnterior(tooth);
  if (surface === 'I' || surface === 'F') return isAnterior(tooth);
  return true;
}

export const toothNumber = () =>
  z.number().int({ message: 'invalid_tooth' }).refine(isValidTooth, { message: 'invalid_tooth' });

export const surfaces = () => z.array(z.enum(SURFACES, { message: 'invalid_surface' })).max(5);

export const enumOf = <T extends [string, ...string[]]>(values: T) =>
  z.enum(values, { required_error: 'required', invalid_type_error: 'invalid_option', message: 'invalid_option' });

/** Cross-field: `to >= from` and at most `maxDays` long. */
export function dateRange(maxDays: number) {
  return z
    .object({ from: dateOnly(), to: dateOnly() })
    .superRefine((v, ctx) => {
      if (v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_invalid' });
      const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
      if (days > maxDays) {
        ctx.addIssue({ code: 'custom', path: ['to'], message: 'range_too_long', params: { max: maxDays } });
      }
    });
}
