import { addDays, atLocalMinutes, eachDate, localDate, minutesOf, weekdayOf } from '@/shared/dates';

/**
 * Availability engine (06 §2). Pure: the service gathers data, this computes free slots.
 * All intervals are UTC instants in milliseconds; days are walked in the clinic timezone.
 */

export type Interval = { start: number; end: number };

export type ScheduleBlock = { start: string; end: string; chairId?: string; appointmentTypeIds?: string[]; onlineBookable?: boolean };
export type WeeklySchedule = {
  dentistId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  slotGranularityMin: number;
  weekly: { weekday: number; blocks: ScheduleBlock[] }[];
};

export type Exception = {
  type: 'time_off' | 'extra_hours' | 'holiday' | 'chair_maintenance';
  start: number;
  end: number;
  dentistId?: string;
  chairId?: string;
};

export type Busy = { start: number; end: number; dentistId?: string; chairId?: string; bufferAfterMin?: number };

export type EngineInput = {
  timezone: string;
  from: string;
  to: string;
  durationMin: number;
  appointmentTypeId?: string;
  /** Required chair (if the caller picked one); otherwise the block's chair is used when set. */
  chairId?: string;
  clinicHours: { weekday: number; open: string; close: string; closed: boolean }[];
  dentists: { id: string; bookableOnline: boolean; schedules: WeeklySchedule[] }[];
  exceptions: Exception[];
  busy: Busy[];
  now: number;
  online?: { minLeadHours: number; maxDaysAhead: number; typeAllowsOnline: boolean };
};

export type Slot = { start: string; end: string; dentistId: string; chairId?: string };
export type DaySlots = { date: string; slots: Slot[] };

const MIN = 60_000;

/** Subtracts `cut` intervals from `base` intervals. */
export function subtract(base: Interval[], cut: Interval[]): Interval[] {
  let out = base;
  for (const c of cut) {
    const next: Interval[] = [];
    for (const b of out) {
      if (c.end <= b.start || c.start >= b.end) {
        next.push(b);
        continue;
      }
      if (c.start > b.start) next.push({ start: b.start, end: c.start });
      if (c.end < b.end) next.push({ start: c.end, end: b.end });
    }
    out = next;
  }
  return out;
}

/** Merges overlapping or touching intervals. */
export function union(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start);
    const e = Math.min(x.end, y.end);
    if (s < e) out.push({ start: s, end: e });
  }
  return out;
}

function scheduleFor(schedules: WeeklySchedule[], date: string): WeeklySchedule | undefined {
  return schedules.find((s) => s.effectiveFrom <= date && (!s.effectiveTo || s.effectiveTo >= date));
}

/** Free slots for every dentist and day in [from, to] (inclusive), grouped by day. */
export function computeSlots(input: EngineInput): DaySlots[] {
  const tz = input.timezone;
  const dur = input.durationMin * MIN;
  const days = eachDate(input.from, input.to);
  const result: DaySlots[] = [];

  for (const date of days) {
    const wd = weekdayOf(date);
    const hours = input.clinicHours.find((h) => h.weekday === wd);
    const dayStart = atLocalMinutes(date, 0, tz).getTime();
    const dayEnd = atLocalMinutes(addDays(date, 1), 0, tz).getTime();
    const clinicHoliday = input.exceptions.some((e) => e.type === 'holiday' && !e.dentistId && e.start <= dayStart && e.end >= dayEnd);
    if (!hours || hours.closed || clinicHoliday) {
      result.push({ date, slots: [] });
      continue;
    }
    const clinicOpen: Interval = { start: atLocalMinutes(date, minutesOf(hours.open), tz).getTime(), end: atLocalMinutes(date, minutesOf(hours.close), tz).getTime() };
    const slots: Slot[] = [];

    for (const dentist of input.dentists) {
      if (input.online && !dentist.bookableOnline) continue;
      const sched = scheduleFor(dentist.schedules, date);
      if (!sched) continue;
      const step = Math.max(5, sched.slotGranularityMin || 15) * MIN;
      const blocks = (sched.weekly.find((w) => w.weekday === wd)?.blocks ?? []).filter(
        (b) =>
          (!input.appointmentTypeId || !b.appointmentTypeIds?.length || b.appointmentTypeIds.includes(input.appointmentTypeId)) &&
          (!input.online || b.onlineBookable) &&
          (!input.chairId || !b.chairId || b.chairId === input.chairId),
      );

      // Work blocks + extra hours, minus time off / holidays (dentist-specific or clinic-wide).
      const extra = input.exceptions.filter((e) => e.type === 'extra_hours' && e.dentistId === dentist.id).map((e) => ({ start: e.start, end: e.end, chairId: e.chairId }));
      const blockIntervals = [
        ...blocks.map((b) => ({ start: atLocalMinutes(date, minutesOf(b.start), tz).getTime(), end: atLocalMinutes(date, minutesOf(b.end), tz).getTime(), chairId: b.chairId })),
        ...extra.filter((e) => e.end > dayStart && e.start < dayEnd),
      ];
      const off = input.exceptions.filter((e) => (e.type === 'time_off' || e.type === 'holiday') && (!e.dentistId || e.dentistId === dentist.id));
      const dentistBusy = input.busy.filter((b) => b.dentistId === dentist.id).map((b) => ({ start: b.start, end: b.end + (b.bufferAfterMin ?? 0) * MIN }));

      for (const block of blockIntervals) {
        const chair = input.chairId ?? block.chairId;
        let free = intersect([{ start: block.start, end: block.end }], [clinicOpen]);
        free = subtract(free, off);
        free = subtract(free, dentistBusy);
        if (chair) {
          const chairBusy = input.busy.filter((b) => b.chairId === chair).map((b) => ({ start: b.start, end: b.end + (b.bufferAfterMin ?? 0) * MIN }));
          const maintenance = input.exceptions.filter((e) => e.type === 'chair_maintenance' && e.chairId === chair);
          free = subtract(free, [...chairBusy, ...maintenance]);
        }
        for (const f of free) {
          // Align to the grid of the block start so slots land on :00/:15/:30…
          const first = block.start + Math.ceil((f.start - block.start) / step) * step;
          for (let s = first; s + dur <= f.end; s += step) {
            if (s < input.now) continue;
            if (input.online) {
              if (s < input.now + input.online.minLeadHours * 3_600_000) continue;
              if (localDate(new Date(s), tz) > addDays(localDate(new Date(input.now), tz), input.online.maxDaysAhead)) continue;
            }
            slots.push({ start: new Date(s).toISOString(), end: new Date(s + dur).toISOString(), dentistId: dentist.id, ...(chair ? { chairId: chair } : {}) });
          }
        }
      }
    }
    if (input.online && !input.online.typeAllowsOnline) slots.length = 0;
    slots.sort((a, b) => a.start.localeCompare(b.start) || a.dentistId.localeCompare(b.dentistId));
    result.push({ date, slots: dedupe(slots) });
  }
  return result;
}

function dedupe(slots: Slot[]): Slot[] {
  const seen = new Set<string>();
  return slots.filter((s) => {
    const k = `${s.dentistId}|${s.start}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** True when [start, start+duration] is a slot the engine would offer (booking re-check). */
export function isWithinAvailability(input: EngineInput, start: Date, dentistId: string): boolean {
  const date = localDate(start, input.timezone);
  const days = computeSlots({ ...input, from: date, to: date, dentists: input.dentists.filter((d) => d.id === dentistId) });
  return days.some((d) => d.slots.some((s) => s.start === start.toISOString()));
}
