import { useTranslation } from 'react-i18next';
import { usePatientAppointments, type Appointment } from '@/features/scheduling/api';
import { usePermission } from '@/shared/rbac/usePermission';

export function ageOf(dob?: string): number | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

/** `condition:diabetes` → "Diabetes", `allergy:Penicillin` → "Penicillin" (as typed). */
export function useAlertLabel() {
  const { t } = useTranslation('patients');
  return (alert: string) => {
    const [kind, ...rest] = alert.split(':');
    const value = rest.join(':');
    if (kind === 'condition') return t(`medical.condition.${value}`, { defaultValue: value });
    return value;
  };
}

/** The patient's next scheduled/confirmed visit; not fetched without appointment access. */
export function useNextAppointment(patientId: string) {
  const { can } = usePermission();
  const allowed = can('scheduling.appointment.read');
  const q = usePatientAppointments(allowed ? patientId : undefined);
  const now = Date.now();
  const next = (q.data ?? [])
    .filter((a) => ['scheduled', 'confirmed'].includes(a.status) && Date.parse(a.start) >= now)
    .reduce<Appointment | null>((m, a) => (!m || a.start < m.start ? a : m), null);
  return { allowed, isLoading: allowed && q.isLoading, next };
}
