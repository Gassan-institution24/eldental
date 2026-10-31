import { Box, Divider, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { EntryKind, ToothState } from '../api';
import { toothArt } from './odontogram/layers';
import { SurfaceWheel } from './odontogram/SurfaceWheel';
import { DEFAULT_VIEW, ToothArt, useArtwork, type ViewOptions } from './odontogram/ToothArt';
import {
  isPrimary,
  isUpper,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
  WISDOM_TEETH,
} from './odontogram/teeth';
import { useConditionColors } from './shared';

export {
  isAnterior,
  LOWER_PERMANENT,
  LOWER_PRIMARY,
  surfaceAt,
  UPPER_PERMANENT,
  UPPER_PRIMARY,
} from './odontogram/teeth';
export { DEFAULT_VIEW, type ViewOptions } from './odontogram/ToothArt';

const GAP = 3;

type Props = {
  teeth: Record<string, ToothState>;
  colors: Record<string, string>;
  layers: Set<EntryKind>;
  dentition: 'permanent' | 'primary' | 'mixed';
  view?: ViewOptions;
  selectedTooth?: number | null;
  selectedSurfaces?: string[];
  onTooth: (tooth: number) => void;
  onSurface?: (tooth: number, surface: string) => void;
};

/**
 * Odontogram (07 §2): anatomical teeth with a five-surface wheel each, in dental orientation
 * (the patient's right on the viewer's left) whatever the text direction.
 */
export function ToothChart({
  teeth,
  colors,
  layers,
  dentition,
  view = DEFAULT_VIEW,
  selectedTooth,
  selectedSurfaces = [],
  onTooth,
  onSurface,
}: Props) {
  const { t } = useTranslation('clinical');
  const theme = useTheme();
  const art = useArtwork();
  const upper: number[][] = [];
  const lower: number[][] = [];
  if (dentition !== 'primary') upper.push(UPPER_PERMANENT);
  if (dentition !== 'permanent') {
    upper.push(UPPER_PRIMARY);
    lower.push(LOWER_PRIMARY);
  }
  if (dentition !== 'primary') lower.push(LOWER_PERMANENT);

  if (!art) return <Skeleton variant="rounded" height={dentition === 'mixed' ? 520 : 300} />;

  const row = (list: number[]) => (
    <Stack
      key={list[0]}
      direction="row"
      justifyContent="center"
      alignItems={isUpper(list[0]!) ? 'flex-end' : 'flex-start'}
      sx={{ gap: `${GAP}px` }}
    >
      {list.map((n, i) => (
        <Stack key={n} direction="row" sx={{ gap: `${GAP}px`, alignSelf: 'stretch' }}>
          <Tile
            tooth={n}
            state={teeth[String(n)]}
            art={art}
            colors={colors}
            layers={layers}
            view={view}
            hidden={!view.wisdom && WISDOM_TEETH.has(n)}
            selected={selectedTooth === n}
            selectedSurfaces={selectedTooth === n ? selectedSurfaces : []}
            onTooth={onTooth}
            onSurface={onSurface}
          />
          {i === list.length / 2 - 1 && (
            <Box sx={{ width: 2, mx: 0.75, borderRadius: 1, bgcolor: 'divider' }} />
          )}
        </Stack>
      ))}
    </Stack>
  );

  return (
    <Box dir="ltr" sx={{ overflowX: 'auto', py: 1 }}>
      <Stack
        spacing={1.5}
        role="group"
        aria-label={t('chart.title')}
        sx={{
          width: 'max-content',
          mx: 'auto',
          p: { xs: 1, sm: 2 },
          borderRadius: 3,
          bgcolor:
            theme.palette.mode === 'dark' ? alpha(theme.palette.common.white, 0.02) : '#F3F6FB',
        }}
      >
        <Typography variant="caption" color="text.secondary" textAlign="center" fontWeight={650}>
          {t('chart.upperJaw')}
        </Typography>
        {upper.map(row)}
        <Divider />
        {lower.map(row)}
        <Typography variant="caption" color="text.secondary" textAlign="center" fontWeight={650}>
          {t('chart.lowerJaw')}
        </Typography>
      </Stack>
    </Box>
  );
}

type TileProps = {
  tooth: number;
  state?: ToothState;
  art: Record<string, string>;
  colors: Record<string, string>;
  layers: Set<EntryKind>;
  view: ViewOptions;
  hidden: boolean;
  selected: boolean;
  selectedSurfaces: string[];
  onTooth: (tooth: number) => void;
  onSurface?: (tooth: number, surface: string) => void;
};

const Tile = memo(function Tile({
  tooth,
  state,
  art,
  colors,
  layers,
  view,
  hidden,
  selected,
  selectedSurfaces,
  onTooth,
  onSurface,
}: TileProps) {
  const { t } = useTranslation('clinical');
  const theme = useTheme();
  const { name } = useConditionColors();
  const look = useMemo(() => toothArt(tooth, state, layers), [tooth, state, layers]);
  const conds = useMemo(
    () => (state?.conditions ?? []).filter((c) => layers.has(c.kind)),
    [state, layers],
  );
  const width = isPrimary(tooth) ? 38 : 44;
  const up = isUpper(tooth);
  const status = state?.status ?? 'present';

  const describe = [
    status !== 'present' ? t(`toothStatus.${status}`) : null,
    ...conds.map(
      (c) =>
        `${name(c.code)}${c.surfaces?.length ? ` (${c.surfaces.join('')})` : ''}${c.kind === 'planned' ? ` · ${t('kinds.planned')}` : ''}`,
    ),
  ].filter(Boolean);
  const label = t('chart.toothLabel', { n: tooth });

  const number = (
    <Typography
      variant="caption"
      sx={{
        fontWeight: selected ? 800 : 650,
        color: selected ? 'primary.main' : 'text.secondary',
        lineHeight: 1.6,
      }}
    >
      {tooth}
    </Typography>
  );
  const drawing = (
    <Box sx={{ position: 'relative' }}>
      <ToothArt
        tooth={tooth}
        art={art}
        layers={look.layers}
        view={view}
        width={width}
        opacity={look.opacity}
        pontic={look.pontic}
      />
      {look.badges.length > 0 && (
        <Stack spacing={0.25} sx={{ position: 'absolute', top: 2, insetInlineEnd: 0 }}>
          {look.badges.map((b) => (
            <Box
              key={b}
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: colors[b] ?? 'grey.500',
                border: 1,
                borderColor: 'background.paper',
              }}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
  const wheel = (
    <SurfaceWheel
      tooth={tooth}
      conditions={conds}
      colors={colors}
      size={Math.round(width * 0.8)}
      selected={selectedSurfaces}
      surfaceName={(s) => t(`surfaces.${s}`)}
      onSurface={(s) => {
        onTooth(tooth);
        onSurface?.(tooth, s);
      }}
    />
  );

  return (
    <Tooltip
      title={describe.length ? `${label}: ${describe.join(' · ')}` : label}
      placement={up ? 'top' : 'bottom'}
      arrow
      enterDelay={500}
      disableInteractive
    >
      <Box
        role="button"
        tabIndex={hidden ? -1 : 0}
        aria-label={describe.length ? `${label}: ${describe.join(', ')}` : label}
        aria-pressed={selected}
        onClick={() => onTooth(tooth)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onTooth(tooth);
          }
        }}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: up ? 'flex-end' : 'flex-start',
          gap: '3px',
          p: '3px',
          width,
          boxSizing: 'content-box',
          cursor: 'pointer',
          userSelect: 'none',
          borderRadius: '14px',
          border: 1,
          borderColor: selected ? 'primary.main' : 'divider',
          bgcolor: selected
            ? alpha(theme.palette.primary.main, 0.08)
            : theme.palette.mode === 'dark'
              ? alpha(theme.palette.common.white, 0.04)
              : alpha(theme.palette.common.white, 0.75),
          boxShadow: selected ? `0 0 0 2px ${alpha(theme.palette.primary.main, 0.35)}` : 'none',
          transition: 'border-color .12s ease, background-color .12s ease',
          visibility: hidden ? 'hidden' : 'visible',
          '&:hover': {
            borderColor: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.06),
          },
          '&:focus-visible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        }}
      >
        {up ? (
          <>
            {number}
            {drawing}
            {wheel}
          </>
        ) : (
          <>
            {wheel}
            {drawing}
            {number}
          </>
        )}
      </Box>
    </Tooltip>
  );
});
