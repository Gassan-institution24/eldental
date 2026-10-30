import { useTranslation } from 'react-i18next';

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
