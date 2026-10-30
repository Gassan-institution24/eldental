import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * System-seeded records show `name ?? t('seed.<group>.<systemKey>')` (03 §1.1): the UI language
 * until the clinic renames them, then exactly what the clinic typed.
 */
export function useSeedName(group: string) {
  const { t } = useTranslation('seed');
  return useCallback(
    (
      r: { name?: string | null; systemKey?: string | null; code?: string } | undefined | null,
    ): string => {
      if (!r) return '';
      if (r.name) return r.name;
      const key = r.systemKey ?? r.code;
      return key ? t(`${group}.${key}`, { defaultValue: key }) : '';
    },
    [t, group],
  );
}
