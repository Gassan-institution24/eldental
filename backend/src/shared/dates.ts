import dayjs, { type Dayjs } from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

export { dayjs };
export type { Dayjs };

/** Clinic-local calendar date (`YYYY-MM-DD`) for an instant. */
export function localDate(at: Date, tz: string): string {
  return dayjs(at).tz(tz).format('YYYY-MM-DD');
}

/** Clinic-local `HH:mm` for an instant. */
export function localTime(at: Date, tz: string): string {
  return dayjs(at).tz(tz).format('HH:mm');
}

/** UTC instant for a clinic-local date + minutes after midnight (may exceed 1440). */
export function atLocalMinutes(date: string, minutes: number, tz: string): Date {
  return dayjs.tz(`${date} 00:00`, 'YYYY-MM-DD HH:mm', tz).add(minutes, 'minute').toDate();
}

/** UTC instant for a clinic-local date + `HH:mm`. */
export function atLocal(date: string, time: string, tz: string): Date {
  return atLocalMinutes(date, minutesOf(time), tz);
}

/** Start of a clinic-local day as a UTC instant. */
export function startOfLocalDay(date: string, tz: string): Date {
  return atLocalMinutes(date, 0, tz);
}

/** Weekday 0 (Sunday) – 6 (Saturday) of a calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive list of calendar dates between two dates. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
