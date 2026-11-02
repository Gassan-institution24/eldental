import {
  Alert,
  Box,
  Button,
  Card,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { CalendarPlus, Clock, MapPin, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { formatDateTime, formatTime } from '@/lib/dates';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { useCancelAppointment, usePortalAppointments, type PortalAppointment } from '../api';
import { DateBlock, PortalHeader, useSeedLabel } from '../components';
import { patientCta } from './PatientAuthPages';

function CancelDialog({ appt, onClose }: { appt: PortalAppointment; onClose: () => void }) {
  const { t, i18n } = useTranslation('patient');
  const cancel = useCancelAppointment();
  const notify = useNotify();
  const [comment, setComment] = useState('');
  const run = async () => {
    try {
      await cancel.mutateAsync({ id: appt.id, comment: comment.trim() || undefined });
      notify.success(t('portal.appointments.cancelled'));
      onClose();
    } catch (err) {
      notify.error(err);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('portal.appointments.cancelTitle')}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 4 }}>
          {t('portal.appointments.cancelBody', {
            date: formatDateTime(appt.start, i18n.language),
            dentist: appt.dentist.name,
          })}
        </Typography>
        <TextField
          label={t('portal.appointments.cancelComment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          fullWidth
          multiline
          minRows={2}
          inputProps={{ maxLength: 300, dir: 'auto' }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>{t('common:actions.back')}</Button>
        <Button
          color="error"
          variant="contained"
          disabled={cancel.isPending}
          onClick={() => void run()}
        >
          {t('portal.appointments.cancelConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function AppointmentCard({ a, onCancel }: { a: PortalAppointment; onCancel: () => void }) {
  const { t, i18n } = useTranslation('patient');
  const lang = i18n.language;
  const label = useSeedLabel('appointmentType');
  return (
    <Card sx={{ p: { xs: 4, md: 5 }, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" spacing={3} alignItems="flex-start">
        <DateBlock value={a.start} lang={lang} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            <Typography fontWeight={800} noWrap>
              {label(a.appointmentType) || t('portal.appointments.visit')}
            </Typography>
            <StatusChip status={a.status} />
          </Stack>
          <Stack spacing={0.75} sx={{ mt: 1.5 }}>
            <Line icon={<Clock size={14} />}>
              <span dir="ltr">
                {formatTime(a.start, lang)}–{formatTime(a.end, lang)}
              </span>
            </Line>
            <Line icon={<User size={14} />}>
              <span dir="auto">{a.dentist.name}</span>
            </Line>
            {a.clinic && (
              <Line icon={<MapPin size={14} />}>
                <span dir="auto">{a.clinic.name}</span>
              </Line>
            )}
          </Stack>
          {a.patient && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              {t('portal.appointments.for', { name: a.patient.fullName })} ·{' '}
              <span dir="ltr">{a.number}</span>
            </Typography>
          )}
        </Box>
      </Stack>
      {a.upcoming && (
        <Box sx={{ mt: 'auto', pt: 4 }}>
          {a.canCancel ? (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ sm: 'center' }}
              justifyContent="space-between"
            >
              <Typography variant="caption" color="text.secondary">
                {t('portal.appointments.cancelBy', { date: formatDateTime(a.cancelBy, lang) })}
              </Typography>
              <Button color="error" variant="outlined" size="small" onClick={onCancel}>
                {t('portal.appointments.cancel')}
              </Button>
            </Stack>
          ) : (
            <Alert severity="info" sx={{ py: 0 }}>
              {t('portal.appointments.tooLate', { hours: a.cancellationWindowHours })}
            </Alert>
          )}
        </Box>
      )}
    </Card>
  );
}

function Line({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      alignItems="center"
      sx={{ color: 'text.secondary', minWidth: 0 }}
    >
      {icon}
      <Typography variant="body2" noWrap>
        {children}
      </Typography>
    </Stack>
  );
}

/** My appointments (01 §4.10): upcoming first, then history; cancel inside the clinic's rules. */
export function AppointmentsPage() {
  const { t } = useTranslation('patient');
  const q = usePortalAppointments();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [cancelling, setCancelling] = useState<PortalAppointment | null>(null);

  const all = q.data ?? [];
  const upcoming = all.filter((a) => a.upcoming).sort((a, b) => a.start.localeCompare(b.start));
  const past = all.filter((a) => !a.upcoming);
  const list = tab === 'upcoming' ? upcoming : past;

  return (
    <>
      <PortalHeader
        title={t('portal.appointments.title')}
        subtitle={t('portal.appointments.subtitle')}
        action={
          <Button
            component={RouterLink}
            to="/portal/book"
            variant="contained"
            startIcon={<CalendarPlus size={18} />}
            sx={patientCta}
          >
            {t('home.book')}
          </Button>
        }
      />
      <Tabs
        value={tab}
        onChange={(_e, v: 'upcoming' | 'past') => setTab(v)}
        sx={{ mb: 5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="upcoming" label={`${t('portal.appointments.upcoming')} (${upcoming.length})`} />
        <Tab value="past" label={`${t('portal.appointments.past')} (${past.length})`} />
      </Tabs>
      {q.isLoading ? (
        <PageSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            title={t(
              tab === 'upcoming'
                ? 'portal.appointments.emptyUpcoming'
                : 'portal.appointments.emptyPast',
            )}
            description={tab === 'upcoming' ? t('home.noUpcomingHint') : undefined}
            action={
              tab === 'upcoming' ? (
                <Button
                  component={RouterLink}
                  to="/portal/book"
                  variant="contained"
                  sx={patientCta}
                >
                  {t('home.book')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Grid container spacing={4}>
          {list.map((a) => (
            <Grid item xs={12} md={6} xl={4} key={a.id}>
              <AppointmentCard a={a} onCancel={() => setCancelling(a)} />
            </Grid>
          ))}
        </Grid>
      )}
      {cancelling && <CancelDialog appt={cancelling} onClose={() => setCancelling(null)} />}
    </>
  );
}
