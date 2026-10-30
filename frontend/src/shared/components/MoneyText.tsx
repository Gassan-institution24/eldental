import { Box, type BoxProps } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSessionData } from '@/features/auth/api/session';
import { format } from '@/shared/generated/money';

/** Clinic currency from the session (JOD by default). */
export function useCurrency(): string {
  return useSessionData()?.clinic?.currency ?? 'JOD';
}

export function useFormatMoney() {
  const { i18n } = useTranslation();
  const currency = useCurrency();
  return (minor: number | null | undefined, cur = currency) =>
    minor === null || minor === undefined ? '—' : format(minor, cur, i18n.resolvedLanguage ?? 'ar');
}

/** Money is shown from integer minor units; numbers render left-to-right inside RTL text. */
export function MoneyText({
  value,
  currency,
  ...rest
}: BoxProps & { value: number | null | undefined; currency?: string }) {
  const fmt = useFormatMoney();
  return (
    <Box
      component="span"
      dir="ltr"
      sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', ...rest.sx }}
      {...rest}
    >
      {fmt(value, currency)}
    </Box>
  );
}
