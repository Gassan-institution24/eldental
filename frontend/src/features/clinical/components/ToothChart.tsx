import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import type { EntryKind, ToothState } from '../api';

export const UPPER_PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_PERMANENT = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const UPPER_PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
export const LOWER_PRIMARY = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

export const isAnterior = (n: number) => n % 10 >= 1 && n % 10 <= 3;
const quadrant = (n: number) => ((Math.floor(n / 10) - 1) % 4) + 1;

type Pos = 'top' | 'bottom' | 'left' | 'right' | 'center';

/**
 * Which surface sits where on screen. Dental convention: the patient's right is on the
 * viewer's left, so mesial (toward the midline) is on the right for quadrants 1 and 4.
 */
export function surfaceAt(tooth: number, pos: Pos): string {
  const q = quadrant(tooth);
  const upper = q === 1 || q === 2;
  const ant = isAnterior(tooth);
  const facial = ant ? 'F' : 'B';
  switch (pos) {
    case 'center':
      return ant ? 'I' : 'O';
    case 'top':
      return upper ? facial : 'L';
    case 'bottom':
      return upper ? 'P' : facial;
    case 'left':
      return q === 1 || q === 4 ? 'D' : 'M';
    case 'right':
      return q === 1 || q === 4 ? 'M' : 'D';
  }
}

const SIZE = 40;
const GAP = 6;
const INNER = 16;

type Props = {
  teeth: Record<string, ToothState>;
  colors: Record<string, string>;
  layers: Set<EntryKind>;
  dentition: 'permanent' | 'primary' | 'mixed';
  selectedTooth?: number | null;
  selectedSurfaces?: string[];
  onTooth: (tooth: number) => void;
  onSurface?: (tooth: number, surface: string) => void;
};

export function ToothChart({
  teeth,
  colors,
  layers,
  dentition,
  selectedTooth,
  selectedSurfaces = [],
  onTooth,
  onSurface,
}: Props) {
  const theme = useTheme();
  const { t } = useTranslation('clinical');
  const rows: { teeth: number[]; upper: boolean }[] = [];
  if (dentition !== 'primary') rows.push({ teeth: UPPER_PERMANENT, upper: true });
  if (dentition !== 'permanent')
    rows.push({ teeth: UPPER_PRIMARY, upper: true }, { teeth: LOWER_PRIMARY, upper: false });
  if (dentition !== 'primary') rows.push({ teeth: LOWER_PERMANENT, upper: false });

  const widest = 16 * (SIZE + GAP);
  const rowH = SIZE + 34;
  const height = rows.length * rowH + 24;
  const stroke = theme.palette.divider;
  const base = theme.palette.background.paper;
  const text = theme.palette.text.secondary;

  const visible = (state?: ToothState) =>
    (state?.conditions ?? []).filter((c) => layers.has(c.kind));

  const tooth = (n: number, x: number, y: number, upper: boolean) => {
    const state = teeth[String(n)];
    const conds = visible(state);
    const missing = state?.status === 'missing';
    const implant = state?.status === 'implant';
    const selected = selectedTooth === n;
    const surfaceFill = (s: string) => {
      if (selected && selectedSurfaces.includes(s)) return alpha(theme.palette.primary.main, 0.55);
      const hit = [...conds].reverse().find((c) => (c.surfaces ?? []).includes(s));
      if (!hit) return base;
      const col = colors[hit.code] ?? theme.palette.grey[500];
      return hit.kind === 'planned' ? alpha(col, 0.35) : col;
    };
    const whole = conds.filter(
      (c) => !(c.surfaces ?? []).length && c.code !== 'missing' && c.code !== 'implant',
    );
    const wholeColor = whole.length
      ? (colors[whole[whole.length - 1]!.code] ?? theme.palette.grey[500])
      : null;
    const wholePlanned = whole.length > 0 && whole.every((c) => c.kind === 'planned');
    const s = SIZE;
    const i0 = (s - INNER) / 2;
    const i1 = i0 + INNER;
    const poly = (pts: number[][]) => pts.map((p) => `${x + p[0]!},${y + p[1]!}`).join(' ');
    const parts: { pos: Pos; points: string }[] = [
      {
        pos: 'top',
        points: poly([
          [0, 0],
          [s, 0],
          [i1, i0],
          [i0, i0],
        ]),
      },
      {
        pos: 'right',
        points: poly([
          [s, 0],
          [s, s],
          [i1, i1],
          [i1, i0],
        ]),
      },
      {
        pos: 'bottom',
        points: poly([
          [s, s],
          [0, s],
          [i0, i1],
          [i1, i1],
        ]),
      },
      {
        pos: 'left',
        points: poly([
          [0, s],
          [0, 0],
          [i0, i0],
          [i0, i1],
        ]),
      },
    ];
    const labelY = upper ? y - 8 : y + s + 16;
    return (
      <g
        key={n}
        role="button"
        tabIndex={0}
        aria-label={t('chart.toothLabel', { n })}
        aria-pressed={selected}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onTooth(n)}
        style={{ cursor: 'pointer', outline: 'none' }}
        opacity={missing && layers.has('existing') ? 0.35 : 1}
      >
        <text
          x={x + s / 2}
          y={labelY}
          textAnchor="middle"
          fontSize={11}
          fontWeight={selected ? 800 : 600}
          fill={selected ? theme.palette.primary.main : text}
        >
          {n}
        </text>
        {selected && (
          <rect
            x={x - 3}
            y={y - 3}
            width={s + 6}
            height={s + 6}
            rx={7}
            fill="none"
            stroke={theme.palette.primary.main}
            strokeWidth={2}
          />
        )}
        {parts.map((p) => {
          const surf = surfaceAt(n, p.pos);
          return (
            <polygon
              key={p.pos}
              points={p.points}
              fill={surfaceFill(surf)}
              stroke={stroke}
              strokeWidth={1}
              onClick={(e) => {
                e.stopPropagation();
                onTooth(n);
                onSurface?.(n, surf);
              }}
            >
              <title>{surf}</title>
            </polygon>
          );
        })}
        <rect
          x={x + i0}
          y={y + i0}
          width={INNER}
          height={INNER}
          fill={surfaceFill(surfaceAt(n, 'center'))}
          stroke={stroke}
          onClick={(e) => {
            e.stopPropagation();
            onTooth(n);
            onSurface?.(n, surfaceAt(n, 'center'));
          }}
        >
          <title>{surfaceAt(n, 'center')}</title>
        </rect>
        {wholeColor && (
          <rect
            x={x + 1.5}
            y={y + 1.5}
            width={s - 3}
            height={s - 3}
            rx={4}
            fill="none"
            stroke={wholeColor}
            strokeWidth={3.5}
            strokeDasharray={wholePlanned ? '5 3' : undefined}
            pointerEvents="none"
          />
        )}
        {missing && (
          <g stroke={theme.palette.text.primary} strokeWidth={2.5} pointerEvents="none">
            <line x1={x + 4} y1={y + 4} x2={x + s - 4} y2={y + s - 4} />
            <line x1={x + s - 4} y1={y + 4} x2={x + 4} y2={y + s - 4} />
          </g>
        )}
        {implant && (
          <g
            pointerEvents="none"
            stroke={colors.implant ?? theme.palette.info.main}
            strokeWidth={2.5}
          >
            <line x1={x + s / 2} y1={y + 6} x2={x + s / 2} y2={y + s - 6} />
            <line x1={x + s / 2 - 7} y1={y + 13} x2={x + s / 2 + 7} y2={y + 13} />
            <line x1={x + s / 2 - 6} y1={y + 20} x2={x + s / 2 + 6} y2={y + 20} />
            <line x1={x + s / 2 - 5} y1={y + 27} x2={x + s / 2 + 5} y2={y + 27} />
          </g>
        )}
        {/* whole-tooth click area under the number */}
        <rect
          x={x}
          y={upper ? y - 22 : y + s}
          width={s}
          height={20}
          fill="transparent"
          onClick={() => onTooth(n)}
        />
      </g>
    );
  };

  return (
    <Box dir="ltr" sx={{ overflowX: 'auto', py: 1 }}>
      <svg
        viewBox={`-8 0 ${widest + 16} ${height}`}
        width="100%"
        style={{ minWidth: 640, maxWidth: 980, display: 'block', margin: '0 auto' }}
        role="group"
        aria-label={t('chart.title')}
      >
        <line
          x1={widest / 2 - GAP / 2}
          y1={8}
          x2={widest / 2 - GAP / 2}
          y2={height - 8}
          stroke={stroke}
          strokeDasharray="4 4"
        />
        {rows.map((row, ri) => {
          const offset = ((16 - row.teeth.length) * (SIZE + GAP)) / 2;
          const y = 26 + ri * rowH;
          return (
            <g key={ri}>
              {row.teeth.map((n, i) => tooth(n, offset + i * (SIZE + GAP), y, row.upper))}
            </g>
          );
        })}
        <line
          x1={0}
          y1={26 + (rows.length / 2) * rowH - 12}
          x2={widest}
          y2={26 + (rows.length / 2) * rowH - 12}
          stroke={stroke}
        />
      </svg>
    </Box>
  );
}
