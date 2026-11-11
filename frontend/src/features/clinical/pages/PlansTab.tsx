import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CalendarPlus,
  CheckCircle2,
  FileSignature,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  Send,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { usePolicies } from '@/features/patients/api/patients';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { useQuickBook } from '@/features/scheduling/components/quickBookStore';
import { useSchedulingLookups } from '@/features/scheduling/components/lookups';
import { formatDate } from '@/lib/dates';
import {
  dateOnly,
  freeText,
  isValidTooth,
  objectId,
  optional,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency, useFormatMoney } from '@/shared/components/MoneyText';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFMoney } from '@/shared/form/RHFInputs';
import { RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { usePlanMutations, usePlans, useProcedureMutations, type TreatmentPlan } from '../api';
import { PrintArea, SignaturePad, toothList, usePlanDentists, useProcedureLookup } from '../components/shared';
import { RHFSurfacesPicker, RHFTeethPicker } from '../components/TeethPicker';
import { useSpecialtyName } from '@/features/staff/components/SpecialtyFields';

const PHASES = ['urgent', 'phase1', 'phase2', 'maintenance'];

/** Patient workspace → Treatment plans (07 §3). */
export function PlansTab() {
  const { t } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const plans = usePlans(patient.id);
  const { can } = usePermission();
  const [editing, setEditing] = useState<{
    plan?: TreatmentPlan;
    alternativeOf?: TreatmentPlan;
  } | null>(null);

  if (plans.isLoading) return <PageSkeleton rows={5} />;
  if (plans.error) return <ErrorState error={plans.error} onRetry={() => void plans.refetch()} />;
  const list = plans.data ?? [];
  return (
    <Stack spacing={4}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('plans.title')}</Typography>
        {can('clinical.treatmentPlan.create') && (
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing({})}>
            {t('plans.newPlan')}
          </Button>
        )}
      </Stack>
      {list.length === 0 ? (
        <EmptyState title={t('plans.empty')} description={t('plans.emptyHint')} />
      ) : (
        list.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            onEdit={() => setEditing({ plan: p })}
            onAlternative={() => setEditing({ alternativeOf: p })}
          />
        ))
      )}
      {editing && (
        <PlanEditor
          plan={editing.plan}
          alternativeOf={editing.alternativeOf}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

function PlanCard({
  plan,
  onEdit,
  onAlternative,
}: {
  plan: TreatmentPlan;
  onEdit: () => void;
  onAlternative: () => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const notify = useNotify();
  const confirm = useConfirm();
  const { can } = usePermission();
  const procs = useProcedureLookup();
  const sched = useSchedulingLookups();
  const muts = usePlanMutations(patient.id);
  const procMuts = useProcedureMutations(patient.id);
  const openQuickBook = useQuickBook((s) => s.open);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const open = !['completed', 'cancelled', 'rejected'].includes(plan.status);
  const phaseName = (i: number) => {
    const ph = plan.phases[i]?.name ?? 'phase1';
    return PHASES.includes(ph) ? t(`plans.phases.${ph}`) : ph;
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
          <Box>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h5" dir="auto">
                {plan.title || t('plans.untitled')}
              </Typography>
              <StatusChip status={plan.status} />
              {plan.alternativeLabel && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t('plans.option', { label: plan.alternativeLabel })}
                />
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {plan.number} · {sched.dentistById.get(plan.dentistId)?.name ?? ''} ·{' '}
              {formatDate(plan.createdAt, i18n.language)}
              {plan.validUntil
                ? ` · ${t('plans.validUntil', { date: formatDate(plan.validUntil, i18n.language) })}`
                : ''}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            {plan.status === 'draft' && can('clinical.treatmentPlan.update') && (
              <Button size="small" startIcon={<Pencil size={14} />} onClick={onEdit}>
                {t('plans.edit')}
              </Button>
            )}
            {plan.status === 'draft' && can('clinical.treatmentPlan.present') && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<Send size={14} />}
                onClick={() => run(muts.present.mutateAsync({ id: plan.id }), t('plans.presented'))}
              >
                {t('plans.present')}
              </Button>
            )}
            {['draft', 'presented'].includes(plan.status) &&
              can('clinical.treatmentPlan.present') && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<FileSignature size={14} />}
                  onClick={() => setAccepting(true)}
                >
                  {t('plans.accept')}
                </Button>
              )}
            <IconButton
              size="small"
              aria-label={t('plans.more')}
              onClick={(e) => setMenu(e.currentTarget)}
            >
              <MoreVertical size={18} />
            </IconButton>
            <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
              <MenuItem onClick={() => (setMenu(null), setPrinting(true))}>
                <Printer size={16} style={{ marginInlineEnd: 8 }} />
                {t('plans.print')}
              </MenuItem>
              {can('clinical.treatmentPlan.create') && open && (
                <MenuItem onClick={() => (setMenu(null), onAlternative())}>
                  <Plus size={16} style={{ marginInlineEnd: 8 }} />
                  {t('plans.alternative')}
                </MenuItem>
              )}
              {['presented', 'rejected'].includes(plan.status) &&
                can('clinical.treatmentPlan.update') && (
                  <MenuItem
                    onClick={() => (
                      setMenu(null),
                      run(
                        muts.status.mutateAsync({ id: plan.id, to: 'draft' }),
                        t('plans.backToDraft'),
                      )
                    )}
                  >
                    {t('plans.backToDraft')}
                  </MenuItem>
                )}
              {['presented', 'draft'].includes(plan.status) &&
                can('clinical.treatmentPlan.update') && (
                  <MenuItem
                    onClick={() => (
                      setMenu(null),
                      run(
                        muts.status.mutateAsync({ id: plan.id, to: 'rejected' }),
                        t('plans.rejected'),
                      )
                    )}
                  >
                    {t('plans.reject')}
                  </MenuItem>
                )}
              {open && can('clinical.treatmentPlan.update') && (
                <MenuItem
                  sx={{ color: 'error.main' }}
                  onClick={async () => {
                    setMenu(null);
                    const r = await confirm({
                      title: t('plans.cancelTitle', { number: plan.number }),
                      destructive: true,
                      reason: { label: t('plans.reason'), max: 300 },
                    });
                    if (r.confirmed)
                      run(
                        muts.status.mutateAsync({
                          id: plan.id,
                          to: 'cancelled',
                          ...(r.reason ? { reason: r.reason } : {}),
                        }),
                        t('plans.cancelled'),
                      );
                  }}
                >
                  <Trash2 size={16} style={{ marginInlineEnd: 8 }} />
                  {t('plans.cancel')}
                </MenuItem>
              )}
            </Menu>
          </Stack>
        </Stack>

        <Box sx={{ overflowX: 'auto', mt: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('plans.phase')}</TableCell>
                <TableCell>{t('procedures.procedure')}</TableCell>
                <TableCell>{t('procedures.teeth')}</TableCell>
                <TableCell align="right">{t('plans.qty')}</TableCell>
                <TableCell align="right">{t('plans.price')}</TableCell>
                <TableCell align="right">{t('plans.insurance')}</TableCell>
                <TableCell align="right">{t('plans.patientShare')}</TableCell>
                <TableCell>{t('plans.itemStatus')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {plan.items.map((it) => (
                <TableRow key={it.id} sx={{ opacity: it.status === 'rejected' ? 0.5 : 1 }}>
                  <TableCell>{phaseName(it.phaseIndex)}</TableCell>
                  <TableCell dir="auto">{procs.label(it.clinicProcedureId) || it.code}</TableCell>
                  <TableCell dir="ltr">
                    {it.toothNumbers.join(', ')}
                    {it.surfaces.length ? ` (${it.surfaces.join('')})` : ''}
                  </TableCell>
                  <TableCell align="right">{it.quantity}</TableCell>
                  <TableCell align="right">
                    <MoneyText value={it.unitPrice * it.quantity - it.discount} />
                  </TableCell>
                  <TableCell align="right">
                    <MoneyText value={it.insuranceEstimate} />
                  </TableCell>
                  <TableCell align="right">
                    <MoneyText value={it.patientEstimate} />
                  </TableCell>
                  <TableCell>
                    <StatusChip
                      status={
                        it.status === 'proposed'
                          ? 'pending'
                          : it.status === 'scheduled'
                            ? 'scheduled'
                            : it.status
                      }
                      label={t(`plans.itemStatuses.${it.status}`)}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {it.status === 'accepted' && can('scheduling.appointment.book') && (
                      <Tooltip title={t('plans.book')}>
                        <IconButton
                          size="small"
                          aria-label={t('plans.book')}
                          onClick={() =>
                            openQuickBook({
                              patientId: patient.id,
                              dentistId: plan.dentistId,
                              plannedItemIds: [it.id],
                              durationMin: procs.byId.get(it.clinicProcedureId)?.defaultDurationMin,
                            })
                          }
                        >
                          <CalendarPlus size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {['accepted', 'scheduled'].includes(it.status) &&
                      can('clinical.procedure.perform') && (
                        <Tooltip title={t('procedures.recordDone')}>
                          <IconButton
                            size="small"
                            aria-label={t('procedures.recordDone')}
                            onClick={async () => {
                              const r = await confirm({
                                title: t('plans.performTitle'),
                                body: procs.label(it.clinicProcedureId),
                              });
                              if (r.confirmed)
                                run(
                                  procMuts.perform.mutateAsync({
                                    treatmentPlanItemId: it.id,
                                    clinicProcedureId: it.clinicProcedureId,
                                    ...(it.appointmentId
                                      ? { appointmentId: it.appointmentId }
                                      : {}),
                                  }),
                                  t('procedures.recorded'),
                                );
                            }}
                          >
                            <Stethoscope size={16} />
                          </IconButton>
                        </Tooltip>
                      )}
                    {it.status === 'completed' && <CheckCircle2 size={16} color="green" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        <Totals plan={plan} />
        {plan.acceptance && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            {t('plans.acceptedBy', {
              name: plan.acceptance.signerName || patient.fullName,
              date: formatDate(plan.acceptance.at, i18n.language, 'lll'),
            })}
          </Typography>
        )}
      </CardContent>
      {accepting && <AcceptDialog plan={plan} onClose={() => setAccepting(false)} />}
      {printing && <PrintPlanDialog plan={plan} onClose={() => setPrinting(false)} />}
    </Card>
  );
}

function Totals({ plan }: { plan: TreatmentPlan }) {
  const { t } = useTranslation('clinical');
  return (
    <Stack
      direction="row"
      spacing={4}
      justifyContent="flex-end"
      sx={{ mt: 3 }}
      flexWrap="wrap"
      useFlexGap
    >
      <Total label={t('plans.gross')} value={plan.totals.gross} />
      <Total label={t('plans.discount')} value={plan.totals.discount} />
      <Total label={t('plans.insurance')} value={plan.totals.insurance} />
      <Total label={t('plans.patientShare')} value={plan.totals.patient} strong />
    </Stack>
  );
}
function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <Box sx={{ textAlign: 'end' }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant={strong ? 'h6' : 'body1'} fontWeight={strong ? 800 : 600}>
        <MoneyText value={value} />
      </Typography>
    </Box>
  );
}

function AcceptDialog({ plan, onClose }: { plan: TreatmentPlan; onClose: () => void }) {
  const { t } = useTranslation('clinical');
  const { t: tc } = useTranslation();
  const { patient } = usePatientContext();
  const notify = useNotify();
  const procs = useProcedureLookup();
  const muts = usePlanMutations(patient.id);
  const [chosen, setChosen] = useState<Set<string>>(new Set(plan.items.map((i) => i.id)));
  const [signature, setSignature] = useState<string | null>(null);
  const [signer, setSigner] = useState(patient.fullName);
  const submit = async () => {
    if (!signature || chosen.size === 0) return;
    await muts.accept.mutateAsync({
      id: plan.id,
      itemIds: [...chosen],
      signature,
      signerName: signer.trim().slice(0, 120),
    });
    notify.success(t('plans.acceptedDone'));
    onClose();
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('plans.acceptTitle', { number: plan.number })}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('plans.acceptHint')}
          </Typography>
          <Box>
            {plan.items.map((it) => (
              <Stack key={it.id} direction="row" alignItems="center" spacing={1}>
                <Checkbox
                  checked={chosen.has(it.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(it.id);
                    else next.delete(it.id);
                    setChosen(next);
                  }}
                  inputProps={{ 'aria-label': procs.label(it.clinicProcedureId) }}
                />
                <Typography variant="body2" sx={{ flex: 1 }} dir="auto">
                  {procs.label(it.clinicProcedureId) || it.code}{' '}
                  {it.toothNumbers.length ? `· ${it.toothNumbers.join(', ')}` : ''}
                </Typography>
                <MoneyText value={it.patientEstimate} />
              </Stack>
            ))}
          </Box>
          {chosen.size === 0 && <Alert severity="warning">{t('plans.pickItems')}</Alert>}
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
          onClick={() => void submit().catch(notify.error)}
          disabled={!signature || chosen.size === 0 || muts.accept.isPending}
        >
          {t('plans.acceptSign')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PrintPlanDialog({ plan, onClose }: { plan: TreatmentPlan; onClose: () => void }) {
  const { t, i18n } = useTranslation('clinical');
  const { t: tc } = useTranslation();
  const { patient } = usePatientContext();
  const procs = useProcedureLookup();
  const sched = useSchedulingLookups();
  const specialtyName = useSpecialtyName();
  const fmt = useFormatMoney();
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogContent>
        <PrintArea>
          <Typography variant="h4">{t('plans.printTitle')}</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            {patient.fullName} · {patient.fileNumber} · {plan.number} ·{' '}
            {formatDate(plan.presentedAt ?? plan.createdAt, i18n.language)}
          </Typography>
          <Typography variant="body2">
            {t('plans.dentist')}: {sched.dentistById.get(plan.dentistId)?.name ?? ''}
            {sched.dentistById.get(plan.dentistId)?.primarySpecialty
              ? ` · ${specialtyName(sched.dentistById.get(plan.dentistId)!.primarySpecialty!)}`
              : ''}
          </Typography>
          <Divider sx={{ my: 3 }} />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('procedures.procedure')}</TableCell>
                <TableCell>{t('procedures.teeth')}</TableCell>
                <TableCell align="right">{t('plans.price')}</TableCell>
                <TableCell align="right">{t('plans.insurance')}</TableCell>
                <TableCell align="right">{t('plans.patientShare')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plan.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{procs.label(it.clinicProcedureId) || it.code}</TableCell>
                  <TableCell dir="ltr">{it.toothNumbers.join(', ')}</TableCell>
                  <TableCell align="right">
                    {fmt(it.unitPrice * it.quantity - it.discount)}
                  </TableCell>
                  <TableCell align="right">{fmt(it.insuranceEstimate)}</TableCell>
                  <TableCell align="right">{fmt(it.patientEstimate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Totals plan={plan} />
          {plan.validUntil && (
            <Typography variant="body2" sx={{ mt: 3 }}>
              {t('plans.validUntil', { date: formatDate(plan.validUntil, i18n.language) })}
            </Typography>
          )}
          <Typography variant="caption" sx={{ display: 'block', mt: 3 }}>
            {t('plans.printTerms')}
          </Typography>
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 8 }}>
            <Typography variant="body2">{t('plans.patientSignature')}: ____________</Typography>
            <Typography variant="body2">{t('plans.dentistSignature')}: ____________</Typography>
          </Stack>
        </PrintArea>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.close')}</Button>
        <Button
          variant="contained"
          startIcon={<Printer size={16} />}
          onClick={() => window.print()}
        >
          {tc('actions.print')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const itemSchema = z.object({
  id: optional(objectId()),
  phaseIndex: z.enum(['0', '1', '2', '3']),
  clinicProcedureId: objectId(),
  teeth: z
    .string()
    .max(120)
    .refine((v) => toothList(v).every(isValidTooth), {
      message: 'invalid_tooth',
    }),
  surfaces: z
    .string()
    .max(5)
    .regex(/^[MODBLIFP]*$/i, { message: 'invalid_surface' }),
  quantity: z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .int({ message: 'invalid' })
    .min(1, { message: 'too_small' })
    .max(32, { message: 'too_big' }),
  unitPrice: z.number().int().min(0).optional(),
  discount: z
    .number({ invalid_type_error: 'invalid_amount' })
    .int({ message: 'too_many_decimals' })
    .min(0, { message: 'invalid_amount' }),
});
const planSchema = z.object({
  title: optional(freeText(120)),
  insurancePolicyId: optional(objectId()),
  validUntil: optional(dateOnly()),
  alternativeLabel: optional(freeText(60)),
  notes: optional(freeText(2000)),
  items: z.array(itemSchema).min(1, { message: 'too_few' }).max(80),
  // Chosen once, when the plan is created; the owner and front desk are usually not dentists.
  dentistId: optional(objectId()),
});
/** A new plan must name its dentist. */
const newPlanSchema = planSchema.extend({ dentistId: objectId() });
type PlanValues = z.input<typeof planSchema>;

function PlanEditor({
  plan,
  alternativeOf,
  onClose,
}: {
  plan?: TreatmentPlan;
  alternativeOf?: TreatmentPlan;
  onClose: () => void;
}) {
  const { t } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const notify = useNotify();
  const { can } = usePermission();
  const procs = useProcedureLookup();
  const policies = usePolicies(patient.id);
  const muts = usePlanMutations(patient.id);
  const dentists = usePlanDentists();
  const canPrice = can('billing.invoice.discount');
  const currency = useCurrency();
  const form = useAppForm<PlanValues>({
    schema: plan ? planSchema : newPlanSchema,
    defaultValues: {
      dentistId: plan?.dentistId ?? alternativeOf?.dentistId ?? dentists.defaultId,
      title: plan?.title ?? alternativeOf?.title ?? '',
      insurancePolicyId:
        plan?.insurancePolicyId ?? policies.data?.find((p) => p.isPrimary)?.id ?? '',
      validUntil: plan?.validUntil ?? '',
      alternativeLabel: plan?.alternativeLabel ?? '',
      notes: plan?.notes ?? '',
      items: (plan?.items ?? []).map((i) => ({
        id: i.id,
        phaseIndex: String(Math.min(3, i.phaseIndex)) as '0',
        clinicProcedureId: i.clinicProcedureId,
        teeth: i.toothNumbers.join(', '),
        surfaces: i.surfaces.join(''),
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
      })),
    },
  });
  // The dentist list may arrive after the form opens: propose the default once it does.
  useEffect(() => {
    if (!plan && dentists.defaultId && !form.getValues('dentistId')) form.setValue('dentistId', dentists.defaultId);
  }, [plan, dentists.defaultId, form]);
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });
  const items = useWatch({ control: form.control, name: 'items' });

  const onSubmit = async (raw: PlanValues) => {
    const v = raw as z.output<typeof planSchema>;
    const payload = {
      title: v.title ?? '',
      insurancePolicyId: v.insurancePolicyId || null,
      ...(v.validUntil ? { validUntil: v.validUntil } : {}),
      ...(v.notes ? { notes: v.notes } : {}),
      ...(v.alternativeLabel ? { alternativeLabel: v.alternativeLabel } : {}),
      phases: PHASES.map((name, order) => ({ name, order })),
      items: v.items.map((i) => ({
        ...(i.id ? { id: i.id } : {}),
        phaseIndex: Number(i.phaseIndex),
        clinicProcedureId: i.clinicProcedureId,
        toothNumbers: toothList(i.teeth),
        surfaces: i.surfaces.toUpperCase().split(''),
        quantity: i.quantity,
        discount: i.discount,
        ...(canPrice && i.unitPrice !== undefined ? { unitPrice: i.unitPrice } : {}),
      })),
    };
    if (plan) await muts.update.mutateAsync({ id: plan.id, version: plan.version, ...payload });
    else
      await muts.create.mutateAsync({
        ...payload,
        dentistId: v.dentistId,
        ...(alternativeOf ? { alternativeOf: alternativeOf.id } : {}),
      });
    notify.success(t('plans.saved'));
    onClose();
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={
        plan
          ? t('plans.editTitle', { number: plan.number })
          : alternativeOf
            ? t('plans.alternativeTitle', { number: alternativeOf.number })
            : t('plans.newPlan')
      }
      subtitle={t('plans.editorHint')}
      formId="plan-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={860}
    >
      <Form form={form} name="clinical.plan" id="plan-form" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <Grid container spacing={3}>
            {!plan && (
              <Grid item xs={12} sm={6}>
                <RHFSelect
                  name="dentistId"
                  label={t('plans.dentist')}
                  required
                  disabled={Boolean(alternativeOf)}
                  options={dentists.options}
                />
              </Grid>
            )}
            <Grid item xs={12} sm={6}>
              <RHFTextField name="title" label={t('plans.planTitle')} maxLength={120} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect
                name="insurancePolicyId"
                label={t('plans.policy')}
                clearable
                options={(policies.data ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.insuranceCompanyName} · ${p.memberNumber}`,
                }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFDate name="validUntil" label={t('plans.validUntilLabel')} />
            </Grid>
            {(alternativeOf || plan?.alternativeGroupId) && (
              <Grid item xs={12} sm={6}>
                <RHFTextField
                  name="alternativeLabel"
                  label={t('plans.optionLabel')}
                  maxLength={60}
                />
              </Grid>
            )}
          </Grid>
          <Divider />
          {fields.map((f, i) => {
            const p = procs.byId.get(items?.[i]?.clinicProcedureId ?? '');
            return (
              <Box key={f.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <Grid container spacing={2} alignItems="flex-start">
                  <Grid item xs={12} md={5}>
                    <Controller
                      name={`items.${i}.clinicProcedureId`}
                      control={form.control}
                      render={({ field, fieldState }) => (
                        <Autocomplete
                          size="small"
                          options={procs.items}
                          value={procs.byId.get(field.value) ?? null}
                          onChange={(_e, v) => field.onChange(v?.id ?? '')}
                          getOptionLabel={(o) => procs.label(o)}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              name={field.name}
                              label={`${t('procedures.procedure')} *`}
                              error={Boolean(fieldState.error)}
                              helperText={
                                fieldState.error ? t('plans.procedureRequired') : undefined
                              }
                            />
                          )}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={6} md={2}>
                    <RHFTeethPicker
                      name={`items.${i}.teeth`}
                      label={t('procedures.teeth')}
                      required={p?.toothRequired}
                    />
                  </Grid>
                  <Grid item xs={6} md={1.5}>
                    <RHFSurfacesPicker
                      name={`items.${i}.surfaces`}
                      teethName={`items.${i}.teeth`}
                      label={t('procedures.surfaces')}
                      required={p?.surfacesRequired}
                    />
                  </Grid>
                  <Grid item xs={4} md={1}>
                    <RHFTextField
                      name={`items.${i}.quantity`}
                      label={t('plans.qty')}
                      size="small"
                      type="number"
                      inputProps={{ dir: 'ltr', min: 1 }}
                    />
                  </Grid>
                  <Grid item xs={8} md={2.5}>
                    <RHFSelect
                      name={`items.${i}.phaseIndex`}
                      label={t('plans.phase')}
                      options={PHASES.map((ph, idx) => ({
                        value: String(idx),
                        label: t(`plans.phases.${ph}`),
                      }))}
                    />
                  </Grid>
                  {canPrice && (
                    <>
                      <Grid item xs={6} md={3}>
                        <RHFMoney
                          currency={currency}
                          name={`items.${i}.unitPrice`}
                          label={t('plans.unitPrice')}
                          helperText={p ? t('plans.listPrice') : undefined}
                        />
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <RHFMoney
                          currency={currency}
                          name={`items.${i}.discount`}
                          label={t('plans.discount')}
                        />
                      </Grid>
                    </>
                  )}
                  <Grid
                    item
                    xs={12}
                    md={canPrice ? 6 : 12}
                    sx={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    {p && !canPrice && (
                      <Typography variant="body2" color="text.secondary">
                        <MoneyText value={p.price} />
                      </Typography>
                    )}
                    <IconButton aria-label={t('plans.removeItem')} onClick={() => remove(i)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </Grid>
                </Grid>
              </Box>
            );
          })}
          <Button
            variant="outlined"
            startIcon={<Plus size={16} />}
            onClick={() =>
              append({
                phaseIndex: '1',
                clinicProcedureId: '',
                teeth: '',
                surfaces: '',
                quantity: 1,
                discount: 0,
              })
            }
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('plans.addItem')}
          </Button>
          {form.formState.errors.items?.root || form.formState.errors.items?.message ? (
            <Alert severity="error">{t('plans.needItems')}</Alert>
          ) : null}
          <RHFTextField
            name="notes"
            label={t('plans.notes')}
            multiline
            minRows={2}
            maxLength={2000}
          />
          <Alert severity="info">{t('plans.estimateHint')}</Alert>
        </Stack>
      </Form>
    </FormDrawer>
  );
}
