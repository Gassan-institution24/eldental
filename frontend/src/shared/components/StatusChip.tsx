import { Chip, type ChipProps } from '@mui/material';
import { alpha, useTheme, type Theme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { STATUS_TONES, type StatusTone } from '@/theme/tokens';

function toneColors(theme: Theme, tone: StatusTone): { fg: string; bg: string; border: string } {
  const p = theme.palette;
  const map: Record<StatusTone, string> = {
    grey: p.grey[600],
    blue: p.info.main,
    amber: p.warning.main,
    purple: p.secondary.main,
    green: p.success.main,
    red: p.error.main,
    redOutline: p.error.main,
    teal: p.primary.main,
  };
  const base = map[tone];
  if (tone === 'redOutline') return { fg: base, bg: 'transparent', border: base };
  return {
    fg: theme.palette.mode === 'dark' ? alpha(base, 0.95) : base,
    bg: alpha(base, 0.14),
    border: 'transparent',
  };
}

type Props = Omit<ChipProps, 'color' | 'label'> & { status: string; label?: string };

/** One status chip with unified colours for every module (16_UX_UI_AND_VALIDATION.md §2). */
export function StatusChip({ status, label, size = 'small', sx, ...rest }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tone = STATUS_TONES[status] ?? 'grey';
  const c = toneColors(theme, tone);
  return (
    <Chip
      size={size}
      label={label ?? t(`status.${status}`, { defaultValue: status })}
      sx={{ color: c.fg, bgcolor: c.bg, border: `1px solid ${c.border}`, ...sx }}
      {...rest}
    />
  );
}
