import { alpha, useTheme } from '@mui/material/styles';
import { memo } from 'react';
import type { ToothCondition } from '../../api';
import { surfaceAt, type WheelPos } from './teeth';

const C = 22;
const R_OUT = 20;
const R_IN = 8;

/** Point on the wheel; 0° = right, 90° = up. */
function pt(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return `${(C + r * Math.cos(a)).toFixed(2)},${(C - r * Math.sin(a)).toFixed(2)}`;
}
function sector(a1: number, a2: number) {
  return `M${pt(R_OUT, a1)} A${R_OUT},${R_OUT} 0 0 0 ${pt(R_OUT, a2)} L${pt(R_IN, a2)} A${R_IN},${R_IN} 0 0 1 ${pt(R_IN, a1)} Z`;
}
const ZONES: { pos: WheelPos; d: string }[] = [
  { pos: 'top', d: sector(45, 135) },
  { pos: 'left', d: sector(135, 225) },
  { pos: 'bottom', d: sector(225, 315) },
  { pos: 'right', d: sector(315, 405) },
  {
    pos: 'center',
    d: `M${C - R_IN},${C} a${R_IN},${R_IN} 0 1 0 ${2 * R_IN},0 a${R_IN},${R_IN} 0 1 0 ${-2 * R_IN},0 Z`,
  },
];

type Props = {
  tooth: number;
  conditions: ToothCondition[];
  colors: Record<string, string>;
  size: number;
  selected: string[];
  surfaceName: (code: string) => string;
  onSurface: (surface: string) => void;
};

/**
 * Five-zone surface wheel under each tooth. Each zone shows the latest visible condition on that surface;
 * planned work is a pale fill and a dashed ring, completed work a solid ring.
 */
function SurfaceWheelImpl({
  tooth,
  conditions,
  colors,
  size,
  selected,
  surfaceName,
  onSurface,
}: Props) {
  const theme = useTheme();
  const neutral = theme.palette.mode === 'dark' ? theme.palette.grey[800] : '#F4F2EC';
  const ring = theme.palette.mode === 'dark' ? theme.palette.grey[600] : '#B9BEC4';

  const fill = (s: string) => {
    if (selected.includes(s)) return alpha(theme.palette.primary.main, 0.6);
    const hit = [...conditions].reverse().find((c) => (c.surfaces ?? []).includes(s));
    if (!hit) return neutral;
    const col = colors[hit.code] ?? theme.palette.grey[500];
    return hit.kind === 'planned' ? alpha(col, 0.35) : col;
  };
  const planned = conditions.some((c) => c.kind === 'planned');
  const completed = !planned && conditions.some((c) => c.kind === 'completed');

  return (
    <svg width={size} height={size} viewBox="0 0 44 44" style={{ display: 'block', flexShrink: 0 }}>
      {ZONES.map((z) => {
        const s = surfaceAt(tooth, z.pos);
        return (
          <path
            key={z.pos}
            d={z.d}
            fill={fill(s)}
            stroke={ring}
            strokeWidth={1}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              onSurface(s);
            }}
          >
            <title>{surfaceName(s)}</title>
          </path>
        );
      })}
      {(planned || completed) && (
        <circle
          cx={C}
          cy={C}
          r={21.2}
          fill="none"
          stroke={planned ? theme.palette.info.main : theme.palette.success.main}
          strokeWidth={1.6}
          strokeDasharray={planned ? '4 2.5' : undefined}
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

export const SurfaceWheel = memo(SurfaceWheelImpl);
