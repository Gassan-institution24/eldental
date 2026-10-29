import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { issueToField } from '@/core/validation/zodIssues';
import {
  dateOfBirth,
  dateRange,
  email,
  entityName,
  iban,
  isValidSurface,
  money,
  nationalId,
  otpCode,
  password,
  personName,
  phone,
  slug,
  toothNumber,
} from '../fields';
import { toSearchName, toWesternDigits } from '../normalize';

function codeOf(schema: z.ZodTypeAny, value: unknown): string | null {
  const r = schema.safeParse(value);
  if (r.success) return null;
  const first = r.error.issues[0];
  return first ? issueToField(first).code : 'unknown';
}

describe('normalisation', () => {
  it('converts Arabic-Indic and Persian digits', () => {
    expect(toWesternDigits('٠٧٩١٢٣٤٥٦٧٨')).toBe('07912345678');
    expect(toWesternDigits('۱۲۳')).toBe('123');
  });

  it('builds a search name that matches both spellings', () => {
    expect(toSearchName('أحمـــد')).toBe(toSearchName('احمد'));
    expect(toSearchName('فاطمة')).toBe('فاطمه');
    expect(toSearchName('  Ahmad   SAMI ')).toBe('ahmad sami');
    expect(toSearchName('مُحَمَّد')).toBe('محمد');
  });
});

describe('standard field rules', () => {
  it('person name', () => {
    expect(personName().parse('  أحمد   علي ')).toBe('أحمد علي');
    expect(codeOf(personName(), '')).toBe('required');
    expect(codeOf(personName(), 'A')).toBe('too_short');
    expect(codeOf(personName(), 'a'.repeat(61))).toBe('too_long');
    expect(codeOf(personName(), 'Ahmad2')).toBe('invalid_chars');
    expect(codeOf(personName(), undefined)).toBe('required');
    expect(personName().parse("O'Neil-Smith")).toBe("O'Neil-Smith");
  });

  it('entity name allows digits and up to 120 chars', () => {
    expect(entityName().parse('Smile Clinic 2')).toBe('Smile Clinic 2');
    expect(codeOf(entityName(), 'a'.repeat(121))).toBe('too_long');
    expect(codeOf(entityName(), '<script>')).toBe('invalid_chars');
  });

  it('phone → E.164 with Arabic digits', () => {
    expect(phone().parse('0791234567')).toBe('+962791234567');
    expect(phone().parse('٠٧٩١٢٣٤٥٦٧')).toBe('+962791234567');
    expect(phone().parse('00962 79 123 4567')).toBe('+962791234567');
    expect(codeOf(phone(), '123')).toBe('invalid_phone');
    expect(codeOf(phone({ mobile: true }), '064123456')).toBe('not_mobile');
    expect(codeOf(phone(), '')).toBe('required');
  });

  it('email', () => {
    expect(email().parse(' Owner@Smile.Local ')).toBe('owner@smile.local');
    expect(codeOf(email(), 'nope')).toBe('invalid_email');
  });

  it('password', () => {
    expect(password().parse('Password123!')).toBe('Password123!');
    expect(codeOf(password(), 'short1')).toBe('weak_password');
    expect(codeOf(password(), 'onlyletterslong')).toBe('weak_password');
    expect(codeOf(password(), 'password123')).toBe('weak_password');
  });

  it('otp', () => {
    expect(otpCode().parse('١٢٣٤٥٦')).toBe('123456');
    expect(codeOf(otpCode(), '12345')).toBe('invalid_code');
  });

  it('national id', () => {
    expect(nationalId().parse('9871234567')).toBe('9871234567');
    expect(codeOf(nationalId(), '12345')).toBe('invalid_national_id');
  });

  it('date of birth', () => {
    expect(codeOf(dateOfBirth(), '2999-01-01')).toBe('date_in_future');
    expect(codeOf(dateOfBirth(), '2020-02-30')).toBe('invalid_date');
    expect(codeOf(dateOfBirth(), '1800-01-01')).toBe('invalid_date');
    expect(dateOfBirth().parse('1990-05-01')).toBe('1990-05-01');
  });

  it('money is integer minor units', () => {
    expect(money().parse(1500)).toBe(1500);
    expect(codeOf(money(), 1.5)).toBe('too_many_decimals');
    expect(codeOf(money({ positive: true }), 0)).toBe('must_be_positive');
    expect(codeOf(money(), 2_000_000_000)).toBe('invalid_amount');
  });

  it('teeth and surfaces', () => {
    expect(toothNumber().parse(36)).toBe(36);
    expect(codeOf(toothNumber(), 19)).toBe('invalid_tooth');
    expect(isValidSurface(36, 'O')).toBe(true);
    expect(isValidSurface(11, 'O')).toBe(false);
    expect(isValidSurface(11, 'I')).toBe(true);
    expect(isValidSurface(46, 'I')).toBe(false);
  });

  it('iban and slug', () => {
    expect(iban().parse('JO94 CBJO 0010 0000 0000 0131 0003 02')).toBe('JO94CBJO0010000000000131000302');
    expect(codeOf(iban(), 'JO00CBJO0010000000000131000302')).toBe('invalid_iban');
    expect(slug().parse('Smile-Clinic')).toBe('smile-clinic');
    expect(codeOf(slug(), 'ab')).toBe('invalid_slug');
  });

  it('date range', () => {
    expect(codeOf(dateRange(42), { from: '2026-01-10', to: '2026-01-01' })).toBe('range_invalid');
    expect(codeOf(dateRange(42), { from: '2026-01-01', to: '2026-03-01' })).toBe('range_too_long');
  });
});
