import { useCallback, useMemo } from 'react';
import { appointmentTypesApi, chairsApi } from '@/features/clinic-settings/api';
import { dayjs, getClinicTimezone, inClinicTz } from '@/lib/dates';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { useSchedules } from '../api';

export type Dentist = { id: string; name: string; color: string; defaultChairId?: string };

/** Dentists (with schedules), chairs and appointment types used across scheduling screens. */
export function useSchedulingLookups() {
  const schedules = useSchedules();
  const chairs = chairsApi.useAll();
  const types = appointmentTypesApi.useAll();
  const typeName = useSeedName('appointmentType');

  const dentists = useMemo<Dentist[]>(
    () =>
      (schedules.data ?? []).map((s) => ({
        id: s.staff.id,
        name: s.staff.name,
        color: s.staff.color ?? '#4F46E5',
        defaultChairId: s.staff.defaultChairId,
      })),
    [schedules.data],
  );
  const activeChairs = useMemo(() => (chairs.data ?? []).filter((c) => c.isActive), [chairs.data]);
  const activeTypes = useMemo(() => (types.data ?? []).filter((t) => t.isActive), [types.data]);

  const dentistById = useMemo(() => new Map(dentists.map((d) => [d.id, d])), [dentists]);
  const chairById = useMemo(
    () => new Map((chairs.data ?? []).map((c) => [c.id, c])),
    [chairs.data],
  );
  const typeById = useMemo(() => new Map((types.data ?? []).map((t) => [t.id, t])), [types.data]);

  const typeLabel = useCallback(
    (id?: string) => (id ? typeName(typeById.get(id)) : ''),
    [typeById, typeName],
  );

  return {
    loading: schedules.isLoading || chairs.isLoading || types.isLoading,
    error: schedules.error ?? chairs.error ?? types.error,
    schedules: schedules.data ?? [],
    dentists,
    chairs: activeChairs,
    types: activeTypes,
    dentistById,
    chairById,
    typeById,
    typeLabel,
  };
}

/** Clinic-local `YYYY-MM-DD` + `HH:mm` → ISO instant. */
export function localToIso(date: string, time: string): string {
  return dayjs.tz(`${date} ${time}`, 'YYYY-MM-DD HH:mm', getClinicTimezone()).toISOString();
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}

export function localDateOf(iso: string): string {
  return inClinicTz(iso).format('YYYY-MM-DD');
}

export function addDaysLocal(date: string, n: number): string {
  return dayjs(date).add(n, 'day').format('YYYY-MM-DD');
}
