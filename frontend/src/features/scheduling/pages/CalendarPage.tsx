import {
  Box,
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { dayjs, formatDate, todayLocal } from '@/lib/dates';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { useAppointments, useExceptions, useUpdateAppointment, type Appointment } from '../api';
import { addDaysLocal, minutesBetween, useSchedulingLookups } from '../components/lookups';
import { useAppointmentPanel, useQuickBook } from '../components/quickBookStore';
import { TimeGrid, type GridColumn } from '../components/TimeGrid';

type View = 'day' | 'week';
type By = 'dentist' | 'chair';

/** Calendar (06 §9): day view by dentist/chair columns, week view per dentist. */
export function CalendarPage() {
  const { t, i18n } = useTranslation('scheduling');
  const lang = i18n.language;
  const [sp, setSp] = useSearchParams();
  const { can, grant, session } = usePermission();
  const notify = useNotify();
  const lookups = useSchedulingLookups();
  const openQuickBook = useQuickBook((s) => s.open);
  const showAppointment = useAppointmentPanel((s) => s.show);
  const update = useUpdateAppointment();

  const ownOnly = !session?.isOwner && grant('scheduling.appointment.read')?.scope === 'own';
  const myId = session?.staff?.id;
  const date = sp.get('date') ?? todayLocal();
  const view = (sp.get('view') as View) || 'day';
  const by = (sp.get('by') as By) || 'dentist';
  const showCancelled = sp.get('cancelled') === '1';
  const weekDentist =
    sp.get('dentist') ?? (ownOnly ? myId : undefined) ?? lookups.dentists[0]?.id ?? '';

  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSp(next, { replace: true });
  };

  // Deep link from the patient timeline: ?appointment=<id>.
  const deepLink = sp.get('appointment');
  useEffect(() => {
    if (deepLink) showAppointment(deepLink);
  }, [deepLink, showAppointment]);

  const weekStart = dayjs(date).subtract(dayjs(date).day(), 'day').format('YYYY-MM-DD');
  const from = view === 'week' ? weekStart : date;
  const to = view === 'week' ? addDaysLocal(weekStart, 6) : date;
  const appts = useAppointments({
    from,
    to,
    includeCancelled: showCancelled,
    ...(view === 'week' && weekDentist ? { dentistId: weekDentist } : {}),
  });
  const exceptions = useExceptions({ from, to });

  // Visible hours: the earliest/latest schedule block (fallback 08:00–20:00).
  const [startMin, endMin] = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    for (const s of lookups.schedules) {
      for (const w of s.current?.weekly ?? []) {
        for (const b of w.blocks) {
          const [sh, sm] = b.start.split(':').map(Number);
          const [eh, em] = b.end.split(':').map(Number);
          lo = Math.min(lo, (sh ?? 0) * 60 + (sm ?? 0));
          hi = Math.max(hi, (eh ?? 0) * 60 + (em ?? 0));
        }
      }
    }
    for (const a of appts.data ?? []) {
      const s = dayjs(a.start).tz().hour() * 60;
      lo = Math.min(lo, s);
      hi = Math.max(hi, Math.min(24 * 60, s + 60 + minutesBetween(a.start, a.end)));
    }
    if (hi <= lo) return [8 * 60, 20 * 60];
    return [Math.floor(lo / 60) * 60, Math.min(24 * 60, Math.ceil(hi / 60) * 60)];
  }, [lookups.schedules, appts.data]);

  const columns = useMemo<GridColumn[]>(() => {
    if (view === 'week') {
      const d = lookups.dentistById.get(weekDentist);
      return Array.from({ length: 7 }, (_, i) => {
        const day = addDaysLocal(weekStart, i);
        return {
          key: day,
          date: day,
          title: formatDate(day, lang, 'ddd D'),
          subtitle: formatDate(day, lang, 'MMM'),
          dentistId: weekDentist,
          color: d?.color,
          highlight: day === todayLocal(),
        };
      });
    }
    if (by === 'chair')
      return lookups.chairs.map((c) => ({
        key: c.id,
        date,
        title: c.name,
        subtitle: c.roomName,
        chairId: c.id,
        color: c.color,
      }));
    return lookups.dentists
      .filter((d) => !ownOnly || d.id === myId)
      .map((d) => ({ key: d.id, date, title: d.name, dentistId: d.id, color: d.color }));
  }, [view, by, date, weekStart, weekDentist, lookups, lang, ownOnly, myId]);

  const canBook = can('scheduling.appointment.book');
  const canUpdate = can('scheduling.appointment.update');

  const move = async (a: Appointment, col: GridColumn, start: string) => {
    const dentistChanged = col.dentistId && col.dentistId !== a.dentistId;
    const chairChanged = col.chairId && col.chairId !== a.chairId;
    if (start === a.start && !dentistChanged && !chairChanged) return;
    try {
      const moved = await update.mutateAsync({
        id: a.id,
        version: a.version,
        start,
        ...(dentistChanged ? { dentistId: col.dentistId } : {}),
        ...(chairChanged ? { chairId: col.chairId } : {}),
      });
      notify.success(t('reschedule.done'), {
        undo: () =>
          void update
            .mutateAsync({
              id: a.id,
              version: moved.version,
              start: a.start,
              ...(dentistChanged ? { dentistId: a.dentistId } : {}),
              ...(chairChanged ? { chairId: a.chairId ?? null } : {}),
            })
            .catch(notify.error),
      });
    } catch (err) {
      notify.error(err);
    }
  };

  const step = view === 'week' ? 7 : 1;
  const label =
    view === 'week'
      ? `${formatDate(from, lang, 'D MMM')} – ${formatDate(to, lang, 'D MMM YYYY')}`
      : formatDate(date, lang, 'dddd D MMMM YYYY');

  return (
    <Box>
      <PageHeader
        title={t('calendar.title')}
        subtitle={t('calendar.subtitle')}
        primary={
          canBook && (
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() => openQuickBook({})}
            >
              {t('book.title')}
            </Button>
          )
        }
      />
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        alignItems={{ md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 4 }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button variant="outlined" size="small" onClick={() => set({ date: undefined })}>
            {t('calendar.today')}
          </Button>
          <IconButton
            aria-label={t('calendar.previous')}
            onClick={() => set({ date: addDaysLocal(date, -step) })}
          >
            <ChevronRight size={18} style={{ transform: lang === 'ar' ? 'none' : 'scaleX(-1)' }} />
          </IconButton>
          <IconButton
            aria-label={t('calendar.next')}
            onClick={() => set({ date: addDaysLocal(date, step) })}
          >
            <ChevronLeft size={18} style={{ transform: lang === 'ar' ? 'none' : 'scaleX(-1)' }} />
          </IconButton>
          <TextField
            type="date"
            size="small"
            value={date}
            onChange={(e) => e.target.value && set({ date: e.target.value })}
            inputProps={{ dir: 'ltr', 'aria-label': t('fields.date') }}
            sx={{ width: 160 }}
          />
          <Typography
            variant="subtitle1"
            fontWeight={650}
            sx={{ px: 2, display: { xs: 'none', lg: 'block' } }}
          >
            {label}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_e, v: View | null) => v && set({ view: v === 'day' ? undefined : v })}
          >
            <ToggleButton value="day">{t('calendar.day')}</ToggleButton>
            <ToggleButton value="week">{t('calendar.week')}</ToggleButton>
          </ToggleButtonGroup>
          {view === 'day' ? (
            !ownOnly && (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={by}
                onChange={(_e, v: By | null) => v && set({ by: v === 'dentist' ? undefined : v })}
              >
                <ToggleButton value="dentist">{t('calendar.byDentist')}</ToggleButton>
                <ToggleButton value="chair">{t('calendar.byChair')}</ToggleButton>
              </ToggleButtonGroup>
            )
          ) : (
            <TextField
              select
              size="small"
              label={t('fields.dentist')}
              value={weekDentist}
              onChange={(e) => set({ dentist: e.target.value })}
              sx={{ minWidth: 180 }}
              disabled={ownOnly}
            >
              {lookups.dentists.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showCancelled}
                onChange={(e) => set({ cancelled: e.target.checked ? '1' : undefined })}
              />
            }
            label={t('calendar.showCancelled')}
          />
        </Stack>
      </Stack>

      {lookups.loading || appts.isLoading ? (
        <PageSkeleton rows={8} />
      ) : lookups.error || appts.error ? (
        <ErrorState error={lookups.error ?? appts.error} onRetry={() => void appts.refetch()} />
      ) : columns.length === 0 ? (
        <EmptyState title={t('calendar.noDentists')} description={t('calendar.noDentistsHint')} />
      ) : (
        <TimeGrid
          columns={columns}
          appointments={appts.data ?? []}
          exceptions={exceptions.data ?? []}
          startMin={startMin}
          endMin={endMin}
          colorOf={(a) =>
            a.appointmentTypeId
              ? (lookups.typeById.get(a.appointmentTypeId)?.color ?? '#4F46E5')
              : (lookups.dentistById.get(a.dentistId)?.color ?? '#4F46E5')
          }
          typeLabel={(a) => lookups.typeLabel(a.appointmentTypeId)}
          canEdit={(a) => canUpdate && ['scheduled', 'confirmed'].includes(a.status)}
          canCreate={canBook}
          onOpen={(a) => showAppointment(a.id)}
          onCreate={(col, start) =>
            openQuickBook({
              start,
              ...(col.dentistId ? { dentistId: col.dentistId } : {}),
              ...(col.chairId ? { chairId: col.chairId } : {}),
            })
          }
          onMove={(a, col, start) => void move(a, col, start)}
        />
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {t('calendar.hint')}
      </Typography>
    </Box>
  );
}
