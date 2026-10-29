import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  format,
  mulFraction,
  mulRate,
  parseDecimal,
  sub,
  toDecimalString,
} from '../money';

describe('money', () => {
  it('adds and subtracts integers only', () => {
    expect(add(1500, 250, 1)).toBe(1751);
    expect(sub(1000, 1500)).toBe(-500);
    expect(() => add(1.5)).toThrow(RangeError);
  });

  it('applies basis-point rates with banker rounding', () => {
    expect(mulRate(10000, 1600)).toBe(1600); // 16% of 10.000
    expect(mulRate(1, 5000)).toBe(0); // 0.5 → 0 (even)
    expect(mulRate(3, 5000)).toBe(2); // 1.5 → 2 (even)
    expect(mulRate(5, 5000)).toBe(2); // 2.5 → 2 (even)
    expect(mulRate(-3, 5000)).toBe(-2);
  });

  it('pro-rates with mulFraction', () => {
    expect(mulFraction(500000, 15, 30)).toBe(250000);
    expect(mulFraction(1000, 1, 3)).toBe(333);
  });

  it.each([
    [100, [1, 1, 1], [34, 33, 33]],
    [1000, [1, 2, 3, 4], [100, 200, 300, 400]],
    [1, [1, 1], [1, 0]],
    [-100, [1, 1, 1], [-34, -33, -33]],
    [500, [0, 0], [500, 0]],
    [999, [3, 3, 3], [333, 333, 333]],
  ])('allocate(%i, %j) preserves the sum', (total, weights, expected) => {
    const parts = allocate(total, weights);
    expect(parts).toEqual(expected);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('parses decimals for the currency precision', () => {
    expect(parseDecimal('1.5', 'JOD')).toBe(1500);
    expect(parseDecimal('1,234.567', 'JOD')).toBe(1234567);
    expect(parseDecimal('1.2345', 'JOD')).toBeNull();
    expect(parseDecimal('abc', 'JOD')).toBeNull();
    expect(parseDecimal('10.25', 'USD')).toBe(1025);
  });

  it('formats minor units', () => {
    expect(toDecimalString(1500, 'JOD')).toBe('1.500');
    expect(toDecimalString(5, 'JOD')).toBe('0.005');
    expect(toDecimalString(-1500, 'JOD')).toBe('-1.500');
    expect(format(1500, 'JOD', 'en')).toContain('1.500');
  });
});
