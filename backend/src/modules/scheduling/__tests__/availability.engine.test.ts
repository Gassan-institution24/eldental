import { describe, expect, it } from 'vitest';
import { atLocal } from '@/shared/dates';
import { computeSlots, isWithinAvailability, subtract, union, type EngineInput } from '../availability.engine';

const TZ = 'Asia/Amman';
const ms = (date: string, time: string) => atLocal(date, time, TZ).getTime();
const hhmm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

// 2026-11-01 is a Sunday.
const SUN = '2026-11-01';
const MON = '2026-11-02';
const FRI = '2026-11-06';

const allWeek = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: '09:00', close: '17:00', closed: weekday === 5 }));

function base(over: Partial<EngineInput> = {}): EngineInput {
  return {
    timezone: TZ,
    from: SUN,
    to: SUN,
    durationMin: 30,
    clinicHours: allWeek,
    dentists: [
      {
        id: 'd1',
        bookableOnline: true,
        schedules: [{ dentistId: 'd1', effectiveFrom: '2026-01-01', slotGranularityMin: 30, weekly: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, blocks: [{ start: '09:00', end: '12:00', onlineBookable: true }] })) }],
      },
    ],
    exceptions: [],
    busy: [],
    now: ms('2026-10-31', '08:00'),
    ...over,
  };
}

const times = (input: EngineInput, date = SUN) => computeSlots(input).find((d) => d.date === date)!.slots.map((s) => hhmm(s.start));

describe('interval helpers', () => {
  it('subtract and union', () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 3, end: 5 }])).toEqual([{ start: 0, end: 3 }, { start: 5, end: 10 }]);
    expect(subtract([{ start: 0, end: 10 }], [{ start: -5, end: 20 }])).toEqual([]);
    expect(union([{ start: 5, end: 8 }, { start: 0, end: 5 }, { start: 9, end: 10 }])).toEqual([{ start: 0, end: 8 }, { start: 9, end: 10 }]);
  });
});

describe('computeSlots', () => {
  it('weekly blocks on the granularity grid', () => {
    expect(times(base())).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
  });

  it('respects duration (60 min needs the full window)', () => {
    expect(times(base({ durationMin: 60 }))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('closed days and clinic-wide holidays produce nothing', () => {
    expect(times(base({ from: FRI, to: FRI }), FRI)).toEqual([]);
    expect(times(base({ exceptions: [{ type: 'holiday', start: ms(SUN, '00:00'), end: ms(MON, '00:00') }] }))).toEqual([]);
  });

  it('time off removes a window; extra hours add one', () => {
    const off = base({ exceptions: [{ type: 'time_off', dentistId: 'd1', start: ms(SUN, '10:00'), end: ms(SUN, '11:00') }] });
    expect(times(off)).toEqual(['09:00', '09:30', '11:00', '11:30']);
    const extra = base({ exceptions: [{ type: 'extra_hours', dentistId: 'd1', start: ms(SUN, '14:00'), end: ms(SUN, '15:00') }] });
    expect(times(extra)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30']);
  });

  it('existing appointments block the dentist, including the buffer', () => {
    const input = base({ busy: [{ dentistId: 'd1', start: ms(SUN, '09:30'), end: ms(SUN, '10:00'), bufferAfterMin: 30 }] });
    expect(times(input)).toEqual(['09:00', '10:30', '11:00', '11:30']);
  });

  it('chair conflicts and chair maintenance', () => {
    const input = base({ chairId: 'c1', busy: [{ dentistId: 'other', chairId: 'c1', start: ms(SUN, '09:00'), end: ms(SUN, '10:00') }] });
    expect(times(input)).toEqual(['10:00', '10:30', '11:00', '11:30']);
    const maint = base({ chairId: 'c1', exceptions: [{ type: 'chair_maintenance', chairId: 'c1', start: ms(SUN, '11:00'), end: ms(SUN, '12:00') }] });
    expect(times(maint)).toEqual(['09:00', '09:30', '10:00', '10:30']);
  });

  it('appointment-type restrictions on blocks', () => {
    const input = base({ appointmentTypeId: 'ortho' });
    input.dentists[0]!.schedules[0]!.weekly[0]!.blocks = [{ start: '09:00', end: '10:00', appointmentTypeIds: ['cleaning'] }, { start: '10:00', end: '11:00' }];
    expect(times(input)).toEqual(['10:00', '10:30']);
  });

  it('never offers slots in the past', () => {
    expect(times(base({ now: ms(SUN, '10:15') }))).toEqual(['10:30', '11:00', '11:30']);
  });

  it('online rules: lead time, max days ahead, dentist and type flags', () => {
    const online = base({ now: ms(SUN, '08:00'), online: { minLeadHours: 2, maxDaysAhead: 30, typeAllowsOnline: true } });
    expect(times(online)).toEqual(['10:00', '10:30', '11:00', '11:30']);
    expect(times(base({ online: { minLeadHours: 0, maxDaysAhead: 30, typeAllowsOnline: false } }))).toEqual([]);
    const notBookable = base({ online: { minLeadHours: 0, maxDaysAhead: 30, typeAllowsOnline: true } });
    notBookable.dentists[0]!.bookableOnline = false;
    expect(times(notBookable)).toEqual([]);
    const far = base({ now: ms('2026-09-01', '08:00'), online: { minLeadHours: 0, maxDaysAhead: 30, typeAllowsOnline: true } });
    expect(times(far)).toEqual([]);
  });

  it('effective date ranges choose the right schedule', () => {
    const input = base();
    input.dentists[0]!.schedules = [
      { dentistId: 'd1', effectiveFrom: '2026-01-01', effectiveTo: '2026-10-31', slotGranularityMin: 30, weekly: [{ weekday: 0, blocks: [{ start: '09:00', end: '10:00' }] }] },
      { dentistId: 'd1', effectiveFrom: '2026-11-01', slotGranularityMin: 60, weekly: [{ weekday: 0, blocks: [{ start: '13:00', end: '15:00' }] }] },
    ];
    expect(times(input)).toEqual(['13:00', '14:00']);
  });

  it('midnight edges: a block ending at clinic close never spills to the next day', () => {
    const input = base({ clinicHours: allWeek.map((h) => ({ ...h, open: '20:00', close: '23:59' })) });
    input.dentists[0]!.schedules[0]!.weekly[0]!.blocks = [{ start: '22:30', end: '23:59' }];
    expect(times(input)).toEqual(['22:30', '23:00']);
  });

  it('"any dentist" returns slots labelled per dentist, sorted', () => {
    const input = base();
    input.dentists.push({ id: 'd2', bookableOnline: true, schedules: [{ dentistId: 'd2', effectiveFrom: '2026-01-01', slotGranularityMin: 30, weekly: [{ weekday: 0, blocks: [{ start: '11:00', end: '12:00' }] }] }] });
    const slots = computeSlots(input)[0]!.slots;
    expect(slots.filter((s) => s.dentistId === 'd2').map((s) => hhmm(s.start))).toEqual(['11:00', '11:30']);
    expect(slots.map((s) => s.start)).toEqual([...slots.map((s) => s.start)].sort());
  });

  it('multi-day ranges group by day', () => {
    const days = computeSlots(base({ from: SUN, to: MON }));
    expect(days.map((d) => d.date)).toEqual([SUN, MON]);
    expect(days[1]!.slots).toHaveLength(6);
  });

  it('isWithinAvailability re-checks one exact start (booking guard)', () => {
    expect(isWithinAvailability(base(), new Date(ms(SUN, '09:30')), 'd1')).toBe(true);
    expect(isWithinAvailability(base(), new Date(ms(SUN, '09:15')), 'd1')).toBe(false);
    expect(isWithinAvailability(base(), new Date(ms(SUN, '13:00')), 'd1')).toBe(false);
  });
});
