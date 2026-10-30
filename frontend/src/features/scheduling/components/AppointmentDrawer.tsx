import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  Skeleton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  AlertTriangle,
  Armchair,
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  ExternalLink,
  UserX,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { isApiError } from '@/lib/api/apiError';
import { formatDate, formatDateTime, formatTime } from '@/lib/dates';
import {
  dateOnly,
  freeText,
  objectId,
  optional,
  timeOfDay,
} from '@/shared/generated/validation/fields';
import { ErrorState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { Form } from '@/shared/form/Form';
import { RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  CANCEL_REASONS,
  TRANSITIONS,
  useAppointment,
  useCancelAppointment,
  useTransition,
  useUpdateAppointment,
  type Appointment,
  type AppointmentStatus,
} from '../api';
import { localDateOf, localToIso, minutesBetween, useSchedulingLookups } from './lookups';
import { useAppointmentPanel } from './quickBookStore';

const ACTION_ICONS: Partial<Record<AppointmentStatus, JSX.Element>> = {
  confirmed: <CheckCircle2 size={16} />,
  arrived: <DoorOpen size={16} />,
  in_chair: <Armchair size={16} />,
  completed: <CheckCircle2 size={16} />,
  no_show: <UserX size={16} />,
};

const ACTION_PERM: Record<string, string> = {
  confirmed: 'scheduling.appointment.update',
  arrived: 'scheduling.appointment.checkin',
  in_chair: 'scheduling.appointment.checkin',
  completed: 'scheduling.appointment.update',
  no_show: 'scheduling.appointment.cancel',
  cancelled: 'scheduling.appointment.cancel',
};

/** Hook used by the drawer, the today board and calendar menus to move an appointment along. */
export function useAppointmentActions() {
  const { t } = useTranslation('scheduling');
  const notify = useNotify();
  const confirm = useConfirm();
  const transition = useTransition();
  const { can } = usePermission();

  const run = async (a: Appointment, to: AppointmentStatus) => {
    try {
      if (to === 'no_show') {
        const r = await confirm({
          title: t('actions.noShowTitle'),
          body: t('actions.noShowBody', { name: a.patient?.fullName ?? '' }),
          destructive: true,
          confirmLabel: t('status.no_show'),
        });
        if (!r.confirmed) return;
      }
      await transition.mutateAsync({ id: a.id, to, version: a.version });
      notify.success(t(`actions.done.${to}`));
    } catch (err) {
      if (to === 'completed' && isApiError(err) && err.code === 'COMPLETE_REQUIRES_PROCEDURE') {
        const r = await confirm({
          title: t('actions.noProceduresTitle'),
          body: t('actions.noProceduresBody'),
          reason: { label: t('actions.noProceduresReason'), required: true, max: 300 },
        });
        if (!r.confirmed) return;
        try {
          await transition.mutateAsync({ id: a.id, to, noProcedures: true, reason: r.reason });
          notify.success(t('actions.done.completed'));
        } catch (e) {
          notify.error(e);
        }
        return;
      }
      notify.error(err);
    }
  };

  const allowed = (a: Appointment) =>
    TRANSITIONS[a.status].filter((s) => s !== 'cancelled' && can(ACTION_PERM[s]));
  return {
    run,
    allowed,
    pending: transition.isPending,
    canCancel: (a: Appointment) =>
      TRANSITIONS[a.status].includes('cancelled') && can('scheduling.appointment.cancel'),
  };
}

export function AppointmentDrawer() {
  const { t, i18n } = useTranslation('scheduling');
  const { t: tc } = useTranslation();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { id, hide } = useAppointmentPanel();
  const q = useAppointment(id ?? undefined);
  const lookups = useSchedulingLookups();
  const actions = useAppointmentActions();
  const { can } = usePermission();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  useEffect(() => setMoving(false), [id]);
  const a = q.data;
  const lang = i18n.language;

  return (
    <Drawer
      anchor="right"
      open={Boolean(id)}
      onClose={hide}
      PaperProps={{ sx: { width: mobile ? '100%' : 460 } }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ px: 6, py: 5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {a ? (
            <>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="h4" component="h2" dir="auto" noWrap>
                  {a.patient?.fullName ?? t('hiddenPatient')}
                </Typography>
                <StatusChip status={a.displayStatus} />
              </Stack>
              <Typography
                variant="body2"
                color="text.secondary"
                dir="ltr"
                sx={{ textAlign: 'start' }}
              >
                {a.number} · {a.patient?.fileNumber}
              </Typography>
            </>
          ) : (
            <Skeleton width={220} height={32} />
          )}
        </Box>
        <IconButton onClick={hide} aria-label={tc('actions.close')} size="small">
          <X size={20} />
        </IconButton>
      </Stack>
      <Divider />
      <Box sx={{ flex: 1, overflowY: 'auto', px: 6, py: 5 }}>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
        ) : !a ? (
          <Stack spacing={2}>
            {[1, 2, 3, 4].map((k) => (
              <Skeleton key={k} height={28} />
            ))}
          </Stack>
        ) : (
          <Stack spacing={5}>
            {(a.patient?.medicalAlerts.length ?? 0) > 0 && (
              <Alert severity="error" icon={<AlertTriangle size={18} />}>
                {t('medicalAlerts')}
              </Alert>
            )}
            {(a.patient?.noShowCount ?? 0) >= 3 && (
              <Alert severity="warning">
                {t('frequentNoShow', { count: a.patient?.noShowCount })}
              </Alert>
            )}
            <Stack spacing={2}>
              <Row label={t('fields.date')} value={formatDate(a.start, lang, 'dddd LL')} />
              <Row
                label={t('fields.time')}
                value={`${formatTime(a.start, lang)} – ${formatTime(a.end, lang)} (${t('minutes', { count: minutesBetween(a.start, a.end) })})`}
              />
              <Row
                label={t('fields.dentist')}
                value={lookups.dentistById.get(a.dentistId)?.name ?? '—'}
              />
              <Row
                label={t('fields.chair')}
                value={a.chairId ? (lookups.chairById.get(a.chairId)?.name ?? '—') : '—'}
              />
              <Row label={t('fields.type')} value={lookups.typeLabel(a.appointmentTypeId) || '—'} />
              <Row label={t('fields.source')} value={t(`source.${a.source}`)} />
              {a.priority === 'emergency' && (
                <Row label={t('fields.priority')} value={t('book.emergency')} />
              )}
              {a.overbooked && <Row label={t('overbooked')} value={tc('yes')} />}
              {a.notes && <Row label={t('fields.notes')} value={a.notes} />}
              {a.cancellation && (
                <Row
                  label={t('cancel.reason')}
                  value={`${t(`cancel.reasons.${a.cancellation.reason}`, { defaultValue: a.cancellation.reason })}${a.cancellation.lateCancel ? ` · ${t('cancel.late')}` : ''}`}
                />
              )}
            </Stack>

            {a.patient && (
              <Button
                component={RouterLink}
                to={`/clinic/patients/${a.patient.id}`}
                onClick={hide}
                startIcon={<ExternalLink size={16} />}
                sx={{ alignSelf: 'flex-start' }}
              >
                {t('openPatient')}
              </Button>
            )}

            {(actions.allowed(a).length > 0 || actions.canCancel(a)) && (
              <Box>
                <Typography variant="overline" color="text.secondary">
                  {t('actions.title')}
                </Typography>
                <Stack direction="row" flexWrap="wrap" useFlexGap spacing={2} sx={{ mt: 1 }}>
                  {actions.allowed(a).map((to) => (
                    <Button
                      key={to}
                      variant={to === 'no_show' ? 'outlined' : 'contained'}
                      color={to === 'no_show' ? 'error' : 'primary'}
                      startIcon={ACTION_ICONS[to]}
                      disabled={actions.pending}
                      onClick={() => void actions.run(a, to)}
                    >
                      {t(`actions.to.${to}`)}
                    </Button>
                  ))}
                  {actions.canCancel(a) && (
                    <Button
                      variant="outlined"
                      color="error"
                      startIcon={<XCircle size={16} />}
                      onClick={() => setCancelOpen(true)}
                    >
                      {t('actions.to.cancelled')}
                    </Button>
                  )}
                  {['scheduled', 'confirmed'].includes(a.status) &&
                    can('scheduling.appointment.update') && (
                      <Button
                        variant="outlined"
                        startIcon={<CalendarClock size={16} />}
                        onClick={() => setMoving((v) => !v)}
                      >
                        {t('reschedule.title')}
                      </Button>
                    )}
                </Stack>
              </Box>
            )}

            {moving && <RescheduleForm appointment={a} onDone={() => setMoving(false)} />}

            <Box>
              <Typography variant="overline" color="text.secondary">
                {t('history')}
              </Typography>
              <Stack spacing={1.5} sx={{ mt: 1 }}>
                {[...a.statusHistory].reverse().map((h, i) => (
                  <Stack key={i} direction="row" spacing={2} alignItems="center">
                    <StatusChip status={h.to} />
                    <Typography variant="caption" color="text.secondary">
                      {formatDateTime(h.at, lang)}
                      {h.reason
                        ? ` · ${h.reason === 'rescheduled' ? t('reschedule.done') : h.reason}`
                        : ''}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Box>
          </Stack>
        )}
      </Box>
      {a && <CancelDialog appointment={a} open={cancelOpen} onClose={() => setCancelOpen(false)} />}
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={3}>
      <Typography variant="body2" color="text.secondary" sx={{ width: 110, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" dir="auto" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Stack>
  );
}

const cancelSchema = z.object({
  reason: z.enum(CANCEL_REASONS, { message: 'required' }),
  comment: optional(freeText(500)),
});
type CancelValues = z.input<typeof cancelSchema>;

function CancelDialog({
  appointment,
  open,
  onClose,
}: {
  appointment: Appointment;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('scheduling');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const cancel = useCancelAppointment();
  const form = useAppForm<CancelValues>({
    schema: cancelSchema,
    defaultValues: { reason: '' as never, comment: '' },
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('cancel.title', { name: appointment.patient?.fullName ?? '' })}</DialogTitle>
      <DialogContent>
        <Form
          form={form}
          name="scheduling.cancel"
          id="cancel-appt"
          onSubmit={async (raw) => {
            const v = raw as z.output<typeof cancelSchema>;
            await cancel.mutateAsync({
              id: appointment.id,
              reason: v.reason,
              ...(v.comment ? { comment: v.comment } : {}),
            });
            notify.success(t('actions.done.cancelled'));
            onClose();
          }}
        >
          <Stack spacing={4} sx={{ pt: 2 }}>
            <RHFSelect
              name="reason"
              label={t('cancel.reason')}
              required
              options={CANCEL_REASONS.map((r) => ({ value: r, label: t(`cancel.reasons.${r}`) }))}
            />
            <RHFTextField
              name="comment"
              label={t('cancel.comment')}
              multiline
              minRows={2}
              maxLength={500}
            />
          </Stack>
        </Form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.back')}</Button>
        <Button
          type="submit"
          form="cancel-appt"
          color="error"
          variant="contained"
          disabled={cancel.isPending}
        >
          {t('actions.to.cancelled')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const moveSchema = z.object({ date: dateOnly(), time: timeOfDay(), dentistId: objectId() });
type MoveValues = z.input<typeof moveSchema>;

function RescheduleForm({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const { t } = useTranslation('scheduling');
  const notify = useNotify();
  const update = useUpdateAppointment();
  const lookups = useSchedulingLookups();
  const form = useAppForm<MoveValues>({
    schema: moveSchema,
    defaultValues: {
      date: localDateOf(appointment.start),
      time: formatTime(appointment.start, 'en'),
      dentistId: appointment.dentistId,
    },
  });
  return (
    <Box sx={{ p: 4, borderRadius: 2, border: 1, borderColor: 'divider' }}>
      <Form
        form={form}
        name="scheduling.reschedule"
        id="reschedule"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof moveSchema>;
          await update.mutateAsync({
            id: appointment.id,
            version: appointment.version,
            start: localToIso(v.date, v.time),
            ...(v.dentistId !== appointment.dentistId ? { dentistId: v.dentistId } : {}),
          });
          notify.success(t('reschedule.done'));
          onDone();
        }}
      >
        <Stack spacing={3}>
          <RHFDate name="date" label={t('fields.date')} required />
          <RHFTextField
            name="time"
            label={t('fields.time')}
            required
            inputProps={{ dir: 'ltr' }}
            placeholder="09:30"
          />
          <RHFSelect
            name="dentistId"
            label={t('fields.dentist')}
            required
            options={lookups.dentists.map((d) => ({ value: d.id, label: d.name }))}
          />
          <Button type="submit" variant="contained" disabled={update.isPending}>
            {t('reschedule.save')}
          </Button>
        </Stack>
      </Form>
    </Box>
  );
}
