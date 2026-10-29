import dayjs from 'dayjs';
import 'dayjs/locale/ar';
import 'dayjs/locale/en';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import isoWeek from 'dayjs/plugin/isoWeek';
import { env } from '@/config/env';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);
dayjs.extend(isoWeek);

let clinicTz = env.defaultTimezone;

/** All dates are shown in the clinic timezone (10_FRONTEND.md §6). */
export function setClinicTimezone(tz: string): void {
  clinicTz = tz;
}
export function getClinicTimezone(): string {
  return clinicTz;
}

export function inClinicTz(value: string | Date | number) {
  return dayjs(value).tz(clinicTz);
}

export function formatDate(value: string | Date, lang: string, fmt = 'LL'): string {
  return inClinicTz(value).locale(lang).format(fmt);
}

export function formatDateTime(value: string | Date, lang: string): string {
  return inClinicTz(value).locale(lang).format('lll');
}

export function formatTime(value: string | Date, lang: string): string {
  return inClinicTz(value).locale(lang).format('HH:mm');
}

/** Clinic-local "today" as YYYY-MM-DD. */
export function todayLocal(): string {
  return dayjs().tz(clinicTz).format('YYYY-MM-DD');
}

export { dayjs };
