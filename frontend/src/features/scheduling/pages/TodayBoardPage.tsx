import { Badge, Box, Button, Card, Chip, Paper, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { AlertTriangle, Armchair, CheckCircle2, Clock, DoorOpen, Plus, UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDate, formatTime, todayLocal } from '@/lib/dates';
import { PageHeader } from '@/shared/components/PageHeader';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { usePermission } from '@/shared/rbac/usePermission';
import { useTodayBoard, type Appointment, type AppointmentStatus } from '../api';
import { useAppointmentActions } from '../components/AppointmentDrawer';
import { useSchedulingLookups } from '../components/lookups';
import { useAppointmentPanel, useQuickBook } from '../components/quickBookStore';

const ICONS: Partial<Record<AppointmentStatus, JSX.Element>> = {
  confirmed: <CheckCircle2 size={14} />,
  arrived: <DoorOpen size={14} />,
  in_chair: <Armchair size={14} />,
  completed: <CheckCircle2 size={14} />,
  no_show: <UserX size={14} />,
};

const COLUMNS = [
  { key: 'upcoming', tone: 'info' },
  { key: 'arrived', tone: 'warning' },
  { key: 'inChair', tone: 'secondary' },
  { key: 'completed', tone: 'success' },
  { key: 'missed', tone: 'error' },
] as const;

/** Front-desk board (06 §8): who is coming, waiting, in the chair and done — live. */
export function TodayBoardPage() {
  const { t, i18n } = useTranslation('scheduling');
  const theme = useTheme();
  const board = useTodayBoard();
  const lookups = useSchedulingLookups();
  const actions = useAppointmentActions();
  const show = useAppointmentPanel((s) => s.show);
  const openQuickBook = useQuickBook((s) => s.open);
  const { can } = usePermission();
  const lang = i18n.language;

  const card = (a: Appointment & { waitingMin?: number }) => {
    const next = actions
      .allowed(a)
      .filter((s) => s !== 'no_show' || new Date(a.start).getTime() < Date.now());
    return (
      <Card
        key={a.id}
        variant="outlined"
        sx={{ p: 3, cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
        onClick={() => show(a.id)}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Typography variant="caption" fontWeight={700} dir="ltr">
            {formatTime(a.start, lang)}–{formatTime(a.end, lang)}
          </Typography>
          {a.displayStatus !== a.status ? (
            <StatusChip status={a.displayStatus} />
          ) : a.status === 'cancelled' || a.status === 'no_show' ? (
            <StatusChip status={a.status} />
          ) : null}
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          {(a.patient?.medicalAlerts.length ?? 0) > 0 && (
            <AlertTriangle size={14} color={theme.palette.error.main} />
          )}
          <Typography variant="subtitle2" noWrap dir="auto">
            {a.patient?.fullName ?? t('hiddenPatient')}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {[
            lookups.dentistById.get(a.dentistId)?.name,
            a.chairId ? lookups.chairById.get(a.chairId)?.name : '',
            lookups.typeLabel(a.appointmentTypeId),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        {a.waitingMin !== undefined && (
          <Chip
            size="small"
            icon={<Clock size={12} />}
            color={a.waitingMin > 15 ? 'warning' : 'default'}
            label={t('board.waiting', { count: a.waitingMin })}
            sx={{ mt: 2 }}
          />
        )}
        {next.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: 2 }}
            flexWrap="wrap"
            useFlexGap
            onClick={(e) => e.stopPropagation()}
          >
            {next.map((to) => (
              <Button
                key={to}
                size="small"
                variant={to === 'no_show' ? 'text' : 'outlined'}
                color={to === 'no_show' ? 'error' : 'primary'}
                startIcon={ICONS[to]}
                disabled={actions.pending}
                onClick={() => void actions.run(a, to)}
              >
                {t(`actions.to.${to}`)}
              </Button>
            ))}
          </Stack>
        )}
      </Card>
    );
  };

  return (
    <Box>
      <PageHeader
        title={t('board.title')}
        subtitle={formatDate(todayLocal(), lang, 'dddd D MMMM YYYY')}
        primary={
          can('scheduling.appointment.book') && (
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() =>
                openQuickBook({
                  source: 'walk_in',
                  start: new Date(Math.ceil(Date.now() / 300_000) * 300_000).toISOString(),
                })
              }
            >
              {t('board.walkIn')}
            </Button>
          )
        }
      />
      {board.isLoading ? (
        <PageSkeleton rows={6} />
      ) : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 4,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              lg: 'repeat(5, minmax(0, 1fr))',
            },
            alignItems: 'start',
          }}
        >
          {COLUMNS.map((col) => {
            const items = (board.data?.[col.key] ?? []) as (Appointment & {
              waitingMin?: number;
            })[];
            const color = theme.palette[col.tone].main;
            return (
              <Paper
                key={col.key}
                variant="outlined"
                sx={{
                  p: 3,
                  bgcolor: alpha(color, 0.04),
                  borderTop: `3px solid ${color}`,
                  minHeight: 200,
                }}
              >
                <Stack
                  direction="row"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ mb: 3 }}
                >
                  <Typography variant="subtitle1" fontWeight={700}>
                    {t(`board.columns.${col.key}`)}
                  </Typography>
                  <Badge badgeContent={items.length} color={col.tone} showZero sx={{ mx: 2 }} />
                </Stack>
                <Stack spacing={2}>
                  {items.length === 0 ? (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ py: 6, textAlign: 'center' }}
                    >
                      {t('board.empty')}
                    </Typography>
                  ) : (
                    items.map(card)
                  )}
                </Stack>
              </Paper>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
