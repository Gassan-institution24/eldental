import { describe, expect, it } from 'vitest';
import { doctorWeights, shareOf, splitByDoctor, UNASSIGNED } from '../attribution';

const inv = { dentistId: 'H', lines: [{ dentistId: 'A', lineTotal: 50_000 }, { dentistId: 'B', lineTotal: 150_000 }] };

describe('doctor attribution (09 §8.1)', () => {
  it('splits by the value of each doctor\'s lines', () => {
    expect(Object.fromEntries(splitByDoctor(100_000, doctorWeights(inv)))).toEqual({ A: 25_000, B: 75_000 });
    expect(shareOf(100_000, inv, 'B')).toBe(75_000);
    expect(shareOf(100_000, inv, 'H')).toBe(0);
  });

  it('falls back to the header doctor, then to unassigned', () => {
    expect(Object.fromEntries(doctorWeights({ dentistId: 'H', lines: [{ lineTotal: 10 }, { dentistId: 'A', lineTotal: 30 }] }))).toEqual({ H: 10, A: 30 });
    expect([...doctorWeights({ lines: [{ lineTotal: 5 }] }).keys()]).toEqual([UNASSIGNED]);
  });

  it('rounds with the largest remainder so parts always add up, for refunds too', () => {
    const thirds = { lines: [{ dentistId: 'A', lineTotal: 1 }, { dentistId: 'B', lineTotal: 1 }, { dentistId: 'C', lineTotal: 1 }] };
    const parts = splitByDoctor(100, doctorWeights(thirds));
    expect([...parts.values()].reduce((a, b) => a + b, 0)).toBe(100);
    expect([...parts.values()].sort()).toEqual([33, 33, 34]);
    const refund = splitByDoctor(-100, doctorWeights(thirds));
    expect([...refund.values()].reduce((a, b) => a + b, 0)).toBe(-100);
    for (const amount of [1, 7, 999, 123_457]) {
      expect([...splitByDoctor(amount, doctorWeights(inv)).values()].reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });

  it('an invoice with no value yet still gets one bucket', () => {
    expect(Object.fromEntries(splitByDoctor(500, doctorWeights({ dentistId: 'H', lines: [] })))).toEqual({ H: 500 });
  });
});
