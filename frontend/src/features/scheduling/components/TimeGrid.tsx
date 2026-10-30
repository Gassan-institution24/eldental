import { Box, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { AlertTriangle, Siren } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTime, inClinicTz } from '@/lib/dates';
import type { Appointment, ScheduleException } from '../api';
import { localToIso } from './lookups';

export type GridColumn = {
  key: string;
  title: string;
  subtitle?: string;
  color?: string;
  date: string;
  dentistId?: string;
  chairId?: string;
  highlight?: boolean;
};

type Props = {
  columns: GridColumn[];
  appointments: Appointment[];
  exceptions: ScheduleException[];
  /** Visible hours in minutes after midnight. */
  startMin: number;
  endMin: number;
  stepMin?: number;
  colorOf: (a: Appointment) => string;
  typeLabel: (a: Appointment) => string;
  canEdit: (a: Appointment) => boolean;
  canCreate: boolean;
  onOpen: (a: Appointment) => void;
  onCreate: (col: GridColumn, startIso: string) => void;
  onMove: (a: Appointment, col: GridColumn, startIso: string) => void;
};

const PX_PER_MIN = 1.5;
const STATUS_BORDER: Record<string, string> = {
  scheduled: 'grey.500',
  confirmed: 'info.main',
  arrived: 'warning.main',
  in_chair: 'secondary.main',
  completed: 'success.main',
  cancelled: 'error.light',
  no_show: 'error.main',
};

const minuteOf = (iso: string) => {
  const d = inClinicTz(iso);
  return d.hour() * 60 + d.minute();
};
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Lays overlapping events side by side inside one column. */
function lanes(items: Appointment[]): Map<string, { lane: number; of: number }> {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const out = new Map<string, { lane: number; of: number }>();
  let group: Appointment[] = [];
  let groupEnd = '';
  const flush = () => {
    const ends: string[] = [];
    const placed: { id: string; lane: number }[] = [];
    for (const a of group) {
      let lane = ends.findIndex((e) => e <= a.start);
      if (lane === -1) lane = ends.length;
      ends[lane] = a.end;
      placed.push({ id: a.id, lane });
    }
    for (const p of placed) out.set(p.id, { lane: p.lane, of: ends.length });
    group = [];
  };
  for (const a of sorted) {
    if (group.length && a.start >= groupEnd) {
      flush();
      groupEnd = '';
    }
    group.push(a);
    if (a.end > groupEnd) groupEnd = a.end;
  }
  if (group.length) flush();
  return out;
}

/**
 * Time grid shared by the day view (columns = dentists or chairs) and the week view
 * (columns = days). Click an empty slot to book; drag an upcoming visit to move it.
 */
export function TimeGrid({
  columns,
  appointments,
  exceptions,
  startMin,
  endMin,
  stepMin = 15,
  colorOf,
  typeLabel,
  canEdit,
  canCreate,
  onOpen,
  onCreate,
  onMove,
}: Props) {
  const theme = useTheme();
  const { t, i18n } = useTranslation('scheduling');
  const height = (endMin - startMin) * PX_PER_MIN;
  const dragging = useRef<Appointment | null>(null);
  const [hover, setHover] = useState<{ col: string; min: number } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const nowLocal = inClinicTz(now);
  const today = nowLocal.format('YYYY-MM-DD');
  const nowMin = nowLocal.hour() * 60 + nowLocal.minute();

  const byColumn = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const c of columns) {
      m.set(
        c.key,
        appointments.filter(
          (a) =>
            inClinicTz(a.start).format('YYYY-MM-DD') === c.date &&
            (!c.dentistId || a.dentistId === c.dentistId) &&
            (!c.chairId || a.chairId === c.chairId),
        ),
      );
    }
    return m;
  }, [columns, appointments]);

  const blocked = (c: GridColumn) =>
    exceptions
      .filter(
        (e) =>
          e.type !== 'extra_hours' &&
          ((e.type === 'holiday' && !e.staffId) ||
            (c.dentistId && e.staffId === c.dentistId && e.type !== 'chair_maintenance') ||
            (c.chairId && e.chairId === c.chairId && e.type === 'chair_maintenance')),
      )
      .map((e) => {
        const dayStart = new Date(localToIso(c.date, '00:00')).getTime();
        const s = Math.max(0, (new Date(e.start).getTime() - dayStart) / 60_000);
        const en = Math.min(24 * 60, (new Date(e.end).getTime() - dayStart) / 60_000);
        return {
          id: e.id,
          from: Math.max(s, startMin),
          to: Math.min(en, endMin),
          reason: e.reason,
          type: e.type,
        };
      })
      .filter((b) => b.to > b.from);

  const minuteAt = (ev: { clientY: number; currentTarget: HTMLElement }) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    const raw = startMin + (ev.clientY - rect.top) / PX_PER_MIN;
    return Math.max(startMin, Math.min(endMin - stepMin, Math.floor(raw / stepMin) * stepMin));
  };

  const hours: number[] = [];
  for (let m = Math.ceil(startMin / 60) * 60; m < endMin; m += 60) hours.push(m);

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        overflow: 'auto',
        bgcolor: 'background.paper',
        maxHeight: 'calc(100vh - 230px)',
      }}
    >
      <Box sx={{ display: 'flex', minWidth: 72 + columns.length * 150 }}>
        {/* time gutter */}
        <Box
          sx={{
            width: 64,
            flexShrink: 0,
            position: 'sticky',
            insetInlineStart: 0,
            zIndex: 3,
            bgcolor: 'background.paper',
            borderInlineEnd: 1,
            borderColor: 'divider',
          }}
        >
          <Box
            sx={{
              height: 56,
              position: 'sticky',
              top: 0,
              bgcolor: 'background.paper',
              zIndex: 4,
              borderBottom: 1,
              borderColor: 'divider',
            }}
          />
          <Box sx={{ position: 'relative', height }}>
            {hours.map((m) => (
              <Typography
                key={m}
                variant="caption"
                color="text.secondary"
                dir="ltr"
                sx={{
                  position: 'absolute',
                  top: (m - startMin) * PX_PER_MIN - 8,
                  insetInlineEnd: 8,
                }}
              >
                {hhmm(m)}
              </Typography>
            ))}
          </Box>
        </Box>

        {columns.map((c) => {
          const items = byColumn.get(c.key) ?? [];
          const lay = lanes(items.filter((a) => a.status !== 'cancelled'));
          return (
            <Box
              key={c.key}
              sx={{ flex: 1, minWidth: 150, borderInlineEnd: 1, borderColor: 'divider' }}
            >
              <Stack
                justifyContent="center"
                sx={{
                  height: 56,
                  px: 2,
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  bgcolor: c.highlight
                    ? alpha(theme.palette.primary.main, 0.08)
                    : 'background.paper',
                  borderBottom: 1,
                  borderColor: 'divider',
                  borderTop: c.color ? `3px solid ${c.color}` : undefined,
                }}
              >
                <Typography variant="subtitle2" noWrap dir="auto">
                  {c.title}
                </Typography>
                {c.subtitle && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {c.subtitle}
                  </Typography>
                )}
              </Stack>
              <Box
                role="grid"
                aria-label={c.title}
                sx={{
                  position: 'relative',
                  height,
                  cursor: canCreate ? 'copy' : 'default',
                  backgroundImage: `repeating-linear-gradient(to bottom, ${theme.palette.divider} 0, ${theme.palette.divider} 1px, transparent 1px, transparent ${60 * PX_PER_MIN}px), repeating-linear-gradient(to bottom, ${alpha(theme.palette.divider, 0.45)} 0, ${alpha(theme.palette.divider, 0.45)} 1px, transparent 1px, transparent ${stepMin * PX_PER_MIN}px)`,
                  backgroundPositionY: `${((60 - (startMin % 60)) % 60) * PX_PER_MIN}px, 0`,
                }}
                onMouseMove={(e) => canCreate && setHover({ col: c.key, min: minuteAt(e) })}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => {
                  if (!canCreate || e.target !== e.currentTarget) return;
                  onCreate(c, localToIso(c.date, hhmm(minuteAt(e))));
                }}
                onDragOver={(e: DragEvent<HTMLDivElement>) => {
                  if (!dragging.current) return;
                  e.preventDefault();
                  setHover({ col: c.key, min: minuteAt(e) });
                }}
                onDrop={(e: DragEvent<HTMLDivElement>) => {
                  e.preventDefault();
                  const a = dragging.current;
                  dragging.current = null;
                  setHover(null);
                  if (a) onMove(a, c, localToIso(c.date, hhmm(minuteAt(e))));
                }}
              >
                {blocked(c).map((b) => (
                  <Tooltip key={b.id} title={b.reason || t(`exceptions.types.${b.type}`)}>
                    <Box
                      sx={{
                        position: 'absolute',
                        insetInline: 0,
                        top: (b.from - startMin) * PX_PER_MIN,
                        height: (b.to - b.from) * PX_PER_MIN,
                        pointerEvents: 'none',
                        backgroundImage: `repeating-linear-gradient(45deg, ${alpha(theme.palette.text.primary, 0.06)} 0 8px, transparent 8px 16px)`,
                        bgcolor: alpha(theme.palette.text.primary, 0.03),
                      }}
                    />
                  </Tooltip>
                ))}

                {hover?.col === c.key && (
                  <Box
                    sx={{
                      position: 'absolute',
                      insetInline: 4,
                      top: (hover.min - startMin) * PX_PER_MIN,
                      height: stepMin * PX_PER_MIN,
                      borderRadius: 1,
                      bgcolor: alpha(theme.palette.primary.main, 0.12),
                      pointerEvents: 'none',
                    }}
                  >
                    <Typography
                      variant="caption"
                      dir="ltr"
                      sx={{ px: 1, color: 'primary.main', fontWeight: 600 }}
                    >
                      {hhmm(hover.min)}
                    </Typography>
                  </Box>
                )}

                {c.date === today && nowMin >= startMin && nowMin <= endMin && (
                  <Box
                    sx={{
                      position: 'absolute',
                      insetInline: 0,
                      top: (nowMin - startMin) * PX_PER_MIN,
                      height: 2,
                      bgcolor: 'error.main',
                      zIndex: 2,
                      pointerEvents: 'none',
                    }}
                  />
                )}

                {items.map((a) => {
                  const s = Math.max(minuteOf(a.start), startMin);
                  const e = Math.min(minuteOf(a.end) || 24 * 60, endMin);
                  if (e <= s) return null;
                  const pos = lay.get(a.id) ?? { lane: 0, of: 1 };
                  const color = colorOf(a);
                  const faded = a.status === 'cancelled' || a.status === 'no_show';
                  const editable = canEdit(a);
                  const short = (e - s) * PX_PER_MIN < 44;
                  return (
                    <Box
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      draggable={editable}
                      onDragStart={(ev: DragEvent<HTMLDivElement>) => {
                        dragging.current = a;
                        ev.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        dragging.current = null;
                        setHover(null);
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onOpen(a);
                      }}
                      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onOpen(a)}
                      aria-label={`${a.patient?.fullName ?? ''} ${formatTime(a.start, i18n.language)}`}
                      sx={{
                        position: 'absolute',
                        top: (s - startMin) * PX_PER_MIN + 1,
                        height: (e - s) * PX_PER_MIN - 2,
                        insetInlineStart: `calc(${(pos.lane / pos.of) * 100}% + 3px)`,
                        width: `calc(${100 / pos.of}% - 6px)`,
                        borderRadius: 1.5,
                        px: 1.5,
                        py: short ? 0 : 0.75,
                        overflow: 'hidden',
                        cursor: editable ? 'grab' : 'pointer',
                        bgcolor: alpha(color, theme.palette.mode === 'dark' ? 0.32 : 0.16),
                        borderInlineStart: `4px solid ${color}`,
                        outline: 1,
                        outlineColor: STATUS_BORDER[a.status] ?? 'divider',
                        opacity: faded ? 0.45 : 1,
                        textDecoration: a.status === 'cancelled' ? 'line-through' : 'none',
                        zIndex: 1,
                        transition: 'box-shadow .15s',
                        '&:hover, &:focus-visible': {
                          boxShadow: 3,
                          zIndex: 3,
                          outline: 2,
                          outlineColor: 'primary.main',
                        },
                      }}
                    >
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {a.priority === 'emergency' && (
                          <Siren size={12} color={theme.palette.error.main} />
                        )}
                        {(a.patient?.medicalAlerts.length ?? 0) > 0 && (
                          <AlertTriangle size={12} color={theme.palette.error.main} />
                        )}
                        <Typography
                          variant="caption"
                          fontWeight={700}
                          noWrap
                          dir="auto"
                          sx={{ lineHeight: 1.3 }}
                        >
                          {a.patient?.fullName ?? t('hiddenPatient')}
                        </Typography>
                      </Stack>
                      {!short && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          component="div"
                          sx={{ lineHeight: 1.3 }}
                        >
                          <span dir="ltr">{`${formatTime(a.start, 'en')}–${formatTime(a.end, 'en')}`}</span>{' '}
                          ·{' '}
                          {typeLabel(a) ||
                            t(`status.${a.displayStatus}`, { defaultValue: a.displayStatus })}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
