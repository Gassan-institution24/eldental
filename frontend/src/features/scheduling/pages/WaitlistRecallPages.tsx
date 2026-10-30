import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  InputAdornment,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { CalendarPlus, PhoneCall, Plus, Search, Send, Trash2, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { PatientPicker } from '@/features/patients/components/PatientPicker';
import { formatDate, formatDateTime, todayLocal } from '@/lib/dates';
import {
  dateOnly,
  freeText,
  objectId,
  optional,
  timeOfDay,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, type Column } from '@/shared/components/DataTable';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  useRecalls,
  useSaveRecall,
  useSaveWaitlist,
  useWaitlist,
  type Recall,
  type WaitlistEntry,
} from '../api';
import { addDaysLocal, useSchedulingLookups } from '../components/lookups';
import { useQuickBook } from '../components/quickBookStore';
import { useSocketEvent } from '@/lib/socket';

const PRIORITY_COLOR: Record<string, 'default' | 'info' | 'warning' | 'error'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'error',
};
const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];

function PatientCell({
  p,
}: {
  p?: { id: string; fullName: string; fileNumber: string; phone?: string };
}) {
  if (!p) return null;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        component={RouterLink}
        to={`/clinic/patients/${p.id}`}
        variant="body2"
        fontWeight={650}
        dir="auto"
        sx={{
          color: 'text.primary',
          textDecoration: 'none',
          '&:hover': { textDecoration: 'underline' },
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {p.fullName}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        dir="ltr"
        sx={{ textAlign: 'start' }}
      >
        {[p.fileNumber, p.phone].filter(Boolean).join(' · ')}
      </Typography>
    </Box>
  );
}

/* ---------------- waiting list (06 §6) ---------------- */

export function WaitlistPage() {
  const { t, i18n } = useTranslation('scheduling');
  const notify = useNotify();
  const confirm = useConfirm();
  const lookups = useSchedulingLookups();
  const openQuickBook = useQuickBook((s) => s.open);
  const [status, setStatus] = useState<'active' | 'booked' | 'removed'>('active');
  const [adding, setAdding] = useState(false);
  const [matches, setMatches] = useState<Set<string>>(new Set());
  const list = useWaitlist({ status: status === 'active' ? undefined : status });
  const save = useSaveWaitlist();

  // A cancellation freed a slot that fits these entries: highlight them.
  const onMatch = useCallback(
    (p: Record<string, unknown>) => {
      const ids = (p.entryIds as string[] | undefined) ?? [];
      if (!ids.length) return;
      setMatches(new Set(ids));
      notify.info(t('waitlist.matchFound', { count: ids.length }));
    },
    [notify, t],
  );
  useSocketEvent('waitlist:match', onMatch);

  const days = (w: WaitlistEntry) =>
    w.preferredDays.length
      ? WEEKDAYS.filter((d) => w.preferredDays.includes(d))
          .map((d) => t(`weekdaysShort.${d}`))
          .join('، ')
      : t('waitlist.anyDay');

  const columns: Column<WaitlistEntry>[] = [
    {
      field: 'patient',
      headerName: t('fields.patient'),
      flex: 1.4,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => <PatientCell p={row.patient} />,
    },
    {
      field: 'priority',
      headerName: t('waitlist.priority'),
      width: 120,
      renderCell: ({ row }) => (
        <Chip
          size="small"
          color={PRIORITY_COLOR[row.priority]}
          label={t(`waitlist.priorities.${row.priority}`)}
          variant={matches.has(row.id) ? 'filled' : 'outlined'}
        />
      ),
    },
    {
      field: 'dentistId',
      headerName: t('fields.dentist'),
      flex: 1,
      minWidth: 140,
      valueGetter: (_v, row) =>
        row.dentistId ? lookups.dentistById.get(row.dentistId)?.name : t('waitlist.anyDentist'),
    },
    {
      field: 'appointmentTypeId',
      headerName: t('fields.type'),
      flex: 0.8,
      minWidth: 120,
      valueGetter: (_v, row) => lookups.typeLabel(row.appointmentTypeId) || '—',
    },
    {
      field: 'preferredDays',
      headerName: t('waitlist.when'),
      flex: 1.2,
      minWidth: 180,
      sortable: false,
      valueGetter: (_v, row) =>
        `${days(row)}${row.preferredTimeRange ? ` · ${row.preferredTimeRange.from}–${row.preferredTimeRange.to}` : ''}`,
    },
    {
      field: 'status',
      headerName: t('fields.status'),
      width: 110,
      renderCell: ({ row }) => <StatusChip status={row.status} />,
    },
    {
      field: 'createdAt',
      headerName: t('waitlist.added'),
      width: 150,
      valueGetter: (_v, row) => formatDate(row.createdAt, i18n.language, 'll'),
    },
    {
      field: 'actions',
      headerName: '',
      width: 150,
      sortable: false,
      align: 'right',
      renderCell: ({ row }) =>
        row.status === 'waiting' || row.status === 'offered' ? (
          <Stack direction="row" spacing={0.5}>
            <Tooltip title={t('waitlist.book')}>
              <IconButton
                size="small"
                color="primary"
                aria-label={t('waitlist.book')}
                onClick={() =>
                  openQuickBook({
                    patientId: row.patientId,
                    dentistId: row.dentistId,
                    appointmentTypeId: row.appointmentTypeId,
                    waitlistId: row.id,
                  })
                }
              >
                <CalendarPlus size={18} />
              </IconButton>
            </Tooltip>
            {row.status === 'waiting' && (
              <Tooltip title={t('waitlist.offer')}>
                <IconButton
                  size="small"
                  aria-label={t('waitlist.offer')}
                  onClick={() =>
                    void save
                      .mutateAsync({ id: row.id, status: 'offered' })
                      .then(() => notify.success(t('waitlist.offered')), notify.error)
                  }
                >
                  <Send size={18} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('waitlist.remove')}>
              <IconButton
                size="small"
                aria-label={t('waitlist.remove')}
                onClick={async () => {
                  const r = await confirm({
                    title: t('waitlist.removeTitle', { name: row.patient?.fullName ?? '' }),
                    destructive: true,
                  });
                  if (r.confirmed)
                    await save
                      .mutateAsync({ id: row.id, status: 'removed' })
                      .then(() => notify.success(t('waitlist.removed')), notify.error);
                }}
              >
                <Trash2 size={18} />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null,
    },
  ];

  return (
    <Box>
      <PageHeader
        title={t('waitlist.title')}
        subtitle={t('waitlist.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setAdding(true)}
          >
            {t('waitlist.add')}
          </Button>
        }
      />
      <Tabs value={status} onChange={(_e, v: typeof status) => setStatus(v)} sx={{ mb: 4 }}>
        <Tab value="active" label={t('waitlist.tabs.active')} />
        <Tab value="booked" label={t('waitlist.tabs.booked')} />
        <Tab value="removed" label={t('waitlist.tabs.removed')} />
      </Tabs>
      <DataTable
        rows={list.data ?? []}
        columns={columns}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        clientSide
        empty={<EmptyState title={t('waitlist.empty')} description={t('waitlist.emptyHint')} />}
      />
      {adding && <WaitlistDialog onClose={() => setAdding(false)} />}
    </Box>
  );
}

const waitSchema = z
  .object({
    patient: z
      .object({ id: objectId(), fullName: z.string() })
      .nullable()
      .refine((v) => v !== null, { message: 'required' }),
    dentistId: optional(objectId()),
    appointmentTypeId: optional(objectId()),
    preferredDays: z.array(z.number()),
    from: optional(timeOfDay()),
    to: optional(timeOfDay()),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    notes: optional(freeText(500)),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.from) !== Boolean(v.to))
      ctx.addIssue({ code: 'custom', path: [v.from ? 'to' : 'from'], message: 'required' });
    if (v.from && v.to && v.to <= v.from)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'end_before_start' });
  });
type WaitValues = z.input<typeof waitSchema>;

function WaitlistDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('scheduling');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const save = useSaveWaitlist();
  const lookups = useSchedulingLookups();
  const form = useAppForm<WaitValues>({
    schema: waitSchema,
    defaultValues: {
      patient: null,
      dentistId: '',
      appointmentTypeId: '',
      preferredDays: [],
      from: '',
      to: '',
      priority: 'normal',
      notes: '',
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('waitlist.add')}</DialogTitle>
      <DialogContent>
        <Form
          form={form}
          name="scheduling.waitlist"
          id="waitlist-form"
          onSubmit={async (v) => {
            await save.mutateAsync({
              patientId: v.patient!.id,
              ...(v.dentistId ? { dentistId: v.dentistId } : {}),
              ...(v.appointmentTypeId ? { appointmentTypeId: v.appointmentTypeId } : {}),
              preferredDays: v.preferredDays,
              ...(v.from && v.to ? { preferredTimeRange: { from: v.from, to: v.to } } : {}),
              priority: v.priority,
              ...(v.notes ? { notes: v.notes } : {}),
            });
            notify.success(t('waitlist.saved'));
            onClose();
          }}
        >
          <Stack spacing={4} sx={{ pt: 2 }}>
            <Controller
              name="patient"
              control={form.control}
              render={({ field, fieldState }) => (
                <Box data-field="patient">
                  <PatientPicker
                    name="patient"
                    value={field.value ?? null}
                    onChange={field.onChange}
                    required
                    error={Boolean(fieldState.error)}
                    helperText={fieldState.error ? t('book.patientRequired') : undefined}
                  />
                </Box>
              )}
            />
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <RHFSelect
                  name="dentistId"
                  label={t('fields.dentist')}
                  clearable
                  options={lookups.dentists.map((d) => ({ value: d.id, label: d.name }))}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <RHFSelect
                  name="appointmentTypeId"
                  label={t('fields.type')}
                  clearable
                  options={lookups.types.map((ty) => ({
                    value: ty.id,
                    label: lookups.typeLabel(ty.id),
                  }))}
                />
              </Grid>
            </Grid>
            <Controller
              name="preferredDays"
              control={form.control}
              render={({ field }) => (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t('waitlist.preferredDays')}
                  </Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {WEEKDAYS.map((d) => {
                      const on = field.value.includes(d);
                      return (
                        <Chip
                          key={d}
                          label={t(`weekdaysShort.${d}`)}
                          color={on ? 'primary' : 'default'}
                          variant={on ? 'filled' : 'outlined'}
                          onClick={() =>
                            field.onChange(
                              on ? field.value.filter((x) => x !== d) : [...field.value, d],
                            )
                          }
                        />
                      );
                    })}
                  </Stack>
                </Box>
              )}
            />
            <Grid container spacing={3}>
              <Grid item xs={6}>
                <RHFTextField
                  name="from"
                  label={t('waitlist.fromTime')}
                  placeholder="09:00"
                  inputProps={{ dir: 'ltr' }}
                />
              </Grid>
              <Grid item xs={6}>
                <RHFTextField
                  name="to"
                  label={t('waitlist.toTime')}
                  placeholder="13:00"
                  inputProps={{ dir: 'ltr' }}
                />
              </Grid>
            </Grid>
            <RHFSelect
              name="priority"
              label={t('waitlist.priority')}
              options={(['low', 'normal', 'high', 'urgent'] as const).map((p) => ({
                value: p,
                label: t(`waitlist.priorities.${p}`),
              }))}
            />
            <RHFTextField
              name="notes"
              label={t('fields.notes')}
              multiline
              minRows={2}
              maxLength={500}
            />
          </Stack>
        </Form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button type="submit" form="waitlist-form" variant="contained" disabled={save.isPending}>
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- recalls (06 §7) ---------------- */

const BUCKETS = ['due', 'overdue', 'upcoming', 'contacted', 'booked', 'dismissed'] as const;

export function RecallsPage() {
  const { t, i18n } = useTranslation('scheduling');
  const notify = useNotify();
  const lookups = useSchedulingLookups();
  const openQuickBook = useQuickBook((s) => s.open);
  const { can } = usePermission();
  const [sp, setSp] = useSearchParams();
  const bucket = (sp.get('bucket') as (typeof BUCKETS)[number]) || 'due';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  const [adding, setAdding] = useState(false);
  const list = useRecalls({ bucket, q: debounced || undefined });
  const save = useSaveRecall();
  const act = (id: string, body: Record<string, unknown>, msg: string) =>
    void save.mutateAsync({ id, ...body }).then(() => notify.success(msg), notify.error);

  const columns: Column<Recall>[] = [
    {
      field: 'patient',
      headerName: t('fields.patient'),
      flex: 1.4,
      minWidth: 200,
      sortable: false,
      renderCell: ({ row }) => <PatientCell p={row.patient} />,
    },
    {
      field: 'type',
      headerName: t('fields.type'),
      width: 150,
      valueGetter: (_v, row) => t(`recalls.types.${row.type}`),
    },
    {
      field: 'dueDate',
      headerName: t('recalls.due'),
      width: 150,
      renderCell: ({ row }) => (
        <Typography
          variant="body2"
          color={row.overdue ? 'error.main' : 'text.primary'}
          fontWeight={row.overdue ? 700 : 400}
        >
          {formatDate(row.dueDate, i18n.language, 'll')}
        </Typography>
      ),
    },
    {
      field: 'dentistId',
      headerName: t('fields.dentist'),
      flex: 1,
      minWidth: 140,
      valueGetter: (_v, row) =>
        row.dentistId ? lookups.dentistById.get(row.dentistId)?.name : '—',
    },
    {
      field: 'status',
      headerName: t('fields.status'),
      width: 120,
      renderCell: ({ row }) => (
        <StatusChip
          status={row.overdue ? 'overdue' : row.status}
          label={row.overdue ? t('recalls.overdue') : undefined}
        />
      ),
    },
    {
      field: 'lastContactAt',
      headerName: t('recalls.lastContact'),
      width: 170,
      valueGetter: (_v, row) =>
        row.lastContactAt
          ? `${formatDateTime(row.lastContactAt, i18n.language)} (${row.contactCount})`
          : '—',
    },
    {
      field: 'actions',
      headerName: '',
      width: 150,
      sortable: false,
      align: 'right',
      renderCell: ({ row }) =>
        row.status !== 'booked' && row.status !== 'dismissed' ? (
          <Stack direction="row" spacing={0.5}>
            {can('scheduling.appointment.book') && (
              <Tooltip title={t('recalls.book')}>
                <IconButton
                  size="small"
                  color="primary"
                  aria-label={t('recalls.book')}
                  onClick={() =>
                    openQuickBook({
                      patientId: row.patientId,
                      dentistId: row.dentistId,
                      source: 'recall',
                      recallId: row.id,
                    })
                  }
                >
                  <CalendarPlus size={18} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('recalls.markContacted')}>
              <IconButton
                size="small"
                aria-label={t('recalls.markContacted')}
                onClick={() => act(row.id, { contacted: true }, t('recalls.contacted'))}
              >
                <PhoneCall size={18} />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('recalls.dismiss')}>
              <IconButton
                size="small"
                aria-label={t('recalls.dismiss')}
                onClick={() => act(row.id, { status: 'dismissed' }, t('recalls.dismissed'))}
              >
                <XCircle size={18} />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null,
    },
  ];

  return (
    <Box>
      <PageHeader
        title={t('recalls.title')}
        subtitle={t('recalls.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setAdding(true)}
          >
            {t('recalls.add')}
          </Button>
        }
      />
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        justifyContent="space-between"
        alignItems={{ md: 'center' }}
        sx={{ mb: 4 }}
      >
        <Tabs
          value={bucket}
          onChange={(_e, v: string) => setSp(v === 'due' ? {} : { bucket: v }, { replace: true })}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          {BUCKETS.map((b) => (
            <Tab key={b} value={b} label={t(`recalls.buckets.${b}`)} />
          ))}
        </Tabs>
        <TextField
          size="small"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('recalls.search')}
          inputProps={{ 'aria-label': t('recalls.search'), dir: 'auto' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            ),
          }}
          sx={{ width: { xs: '100%', md: 280 } }}
        />
      </Stack>
      <DataTable
        rows={list.data ?? []}
        columns={columns}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        clientSide
        empty={<EmptyState title={t('recalls.empty')} description={t('recalls.emptyHint')} />}
      />
      {adding && <RecallDialog onClose={() => setAdding(false)} />}
    </Box>
  );
}

const recallSchema = z.object({
  patient: z
    .object({ id: objectId(), fullName: z.string() })
    .nullable()
    .refine((v) => v !== null, { message: 'required' }),
  type: z.enum(['cleaning', 'checkup', 'ortho_adjustment', 'custom'], { message: 'required' }),
  dueDate: dateOnly(),
  intervalMonths: z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .int({ message: 'invalid' })
    .min(1, { message: 'too_small' })
    .max(36, { message: 'too_big' }),
  dentistId: optional(objectId()),
  notes: optional(freeText(500)),
});
type RecallValues = z.input<typeof recallSchema>;

function RecallDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('scheduling');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const save = useSaveRecall();
  const lookups = useSchedulingLookups();
  const form = useAppForm<RecallValues>({
    schema: recallSchema,
    defaultValues: {
      patient: null,
      type: 'cleaning',
      dueDate: addDaysLocal(todayLocal(), 180),
      intervalMonths: 6,
      dentistId: '',
      notes: '',
    },
  });
  const months = useWatch({ control: form.control, name: 'intervalMonths' });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('recalls.add')}</DialogTitle>
      <DialogContent>
        <Form
          form={form}
          name="scheduling.recall"
          id="recall-form"
          onSubmit={async (v) => {
            await save.mutateAsync({
              patientId: v.patient!.id,
              type: v.type,
              dueDate: v.dueDate,
              intervalMonths: Number(v.intervalMonths),
              ...(v.dentistId ? { dentistId: v.dentistId } : {}),
              ...(v.notes ? { notes: v.notes } : {}),
            });
            notify.success(t('recalls.created'));
            onClose();
          }}
        >
          <Stack spacing={4} sx={{ pt: 2 }}>
            <Controller
              name="patient"
              control={form.control}
              render={({ field, fieldState }) => (
                <Box data-field="patient">
                  <PatientPicker
                    name="patient"
                    value={field.value ?? null}
                    onChange={field.onChange}
                    required
                    error={Boolean(fieldState.error)}
                    helperText={fieldState.error ? t('book.patientRequired') : undefined}
                  />
                </Box>
              )}
            />
            <Grid container spacing={3}>
              <Grid item xs={12} sm={6}>
                <RHFSelect
                  name="type"
                  label={t('fields.type')}
                  required
                  options={(['cleaning', 'checkup', 'ortho_adjustment', 'custom'] as const).map(
                    (x) => ({ value: x, label: t(`recalls.types.${x}`) }),
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <RHFSelect
                  name="dentistId"
                  label={t('fields.dentist')}
                  clearable
                  options={lookups.dentists.map((d) => ({ value: d.id, label: d.name }))}
                />
              </Grid>
              <Grid item xs={7}>
                <RHFDate name="dueDate" label={t('recalls.due')} required />
              </Grid>
              <Grid item xs={5}>
                <RHFTextField
                  name="intervalMonths"
                  label={t('recalls.interval')}
                  type="number"
                  inputProps={{ dir: 'ltr', min: 1, max: 36 }}
                  helperText={t('recalls.intervalHelper', { count: Number(months) || 0 })}
                />
              </Grid>
            </Grid>
            <RHFTextField
              name="notes"
              label={t('fields.notes')}
              multiline
              minRows={2}
              maxLength={500}
            />
          </Stack>
        </Form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button type="submit" form="recall-form" variant="contained" disabled={save.isPending}>
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
