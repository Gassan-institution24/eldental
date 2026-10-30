import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { formatDate, formatTime } from '@/lib/dates';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { usePermission } from '@/shared/rbac/usePermission';
import { usePatientAppointments, type Appointment } from '../api';
import { useSchedulingLookups } from './lookups';
import { useAppointmentPanel, useQuickBook } from './quickBookStore';

/** Patient workspace → Appointments: upcoming first, then history. */
export function PatientAppointmentsTab() {
  const { t, i18n } = useTranslation('scheduling');
  const { patient } = usePatientContext();
  const q = usePatientAppointments(patient.id);
  const lookups = useSchedulingLookups();
  const show = useAppointmentPanel((s) => s.show);
  const openQuickBook = useQuickBook((s) => s.open);
  const { can } = usePermission();
  const now = Date.now();
  const all = q.data ?? [];
  const upcoming = all
    .filter(
      (a) => new Date(a.start).getTime() >= now && ['scheduled', 'confirmed'].includes(a.status),
    )
    .reverse();
  const past = all.filter((a) => !upcoming.includes(a));

  const row = (a: Appointment) => (
    <Card
      key={a.id}
      variant="outlined"
      sx={{ p: 3, cursor: 'pointer', '&:hover': { boxShadow: 2 } }}
      onClick={() => show(a.id)}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 4 }}
        alignItems={{ sm: 'center' }}
      >
        <Box sx={{ minWidth: 190 }}>
          <Typography variant="subtitle2">
            {formatDate(a.start, i18n.language, 'ddd LL')}
          </Typography>
          <Typography variant="caption" color="text.secondary" dir="ltr">
            {formatTime(a.start, i18n.language)}–{formatTime(a.end, i18n.language)}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ flex: 1 }}>
          {[lookups.dentistById.get(a.dentistId)?.name, lookups.typeLabel(a.appointmentTypeId)]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
        <Typography variant="caption" color="text.secondary" dir="ltr">
          {a.number}
        </Typography>
        <StatusChip status={a.displayStatus} />
      </Stack>
    </Card>
  );

  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Stack spacing={5}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('patientTab.upcoming')}</Typography>
        {can('scheduling.appointment.book') && (
          <Button
            variant="contained"
            startIcon={<CalendarPlus size={16} />}
            onClick={() => openQuickBook({ patientId: patient.id })}
          >
            {t('book.title')}
          </Button>
        )}
      </Stack>
      {upcoming.length ? (
        <Stack spacing={2}>{upcoming.map(row)}</Stack>
      ) : (
        <EmptyState compact title={t('patientTab.noUpcoming')} />
      )}
      <Typography variant="h5">{t('patientTab.past')}</Typography>
      {past.length ? (
        <Stack spacing={2}>{past.map(row)}</Stack>
      ) : (
        <EmptyState compact title={t('patientTab.noPast')} />
      )}
    </Stack>
  );
}
