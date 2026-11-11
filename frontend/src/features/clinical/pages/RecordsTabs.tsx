import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Pill, Plus, Printer, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { useSchedulingLookups } from '@/features/scheduling/components/lookups';
import { formatDate, formatDateTime, todayLocal } from '@/lib/dates';
import { dateOnly, freeText, optional, requiredText } from '@/shared/generated/validation/fields';
import { DataTable, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { Form } from '@/shared/form/Form';
import { RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useFileUrl } from '@/shared/hooks/useFileUrl';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  consentTemplatesApi,
  fetchRxPrint,
  LAB_FLOW,
  LAB_ITEM_TYPES,
  LAB_STATUSES,
  useConsents,
  useCreatePrescription,
  useLabMutations,
  useLabOrders,
  useMedicines,
  usePrescriptions,
  useSignConsent,
  type LabOrder,
  type LabStatus,
} from '../api';
import { PrintArea, SignaturePad, toothList } from '../components/shared';
import { RHFTeethPicker } from '../components/TeethPicker';
import { useSpecialtyName } from '@/features/staff/components/SpecialtyFields';

/* ---------------- prescriptions (07 §7) ---------------- */

export function PrescriptionsTab() {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const list = usePrescriptions(patient.id);
  const sched = useSchedulingLookups();
  const { can } = usePermission();
  const [adding, setAdding] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  if (list.isLoading) return <PageSkeleton rows={4} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <Stack spacing={4}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('rx.title')}</Typography>
        {can('clinical.prescription.write') && (
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setAdding(true)}
          >
            {t('rx.new')}
          </Button>
        )}
      </Stack>
      {(list.data ?? []).length === 0 ? (
        <EmptyState icon={<Pill size={28} />} title={t('rx.empty')} />
      ) : (
        (list.data ?? []).map((rx) => (
          <Card key={rx.id} variant="outlined">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography
                    variant="subtitle1"
                    fontWeight={700}
                    dir="ltr"
                    sx={{ textAlign: 'start' }}
                  >
                    {rx.number}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {sched.dentistById.get(rx.dentistId)?.name} ·{' '}
                    {formatDateTime(rx.createdAt, i18n.language)}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  startIcon={<Printer size={14} />}
                  onClick={() => setPrinting(rx.id)}
                >
                  {t('rx.print')}
                </Button>
              </Stack>
              <Stack spacing={1} sx={{ mt: 2 }}>
                {rx.items.map((it, i) => (
                  <Typography key={i} variant="body2" dir="auto">
                    • <b>{it.name}</b>{' '}
                    {[
                      it.dose,
                      it.frequency,
                      it.durationDays ? t('rx.days', { count: it.durationDays }) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))
      )}
      {adding && <RxDialog onClose={() => setAdding(false)} />}
      {printing && <RxPrintDialog id={printing} onClose={() => setPrinting(null)} />}
    </Stack>
  );
}

const rxSchema = z.object({
  items: z
    .array(
      z.object({
        name: requiredText(120),
        dose: optional(freeText(60)),
        frequency: optional(freeText(80)),
        durationDays: z.union([
          z.literal(''),
          z.coerce
            .number()
            .int({ message: 'invalid' })
            .min(1, { message: 'too_small' })
            .max(365, { message: 'too_big' }),
        ]),
        instructions: optional(freeText(300)),
      }),
    )
    .min(1, { message: 'too_few' })
    .max(15),
  notes: optional(freeText(1000)),
});
type RxValues = z.input<typeof rxSchema>;

function RxDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const notify = useNotify();
  const create = useCreatePrescription(patient.id);
  const [q, setQ] = useState('');
  const meds = useMedicines(q);
  const form = useAppForm<RxValues>({ schema: rxSchema, defaultValues: { items: [], notes: '' } });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('rx.new')}
      subtitle={patient.medicalAlerts.length ? t('rx.alertsHint') : undefined}
      formId="rx-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form
        form={form}
        name="clinical.prescription"
        id="rx-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof rxSchema>;
          await create.mutateAsync({
            items: v.items.map((i) => ({
              name: i.name,
              ...(i.dose ? { dose: i.dose } : {}),
              ...(i.frequency ? { frequency: i.frequency } : {}),
              ...(typeof i.durationDays === 'number' ? { durationDays: i.durationDays } : {}),
              ...(i.instructions ? { instructions: i.instructions } : {}),
            })),
            ...(v.notes ? { notes: v.notes } : {}),
          });
          notify.success(t('rx.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          {patient.medicalAlerts.length > 0 && (
            <Alert severity="error">{t('rx.checkAllergies')}</Alert>
          )}
          <Autocomplete
            options={meds.data ?? []}
            getOptionLabel={(m) => m.name}
            onInputChange={(_e, v) => setQ(v)}
            onChange={(_e, m) =>
              m &&
              append({
                name: m.name,
                dose: m.dose,
                frequency: m.frequency,
                durationDays: m.days,
                instructions: '',
              })
            }
            value={null}
            renderInput={(p) => (
              <TextField {...p} label={t('rx.addMedicine')} placeholder={t('rx.searchMedicine')} />
            )}
          />
          {fields.map((f, i) => (
            <Box key={f.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={11}>
                  <RHFTextField
                    name={`items.${i}.name`}
                    label={t('rx.medicine')}
                    required
                    size="small"
                    maxLength={120}
                  />
                </Grid>
                <Grid item xs={1}>
                  <IconButton aria-label={t('rx.remove')} onClick={() => remove(i)}>
                    <Trash2 size={16} />
                  </IconButton>
                </Grid>
                <Grid item xs={6} sm={4}>
                  <RHFTextField
                    name={`items.${i}.dose`}
                    label={t('rx.dose')}
                    size="small"
                    maxLength={60}
                  />
                </Grid>
                <Grid item xs={6} sm={5}>
                  <RHFTextField
                    name={`items.${i}.frequency`}
                    label={t('rx.frequency')}
                    size="small"
                    maxLength={80}
                  />
                </Grid>
                <Grid item xs={6} sm={3}>
                  <RHFTextField
                    name={`items.${i}.durationDays`}
                    label={t('rx.duration')}
                    size="small"
                    type="number"
                    inputProps={{ dir: 'ltr' }}
                  />
                </Grid>
                <Grid item xs={12}>
                  <RHFTextField
                    name={`items.${i}.instructions`}
                    label={t('rx.instructions')}
                    size="small"
                    maxLength={300}
                  />
                </Grid>
              </Grid>
            </Box>
          ))}
          <Button
            variant="outlined"
            startIcon={<Plus size={16} />}
            onClick={() =>
              append({ name: '', dose: '', frequency: '', durationDays: '', instructions: '' })
            }
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('rx.addFree')}
          </Button>
          {form.formState.errors.items && fields.length === 0 && (
            <Alert severity="error">{t('rx.needItems')}</Alert>
          )}
          <RHFTextField name="notes" label={t('rx.notes')} multiline minRows={2} maxLength={1000} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

function SignatureImg({ fileId, alt }: { fileId?: string; alt: string }) {
  const url = useFileUrl(fileId);
  return url.data ? (
    <img src={url.data} alt={alt} style={{ maxHeight: 70, maxWidth: 160 }} />
  ) : null;
}

function RxPrintDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation('clinical');
  const { t: tc } = useTranslation();
  const specialtyName = useSpecialtyName();
  const q = useQuery({ queryKey: ['rx-print', id], queryFn: () => fetchRxPrint(id) });
  const d = q.data;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogContent>
        {!d ? (
          q.error ? (
            <ErrorState error={q.error} compact />
          ) : (
            <PageSkeleton rows={4} />
          )
        ) : (
          <PrintArea>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
              <Box>
                <Typography variant="h4">{d.clinic?.name}</Typography>
                <Typography variant="body2">
                  {[d.clinic?.addressLine1, d.clinic?.phone].filter(Boolean).join(' · ')}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'end' }}>
                <Typography variant="h5">{t('rx.printTitle')}</Typography>
                <Typography variant="body2" dir="ltr">
                  {d.prescription.number}
                </Typography>
                <Typography variant="body2">
                  {formatDate(d.prescription.createdAt, i18n.language)}
                </Typography>
              </Box>
            </Stack>
            <Divider sx={{ my: 3 }} />
            <Typography variant="body1">
              <b>{t('rx.patient')}:</b> {d.patient.fullName} · {d.patient.fileNumber}
              {d.patient.dateOfBirth
                ? ` · ${formatDate(d.patient.dateOfBirth, i18n.language)}`
                : ''}
            </Typography>
            <Typography variant="h3" sx={{ mt: 3, fontFamily: 'serif' }}>
              Rx
            </Typography>
            <Stack spacing={2} sx={{ mt: 2 }}>
              {d.prescription.items.map((it, i) => (
                <Box key={i}>
                  <Typography variant="subtitle1" fontWeight={700} dir="auto">
                    {i + 1}. {it.name}
                  </Typography>
                  <Typography variant="body2" dir="auto">
                    {[
                      it.dose,
                      it.frequency,
                      it.durationDays ? t('rx.days', { count: it.durationDays }) : '',
                      it.instructions,
                    ]
                      .filter(Boolean)
                      .join(' — ')}
                  </Typography>
                </Box>
              ))}
            </Stack>
            {d.prescription.notes && (
              <Typography variant="body2" sx={{ mt: 3 }} dir="auto">
                {d.prescription.notes}
              </Typography>
            )}
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="flex-end"
              sx={{ mt: 8 }}
            >
              <Box>
                <Typography variant="body2">
                  <b>{d.dentist?.name}</b>
                </Typography>
                {d.dentist?.primarySpecialty && (
                  <Typography variant="caption" display="block">
                    {specialtyName(d.dentist.primarySpecialty)}
                  </Typography>
                )}
                {d.dentist?.licenseNumber && (
                  <Typography variant="caption">
                    {t('rx.license', { number: d.dentist.licenseNumber })}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={3}>
                <SignatureImg fileId={d.dentist?.signatureFileId} alt={t('rx.signature')} />
                <SignatureImg fileId={d.dentist?.stampFileId} alt={t('rx.stamp')} />
              </Stack>
            </Stack>
          </PrintArea>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.close')}</Button>
        <Button
          variant="contained"
          startIcon={<Printer size={16} />}
          onClick={() => window.print()}
          disabled={!d}
        >
          {tc('actions.print')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- lab orders (07 §8) ---------------- */

function useLabColumns(onOpen: (l: LabOrder) => void, withPatient: boolean): Column<LabOrder>[] {
  const { t, i18n } = useTranslation('clinical');
  const notify = useNotify();
  const confirm = useConfirm();
  const muts = useLabMutations();
  const { can } = usePermission();
  const move = async (l: LabOrder, to: LabStatus) => {
    let reason: string | undefined;
    let cost: number | undefined;
    if (to === 'remake' || to === 'cancelled') {
      const r = await confirm({
        title: t(`lab.to.${to}`),
        reason: { label: t('lab.reason'), required: to === 'remake', max: 300 },
        destructive: to === 'cancelled',
      });
      if (!r.confirmed) return;
      reason = r.reason;
    }
    if (to === 'received') {
      const r = await confirm({
        title: t('lab.receivedTitle'),
        body: t('lab.costHint'),
        reason: { label: t('lab.costLabel'), max: 12 },
      });
      if (!r.confirmed) return;
      const n = Number((r.reason ?? '').replace(/[^\d.]/g, ''));
      if (r.reason && Number.isFinite(n)) cost = Math.round(n * 1000);
    }
    await muts.status
      .mutateAsync({
        id: l.id,
        to,
        ...(reason ? { reason } : {}),
        ...(cost !== undefined ? { cost } : {}),
      })
      .then(() => notify.success(t('lab.updated')), notify.error);
  };
  return [
    {
      field: 'number',
      headerName: t('lab.number'),
      width: 130,
      renderCell: ({ row }) => (
        <Button size="small" onClick={() => onOpen(row)} sx={{ direction: 'ltr' }}>
          {row.number}
        </Button>
      ),
    },
    ...(withPatient
      ? [
          {
            field: 'patient',
            headerName: t('lab.patient'),
            flex: 1.2,
            minWidth: 180,
            sortable: false,
            renderCell: ({ row }: { row: LabOrder }) =>
              row.patient ? (
                <RouterLink to={`/clinic/patients/${row.patient.id}/lab`}>
                  {row.patient.fullName}
                </RouterLink>
              ) : null,
          } as Column<LabOrder>,
        ]
      : []),
    { field: 'labName', headerName: t('lab.lab'), flex: 1, minWidth: 140 },
    {
      field: 'items',
      headerName: t('lab.items'),
      flex: 1.2,
      minWidth: 160,
      sortable: false,
      valueGetter: (_v, row) =>
        row.items
          .map(
            (i) =>
              `${t(`lab.types.${i.type}`)}${i.toothNumbers.length ? ` (${i.toothNumbers.join(',')})` : ''}`,
          )
          .join(', '),
    },
    {
      field: 'dueDate',
      headerName: t('lab.due'),
      width: 130,
      valueGetter: (_v, row) => (row.dueDate ? formatDate(row.dueDate, i18n.language, 'll') : '—'),
    },
    {
      field: 'status',
      headerName: t('lab.status'),
      width: 130,
      renderCell: ({ row }) => (
        <StatusChip status={row.status} label={t(`lab.statuses.${row.status}`)} />
      ),
    },
    {
      field: 'cost',
      headerName: t('lab.cost'),
      width: 110,
      renderCell: ({ row }) => (row.cost ? <MoneyText value={row.cost} /> : '—'),
    },
    {
      field: 'actions',
      headerName: '',
      minWidth: 200,
      flex: 1,
      sortable: false,
      renderCell: ({ row }) =>
        can('clinical.labOrder.manage') ? (
          <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
            {LAB_FLOW[row.status].map((to) => (
              <Button
                key={to}
                size="small"
                color={to === 'cancelled' || to === 'remake' ? 'error' : 'primary'}
                onClick={() => void move(row, to)}
              >
                {t(`lab.to.${to}`)}
              </Button>
            ))}
          </Stack>
        ) : null,
    },
  ];
}

export function LabTab() {
  const { t } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const list = useLabOrders({ patientId: patient.id });
  const { can } = usePermission();
  const [editing, setEditing] = useState<LabOrder | 'new' | null>(null);
  const columns = useLabColumns((l) => setEditing(l), false);
  return (
    <Stack spacing={4}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('lab.title')}</Typography>
        {can('clinical.labOrder.manage') && (
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setEditing('new')}
          >
            {t('lab.new')}
          </Button>
        )}
      </Stack>
      <DataTable
        rows={list.data ?? []}
        columns={columns}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        clientSide
        empty={<EmptyState title={t('lab.empty')} />}
      />
      {editing && (
        <LabDrawer
          order={editing === 'new' ? null : editing}
          patientId={patient.id}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

/** Clinic-wide lab cases (reception follows due dates). */
export function LabOrdersPage() {
  const { t } = useTranslation('clinical');
  const [status, setStatus] = useState<string>('open');
  const list = useLabOrders(
    status === 'open' ? { open: true } : status === 'all' ? {} : { status },
  );
  const [editing, setEditing] = useState<LabOrder | null>(null);
  const columns = useLabColumns((l) => setEditing(l), true);
  const today = todayLocal();
  const late = (list.data ?? []).filter(
    (l) =>
      l.dueDate && l.dueDate < today && !['fitted', 'cancelled', 'received'].includes(l.status),
  ).length;
  return (
    <Box>
      <PageHeader title={t('lab.pageTitle')} subtitle={t('lab.pageSubtitle')} />
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 4 }}>
        <TextField
          select
          size="small"
          label={t('lab.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="open">{t('lab.open')}</MenuItem>
          <MenuItem value="all">{t('lab.all')}</MenuItem>
          {LAB_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {t(`lab.statuses.${s}`)}
            </MenuItem>
          ))}
        </TextField>
        {late > 0 && (
          <Alert severity="warning" sx={{ py: 0 }}>
            {t('lab.late', { count: late })}
          </Alert>
        )}
      </Stack>
      <DataTable
        rows={list.data ?? []}
        columns={columns}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        clientSide
        empty={<EmptyState title={t('lab.empty')} />}
      />
      {editing && (
        <LabDrawer order={editing} patientId={editing.patientId} onClose={() => setEditing(null)} />
      )}
    </Box>
  );
}

const labSchema = z.object({
  labName: requiredText(120),
  dueDate: optional(dateOnly()),
  notes: optional(freeText(1000)),
  cost: z.number().int().min(0).optional(),
  items: z
    .array(
      z.object({
        type: z.enum(LAB_ITEM_TYPES, { message: 'required' }),
        teeth: z.string().max(120),
        material: optional(freeText(60)),
        shade: optional(freeText(20)),
      }),
    )
    .min(1, { message: 'too_few' })
    .max(20),
});
type LabValues = z.input<typeof labSchema>;

function LabDrawer({
  order,
  patientId,
  onClose,
}: {
  order: LabOrder | null;
  patientId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('clinical');
  const notify = useNotify();
  const muts = useLabMutations();
  const closed = order ? ['fitted', 'cancelled'].includes(order.status) : false;
  const currency = useCurrency();
  const form = useAppForm<LabValues>({
    schema: labSchema,
    defaultValues: {
      labName: order?.labName ?? '',
      dueDate: order?.dueDate ?? '',
      notes: order?.notes ?? '',
      cost: order?.cost ?? 0,
      items: order?.items.map((i) => ({
        type: i.type as (typeof LAB_ITEM_TYPES)[number],
        teeth: i.toothNumbers.join(', '),
        material: i.material ?? '',
        shade: i.shade ?? '',
      })) ?? [{ type: 'crown', teeth: '', material: '', shade: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={order ? `${t('lab.order')} ${order.number}` : t('lab.new')}
      formId="lab-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={620}
    >
      <Form
        form={form}
        name="clinical.labOrder"
        id="lab-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof labSchema>;
          const items = v.items.map((i) => ({
            type: i.type,
            toothNumbers: toothList(i.teeth),
            ...(i.material ? { material: i.material } : {}),
            ...(i.shade ? { shade: i.shade } : {}),
          }));
          if (order)
            await muts.update.mutateAsync({
              id: order.id,
              version: order.version,
              labName: v.labName,
              items,
              ...(v.dueDate ? { dueDate: v.dueDate } : {}),
              notes: v.notes ?? '',
              ...(v.cost !== undefined ? { cost: v.cost } : {}),
            });
          else
            await muts.create.mutateAsync({
              patientId,
              labName: v.labName,
              items,
              ...(v.dueDate ? { dueDate: v.dueDate } : {}),
              ...(v.notes ? { notes: v.notes } : {}),
            });
          notify.success(t('lab.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          {closed && <Alert severity="info">{t('lab.closed')}</Alert>}
          <Grid container spacing={3}>
            <Grid item xs={12} sm={7}>
              <RHFTextField
                name="labName"
                label={t('lab.lab')}
                required
                maxLength={120}
                disabled={closed}
              />
            </Grid>
            <Grid item xs={12} sm={5}>
              <RHFDate
                name="dueDate"
                label={t('lab.due')}
                minDate={order ? undefined : todayLocal()}
                disabled={closed}
              />
            </Grid>
          </Grid>
          {fields.map((f, i) => (
            <Grid container spacing={2} key={f.id} alignItems="center">
              <Grid item xs={12} sm={4}>
                <RHFSelect
                  name={`items.${i}.type`}
                  label={t('lab.type')}
                  required
                  options={LAB_ITEM_TYPES.map((x) => ({ value: x, label: t(`lab.types.${x}`) }))}
                  disabled={closed}
                />
              </Grid>
              <Grid item xs={4} sm={2.5}>
                <RHFTeethPicker
                  name={`items.${i}.teeth`}
                  label={t('procedures.teeth')}
                  disabled={closed}
                />
              </Grid>
              <Grid item xs={4} sm={2.5}>
                <RHFTextField
                  name={`items.${i}.material`}
                  label={t('lab.material')}
                  size="small"
                  maxLength={60}
                  disabled={closed}
                />
              </Grid>
              <Grid item xs={3} sm={2}>
                <RHFTextField
                  name={`items.${i}.shade`}
                  label={t('lab.shade')}
                  size="small"
                  maxLength={20}
                  disabled={closed}
                />
              </Grid>
              <Grid item xs={1}>
                <IconButton
                  aria-label={t('rx.remove')}
                  onClick={() => remove(i)}
                  disabled={closed || fields.length === 1}
                >
                  <Trash2 size={16} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          {!closed && (
            <Button
              startIcon={<Plus size={16} />}
              onClick={() => append({ type: 'crown', teeth: '', material: '', shade: '' })}
              sx={{ alignSelf: 'flex-start' }}
            >
              {t('lab.addItem')}
            </Button>
          )}
          {order && (
            <RHFMoney currency={currency} name="cost" label={t('lab.cost')} disabled={closed} />
          )}
          <RHFTextField
            name="notes"
            label={t('lab.notes')}
            multiline
            minRows={2}
            maxLength={1000}
            disabled={closed}
          />
          {order && (
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t('lab.history')}
              </Typography>
              {order.statusHistory.map((h, i) => (
                <Typography key={i} variant="body2">
                  {t(`lab.statuses.${h.to}`)} · {formatDateTime(h.at, 'en')}
                  {h.reason ? ` — ${h.reason}` : ''}
                </Typography>
              ))}
            </Box>
          )}
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- consents (07 §10) ---------------- */

export function ConsentsTab() {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const list = useConsents(patient.id);
  const { can } = usePermission();
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const shown = (list.data ?? []).find((c) => c.id === viewing);
  if (list.isLoading) return <PageSkeleton rows={4} />;
  if (list.error) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  return (
    <Stack spacing={4}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('consent.title')}</Typography>
        {(can('clinical.chart.update') || can('clinical.consent.manage')) && (
          <Button
            variant="contained"
            startIcon={<FileSignature size={16} />}
            onClick={() => setAdding(true)}
          >
            {t('consent.new')}
          </Button>
        )}
      </Stack>
      {(list.data ?? []).length === 0 ? (
        <EmptyState title={t('consent.empty')} />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('consent.form')}</TableCell>
              <TableCell>{t('consent.signer')}</TableCell>
              <TableCell>{t('consent.signedAt')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(list.data ?? []).map((c) => (
              <TableRow key={c.id} hover>
                <TableCell dir="auto">{c.title}</TableCell>
                <TableCell dir="auto">{c.signerName || patient.fullName}</TableCell>
                <TableCell>{formatDateTime(c.signedAt, i18n.language)}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => setViewing(c.id)}>
                    {t('consent.view')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {adding && <ConsentDialog onClose={() => setAdding(false)} />}
      {shown && (
        <Dialog open onClose={() => setViewing(null)} fullWidth maxWidth="md">
          <DialogContent>
            <PrintArea>
              <Typography variant="h5">{shown.title}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 3 }} dir="auto">
                {shown.renderedBody}
              </Typography>
              <Box sx={{ mt: 4 }}>
                <SignatureImg fileId={shown.signatureFileId} alt={t('consent.signature')} />
                <Typography variant="caption" display="block">
                  {shown.signerName || patient.fullName} ·{' '}
                  {formatDateTime(shown.signedAt, i18n.language)}
                </Typography>
              </Box>
            </PrintArea>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setViewing(null)}>{t('consent.close')}</Button>
            <Button
              variant="contained"
              startIcon={<Printer size={16} />}
              onClick={() => window.print()}
            >
              {t('consent.print')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}

/** Filled in by the server when signing; the rest are asked for in the dialog. */
const BUILT_IN = ['patient.name', 'patient.file', 'date', 'clinic'];

function ConsentDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('clinical');
  const { t: tc } = useTranslation();
  const { patient } = usePatientContext();
  const notify = useNotify();
  const templates = consentTemplatesApi.useAll();
  const sign = useSignConsent(patient.id);
  const [templateId, setTemplateId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [signer, setSigner] = useState(patient.fullName);
  const [signature, setSignature] = useState<string | null>(null);
  const tpl = (templates.data ?? []).find((x) => x.id === templateId);
  const placeholders = useMemo(
    () =>
      [
        ...new Set([...(tpl?.body ?? '').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!)),
      ].filter((k) => !BUILT_IN.includes(k)),
    [tpl],
  );
  const preview = (tpl?.body ?? '').replace(
    /\{\{\s*([\w.]+)\s*\}\}/g,
    (_m, k: string) =>
      (
        ({
          'patient.name': patient.fullName,
          'patient.file': patient.fileNumber,
          date: todayLocal(),
        }) as Record<string, string>
      )[k] ??
      (values[k] || `[${k}]`),
  );
  const missing = placeholders.some((k) => !values[k]?.trim());
  const submit = async () => {
    if (!tpl || !signature) return;
    await sign.mutateAsync({
      templateId: tpl.id,
      values,
      signature,
      signerName: signer.trim().slice(0, 120),
    });
    notify.success(t('consent.saved'));
    onClose();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('consent.new')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          {(templates.data ?? []).length === 0 && !templates.isLoading && (
            <Alert severity="info">
              {t('consent.noTemplates')}{' '}
              <RouterLink to="/clinic/settings/consents">{t('consent.manageTemplates')}</RouterLink>
            </Alert>
          )}
          <TextField
            select
            label={t('consent.form')}
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
          >
            {(templates.data ?? [])
              .filter((x) => x.isActive)
              .map((x) => (
                <MenuItem key={x.id} value={x.id}>
                  {x.title}
                </MenuItem>
              ))}
          </TextField>
          {placeholders.map((k) => (
            <TextField
              key={k}
              size="small"
              label={k}
              required
              value={values[k] ?? ''}
              onChange={(e) => setValues({ ...values, [k]: e.target.value.slice(0, 300) })}
              inputProps={{ dir: 'auto' }}
            />
          ))}
          {tpl && (
            <Box
              sx={{
                p: 3,
                borderRadius: 2,
                bgcolor: 'action.hover',
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }} dir="auto">
                {preview}
              </Typography>
            </Box>
          )}
          <TextField
            size="small"
            label={t('signature.signer')}
            value={signer}
            onChange={(e) => setSigner(e.target.value)}
            inputProps={{ maxLength: 120, dir: 'auto' }}
          />
          <SignaturePad onChange={setSignature} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!tpl || !signature || missing || sign.isPending}
          onClick={() => void submit().catch(notify.error)}
        >
          {t('consent.sign')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
