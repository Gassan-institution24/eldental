import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { FileText, History, Pencil, Plus, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { formatDate, formatDateTime } from '@/lib/dates';
import {
  dateOnly,
  enumOf,
  freeText,
  money,
  optional,
  percent,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { openFile, useFileUrl } from '@/shared/hooks/useFileUrl';
import { useNotify } from '@/shared/hooks/useNotify';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  insuranceCompaniesApi,
  useDeleteDocument,
  useDeletePolicy,
  useDocuments,
  useMedicalHistory,
  useMedicalVersions,
  usePolicies,
  useSaveMedicalHistory,
  useSavePolicy,
  useTimeline,
  useUploadDocument,
  type FileItem,
  type Policy,
} from '../api/patients';
import { useAlertLabel } from '../utils';
import { usePatientContext } from './PatientWorkspace';

function Info({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <Box sx={{ py: 2 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography component="div" dir="auto">
        {value || '—'}
      </Typography>
    </Box>
  );
}

/* ---------------- overview ---------------- */

export function OverviewTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const scope = useFieldScope();
  const alertLabel = useAlertLabel();
  const medical = useMedicalHistory(p.id);
  const sixMonths = 182 * 86_400_000;
  const overdue = medical.data
    ? !medical.data.reviewedAt || Date.now() - Date.parse(medical.data.reviewedAt) > sixMonths
    : false;
  return (
    <Grid container spacing={5}>
      <Grid item xs={12} md={6}>
        <SectionCard title={t('overview.contact')}>
          {scope.canSee('phone') || scope.isMasked('phone') ? (
            <Info label={t('fields.phone')} value={<span dir="ltr">{p.phone}</span>} />
          ) : null}
          {scope.canSee('altPhone') && (
            <Info label={t('fields.altPhone')} value={<span dir="ltr">{p.altPhone}</span>} />
          )}
          {scope.canSee('email') && (
            <Info label={t('fields.email')} value={<span dir="ltr">{p.email}</span>} />
          )}
          {scope.canSee('address') && (
            <Info
              label={t('fields.addressLine1')}
              value={[p.address?.line1, p.address?.city].filter(Boolean).join('، ')}
            />
          )}
          {(scope.canSee('nationalId') || scope.isMasked('nationalId')) && (
            <Info label={t('fields.nationalId')} value={<span dir="ltr">{p.nationalId}</span>} />
          )}
          {p.dateOfBirth && (
            <Info
              label={t('fields.dateOfBirth')}
              value={formatDate(p.dateOfBirth, i18n.resolvedLanguage ?? 'ar')}
            />
          )}
        </SectionCard>
      </Grid>
      <Grid item xs={12} md={6}>
        <SectionCard title={t('medical.title')}>
          {overdue && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              {t('overview.reviewOverdue')}
            </Alert>
          )}
          {p.medicalAlerts.length === 0 ? (
            <Typography color="text.secondary">{t('overview.noAlerts')}</Typography>
          ) : (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              {p.medicalAlerts.map((a) => (
                <Chip
                  key={a}
                  color="error"
                  variant="outlined"
                  label={<span dir="auto">{alertLabel(a)}</span>}
                />
              ))}
            </Stack>
          )}
        </SectionCard>
        <SectionCard title={t('overview.family')}>
          {p.guardian ? (
            <>
              <Info label={t('fields.guardianName')} value={p.guardian.name} />
              <Info label={t('fields.relation')} value={p.guardian.relation} />
              <Info
                label={t('fields.guardianPhone')}
                value={<span dir="ltr">{p.guardian.phone}</span>}
              />
            </>
          ) : (
            <Typography color="text.secondary">—</Typography>
          )}
          {p.emergencyContact && (
            <Info
              label={t('sections.emergency')}
              value={`${p.emergencyContact.name} · ${p.emergencyContact.phone}`}
            />
          )}
        </SectionCard>
        <SectionCard title={t('overview.portal')}>
          <Chip
            icon={<ShieldCheck size={16} />}
            color={p.hasPortalAccount ? 'success' : 'default'}
            label={p.hasPortalAccount ? t('overview.portalLinked') : t('overview.portalNotLinked')}
          />
        </SectionCard>
      </Grid>
      {p.notes && (
        <Grid item xs={12}>
          <SectionCard title={t('fields.notes')}>
            <Typography sx={{ whiteSpace: 'pre-wrap' }} dir="auto">
              {p.notes}
            </Typography>
          </SectionCard>
        </Grid>
      )}
    </Grid>
  );
}

/* ---------------- medical history ---------------- */

const CONDITIONS = [
  'heart_disease',
  'hypertension',
  'diabetes',
  'asthma',
  'epilepsy',
  'bleeding_disorder',
  'anticoagulants',
  'bisphosphonates',
  'hepatitis',
  'hiv',
  'kidney_disease',
  'thyroid',
  'cancer_treatment',
  'pregnancy',
  'smoker',
  'pacemaker',
] as const;
const medSchema = z.object({
  conditions: z.array(z.string()),
  medications: optional(freeText(1000)),
  allergies: z.array(
    z.object({
      substance: z.string().trim().min(1, { message: 'required' }).max(80, { message: 'too_long' }),
      reaction: optional(freeText(120)),
      severity: enumOf(['mild', 'moderate', 'severe']),
    }),
  ),
  notes: optional(freeText(2000)),
  reviewed: z.boolean(),
});
type Med = z.input<typeof medSchema>;

export function MedicalTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const q = useMedicalHistory(p.id);
  const [editing, setEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const versions = useMedicalVersions(p.id, showVersions);
  const save = useSaveMedicalHistory(p.id);
  const notify = useNotify();
  const h = q.data;
  const form = useAppForm<Med>({
    schema: medSchema,
    values: {
      conditions: h?.conditions ?? [],
      medications: h?.medications ?? '',
      allergies: h?.allergies ?? [],
      notes: h?.notes ?? '',
      reviewed: false,
    },
    defaultValues: { conditions: [], allergies: [], reviewed: false },
  });
  const allergies = useFieldArray({ control: form.control, name: 'allergies' });

  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const onSubmit = async (v: Med) => {
    const saved = await save.mutateAsync(v as unknown as Record<string, unknown>);
    notify.success(t('medical.saved', { n: saved.version }));
    setEditing(false);
  };

  if (editing) {
    return (
      <Form form={form} name="patient.medicalHistory" onSubmit={onSubmit} guardUnsaved>
        <SectionCard title={t('medical.conditions')}>
          <Grid container>
            {CONDITIONS.map((c) => (
              <Grid item xs={12} sm={6} md={4} key={c}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={form.watch('conditions').includes(c)}
                      onChange={(e) => {
                        const cur = form.getValues('conditions');
                        form.setValue(
                          'conditions',
                          e.target.checked ? [...cur, c] : cur.filter((x) => x !== c),
                          { shouldDirty: true },
                        );
                      }}
                    />
                  }
                  label={t(`medical.condition.${c}`)}
                />
              </Grid>
            ))}
          </Grid>
        </SectionCard>
        <SectionCard
          title={t('medical.allergies')}
          actions={
            <Button
              startIcon={<Plus size={16} />}
              onClick={() =>
                allergies.append({ substance: '', reaction: '', severity: 'moderate' })
              }
            >
              {t('medical.addAllergy')}
            </Button>
          }
        >
          {allergies.fields.length === 0 && (
            <Typography color="text.secondary">{t('medical.noAllergies')}</Typography>
          )}
          {allergies.fields.map((f, i) => (
            <Grid container spacing={3} key={f.id} sx={{ mb: 3 }} alignItems="flex-start">
              <Grid item xs={12} sm={4}>
                <RHFTextField
                  name={`allergies.${i}.substance`}
                  label={t('medical.substance')}
                  required
                />
              </Grid>
              <Grid item xs={12} sm={4}>
                <RHFTextField name={`allergies.${i}.reaction`} label={t('medical.reaction')} />
              </Grid>
              <Grid item xs={10} sm={3}>
                <RHFSelect
                  name={`allergies.${i}.severity`}
                  label={t('medical.severity')}
                  options={(['mild', 'moderate', 'severe'] as const).map((s) => ({
                    value: s,
                    label: t(`medical.severities.${s}`),
                  }))}
                />
              </Grid>
              <Grid item xs={2} sm={1}>
                <IconButton
                  onClick={() => allergies.remove(i)}
                  aria-label={t('common:actions.remove')}
                >
                  <X size={18} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
        </SectionCard>
        <SectionCard
          title={t('medical.medications')}
          footer={
            <>
              <Button onClick={() => setEditing(false)}>{t('common:actions.cancel')}</Button>
              <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
                {t('common:actions.save')}
              </Button>
            </>
          }
        >
          <Stack spacing={4}>
            <RHFTextField
              name="medications"
              label={t('medical.medications')}
              multiline
              minRows={2}
              maxLength={1000}
            />
            <RHFTextField
              name="notes"
              label={t('medical.notes')}
              multiline
              minRows={2}
              maxLength={2000}
            />
            <RHFCheckbox name="reviewed" label={t('medical.reviewed')} />
          </Stack>
        </SectionCard>
      </Form>
    );
  }

  return (
    <SectionCard
      title={t('medical.title')}
      subtitle={
        h
          ? `${t('medical.version', { n: h.version })} · ${t('medical.updatedBy', { date: formatDateTime(h.createdAt, i18n.resolvedLanguage ?? 'ar') })}`
          : undefined
      }
      actions={
        <Stack direction="row" spacing={1}>
          {h && (
            <Button startIcon={<History size={16} />} onClick={() => setShowVersions((v) => !v)}>
              {t('medical.versions')}
            </Button>
          )}
          {can('patients.medicalHistory.update') && (
            <Button
              variant="contained"
              startIcon={<Pencil size={16} />}
              onClick={() => setEditing(true)}
            >
              {t('medical.edit')}
            </Button>
          )}
        </Stack>
      }
    >
      {!h ? (
        <EmptyState title={t('medical.none')} description={t('medical.noneHint')} compact />
      ) : (
        <Stack spacing={5}>
          <Typography variant="body2" color={h.reviewedAt ? 'success.main' : 'warning.main'}>
            {h.reviewedAt
              ? t('medical.reviewedAt', {
                  date: formatDate(h.reviewedAt, i18n.resolvedLanguage ?? 'ar'),
                })
              : t('medical.notReviewed')}
          </Typography>
          <Box>
            <Typography fontWeight={700} sx={{ mb: 2 }}>
              {t('medical.conditions')}
            </Typography>
            {h.conditions.length ? (
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {h.conditions.map((c) => (
                  <Chip key={c} label={t(`medical.condition.${c}`)} />
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">{t('medical.noConditions')}</Typography>
            )}
          </Box>
          <Box>
            <Typography fontWeight={700} sx={{ mb: 2 }}>
              {t('medical.allergies')}
            </Typography>
            {h.allergies.length ? (
              <Stack spacing={1}>
                {h.allergies.map((a) => (
                  <Stack key={a.substance} direction="row" spacing={2} alignItems="center">
                    <Chip
                      size="small"
                      color={
                        a.severity === 'severe'
                          ? 'error'
                          : a.severity === 'moderate'
                            ? 'warning'
                            : 'default'
                      }
                      label={t(`medical.severities.${a.severity}`)}
                    />
                    <Typography dir="auto">
                      {a.substance}
                      {a.reaction ? ` — ${a.reaction}` : ''}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography color="text.secondary">{t('medical.noAllergies')}</Typography>
            )}
          </Box>
          {h.medications && <Info label={t('medical.medications')} value={h.medications} />}
          {h.notes && <Info label={t('medical.notes')} value={h.notes} />}
          {showVersions && (
            <Box>
              <Typography fontWeight={700} sx={{ mb: 2 }}>
                {t('medical.versions')}
              </Typography>
              {(versions.data ?? []).map((v) => (
                <Typography key={v.id} variant="body2" color="text.secondary">
                  {t('medical.version', { n: v.version })} ·{' '}
                  {formatDateTime(v.createdAt, i18n.resolvedLanguage ?? 'ar')} ·{' '}
                  {v.conditions.length} / {v.allergies.length}
                </Typography>
              ))}
            </Box>
          )}
        </Stack>
      )}
    </SectionCard>
  );
}

/* ---------------- insurance ---------------- */

const policySchema = z
  .object({
    insuranceCompanyId: z.string().min(1, { message: 'required' }),
    planName: optional(freeText(80)),
    memberNumber: z
      .string()
      .trim()
      .min(1, { message: 'required' })
      .max(40, { message: 'too_long' }),
    relationToSubscriber: enumOf(['self', 'spouse', 'child', 'other']),
    validFrom: optional(dateOnly()),
    validTo: optional(dateOnly()),
    coveragePercentOverride: optional(z.coerce.number().pipe(percent())),
    annualMax: optional(money()),
    isPrimary: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.validFrom && v.validTo && v.validTo < v.validFrom)
      ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'range_invalid' });
  });
type PolicyForm = z.input<typeof policySchema>;

function PolicyDrawer({
  patientId,
  policy,
  open,
  onClose,
}: {
  patientId: string;
  policy: Policy | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('patients');
  const currency = useCurrency();
  const companies = insuranceCompaniesApi.useAll();
  const save = useSavePolicy(patientId);
  const notify = useNotify();
  const empty: PolicyForm = {
    insuranceCompanyId: '',
    planName: '',
    memberNumber: '',
    relationToSubscriber: 'self',
    validFrom: '',
    validTo: '',
    coveragePercentOverride: '',
    annualMax: undefined,
    isPrimary: true,
  };
  const form = useAppForm<PolicyForm>({
    schema: policySchema,
    defaultValues: empty,
    values: policy
      ? {
          insuranceCompanyId: policy.insuranceCompanyId,
          planName: policy.planName ?? '',
          memberNumber: policy.memberNumber,
          relationToSubscriber: policy.relationToSubscriber,
          validFrom: policy.validFrom ?? '',
          validTo: policy.validTo ?? '',
          coveragePercentOverride: policy.coveragePercentOverride ?? '',
          annualMax: policy.annualMax,
          isPrimary: policy.isPrimary,
        }
      : empty,
  });
  const onSubmit = async (v: PolicyForm) => {
    const body = Object.fromEntries(
      Object.entries(v).filter(([, x]) => x !== '' && x !== undefined),
    );
    await save.mutateAsync({ ...body, ...(policy ? { id: policy.id } : {}) });
    notify.success(t('insurance.saved'));
    onClose();
  };
  return (
    <FormDrawer
      open={open}
      title={policy ? t('insurance.edit') : t('insurance.add')}
      onClose={onClose}
      formId="policy-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={520}
    >
      <Form form={form} name="patient.policy" onSubmit={onSubmit} id="policy-form">
        <Grid container spacing={4}>
          <Grid item xs={12}>
            <RHFSelect
              name="insuranceCompanyId"
              label={t('insurance.company')}
              required
              options={(companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField
              name="memberNumber"
              label={t('insurance.member')}
              required
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField name="planName" label={t('insurance.plan')} />
          </Grid>
          <Grid item xs={12}>
            <RHFSelect
              name="relationToSubscriber"
              label={t('insurance.relation')}
              options={(['self', 'spouse', 'child', 'other'] as const).map((r) => ({
                value: r,
                label: t(`insurance.relations.${r}`),
              }))}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFDate name="validFrom" label={t('insurance.validFrom')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFDate name="validTo" label={t('insurance.validTo')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField
              name="coveragePercentOverride"
              label={t('insurance.coverage')}
              type="number"
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFMoney name="annualMax" label={t('insurance.annualMax')} currency={currency} />
          </Grid>
          <Grid item xs={12}>
            <RHFCheckbox name="isPrimary" label={t('insurance.primary')} asSwitch />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

export function InsuranceTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const q = usePolicies(p.id);
  const del = useDeletePolicy(p.id);
  const confirm = useConfirm();
  const notify = useNotify();
  const [editing, setEditing] = useState<Policy | null>(null);
  const [open, setOpen] = useState(false);
  const canEdit = can('patients.patient.update') || can('billing.insurance.manage');
  const today = new Date().toISOString().slice(0, 10);
  if (q.isLoading) return <PageSkeleton rows={3} />;
  return (
    <SectionCard
      title={t('insurance.title')}
      actions={
        canEdit && (
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            {t('insurance.add')}
          </Button>
        )
      }
    >
      {(q.data ?? []).length === 0 ? (
        <EmptyState title={t('insurance.empty')} compact />
      ) : (
        <Grid container spacing={4}>
          {(q.data ?? []).map((pol) => {
            const expired = Boolean(pol.validTo && pol.validTo < today);
            return (
              <Grid item xs={12} md={6} key={pol.id}>
                <Card
                  variant="outlined"
                  sx={(th) => ({
                    p: 5,
                    borderColor: pol.isPrimary ? alpha(th.palette.primary.main, 0.5) : 'divider',
                  })}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography fontWeight={700} dir="auto">
                        {pol.insuranceCompanyName}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        dir="ltr"
                        sx={{ textAlign: 'start' }}
                      >
                        {pol.memberNumber}
                        {pol.planName ? ` · ${pol.planName}` : ''}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      {pol.isPrimary && (
                        <Chip size="small" color="primary" label={t('insurance.primary')} />
                      )}
                      {expired && (
                        <Chip
                          size="small"
                          color="error"
                          variant="outlined"
                          label={t('insurance.expired')}
                        />
                      )}
                      {canEdit && (
                        <>
                          <IconButton
                            size="small"
                            aria-label={t('common:actions.edit')}
                            onClick={() => {
                              setEditing(pol);
                              setOpen(true);
                            }}
                          >
                            <Pencil size={16} />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            aria-label={t('common:actions.delete')}
                            onClick={async () => {
                              const r = await confirm({
                                title: t('insurance.deleteTitle'),
                                destructive: true,
                              });
                              if (!r.confirmed) return;
                              await del.mutateAsync(pol.id);
                              notify.success(t('insurance.deleted'));
                            }}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </>
                      )}
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={6} sx={{ mt: 3 }}>
                    <Info
                      label={t('insurance.relation')}
                      value={t(`insurance.relations.${pol.relationToSubscriber}`)}
                    />
                    {pol.validTo && (
                      <Info
                        label={t('insurance.validTo')}
                        value={formatDate(pol.validTo, i18n.resolvedLanguage ?? 'ar')}
                      />
                    )}
                    {pol.annualMax !== undefined && (
                      <Info
                        label={t('insurance.annualMax')}
                        value={<MoneyText value={pol.annualMax} />}
                      />
                    )}
                    {pol.usedThisYear !== undefined && pol.annualMax !== undefined && (
                      <Info
                        label={t('insurance.used')}
                        value={<MoneyText value={pol.usedThisYear} />}
                      />
                    )}
                  </Stack>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}
      <PolicyDrawer patientId={p.id} policy={editing} open={open} onClose={() => setOpen(false)} />
    </SectionCard>
  );
}

/* ---------------- documents & imaging ---------------- */

function Thumb({ file, onDelete }: { file: FileItem; onDelete?: () => void }) {
  const { t, i18n } = useTranslation('patients');
  const isImage = file.mime.startsWith('image/');
  const url = useFileUrl(isImage ? file.id : undefined);
  return (
    <Card variant="outlined" sx={{ overflow: 'hidden', position: 'relative' }}>
      <CardActionArea onClick={() => void openFile(file.id)}>
        <Box
          sx={{ height: 140, display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}
        >
          {isImage && url.data ? (
            <Box
              component="img"
              src={url.data}
              alt={file.originalName}
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <FileText size={40} />
          )}
        </Box>
        <Box sx={{ p: 3 }}>
          <Typography variant="body2" fontWeight={650} noWrap dir="auto">
            {file.originalName || t(`documents.categories.${file.category}`)}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <Chip size="small" label={t(`documents.categories.${file.category}`)} />
            <Typography variant="caption" color="text.secondary">
              {formatDate(file.createdAt, i18n.resolvedLanguage ?? 'ar', 'll')}
            </Typography>
          </Stack>
        </Box>
      </CardActionArea>
      {onDelete && (
        <Tooltip title={t('common:actions.delete')}>
          <IconButton
            size="small"
            onClick={onDelete}
            sx={{
              position: 'absolute',
              top: 8,
              insetInlineEnd: 8,
              bgcolor: 'background.paper',
              '&:hover': { bgcolor: 'background.paper' },
            }}
            aria-label={t('common:actions.delete')}
          >
            <Trash2 size={14} />
          </IconButton>
        </Tooltip>
      )}
    </Card>
  );
}

const CATEGORIES = ['xray', 'photo', 'document', 'consent', 'id', 'other'] as const;
/** Mirrors the server's MAX_UPLOAD_MB; the server re-checks size and type by magic bytes. */
const MAX_UPLOAD_MB = 25;

export function DocumentsTab({ imagingOnly }: { imagingOnly?: boolean }) {
  const { t } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<string>(imagingOnly ? 'xray' : 'document');
  const [progress, setProgress] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const docs = useDocuments(p.id, imagingOnly ? undefined : filter || undefined);
  const upload = useUploadDocument(p.id);
  const del = useDeleteDocument(p.id);
  const confirm = useConfirm();
  const notify = useNotify();
  const canUpload = can('patients.document.upload') || can('clinical.imaging.upload');
  const items = (docs.data ?? []).filter(
    (f) => !imagingOnly || f.category === 'xray' || f.category === 'photo',
  );

  const send = async (files: FileList | File[]) => {
    const list = Array.from(files);
    let ok = 0;
    for (const file of list) {
      if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        notify.error(t('validation:file_too_large', { max: MAX_UPLOAD_MB }));
        continue;
      }
      try {
        setProgress(0);
        await upload.mutateAsync({ file, category, onProgress: setProgress });
        ok += 1;
      } catch (err) {
        notify.error(err);
      }
    }
    setProgress(null);
    if (ok) notify.success(t('documents.uploaded', { count: ok }));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
  };

  return (
    <SectionCard
      title={imagingOnly ? t('tabs.imaging') : t('documents.title')}
      actions={
        !imagingOnly && (
          <TextField
            select
            size="small"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            label={t('documents.category')}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">{t('documents.all')}</MenuItem>
            {CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {t(`documents.categories.${c}`)}
              </MenuItem>
            ))}
          </TextField>
        )
      }
    >
      {canUpload && (
        <Box
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          sx={(th) => ({
            mb: 5,
            p: 6,
            borderRadius: '14px',
            border: `2px dashed ${dragOver ? th.palette.primary.main : th.palette.divider}`,
            bgcolor: dragOver ? alpha(th.palette.primary.main, 0.05) : 'transparent',
            textAlign: 'center',
            transition: 'all .15s ease',
          })}
        >
          <Stack alignItems="center" spacing={2}>
            <Upload size={28} />
            <Typography fontWeight={650}>{t('documents.drop')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('documents.dropHint', { max: MAX_UPLOAD_MB })}
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center">
              <TextField
                select
                size="small"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                label={t('documents.category')}
                sx={{ minWidth: 150 }}
              >
                {CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {t(`documents.categories.${c}`)}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                variant="contained"
                startIcon={<Upload size={16} />}
                onClick={() => inputRef.current?.click()}
                disabled={progress !== null}
              >
                {t('documents.upload')}
              </Button>
              <input
                ref={inputRef}
                hidden
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(e) => e.target.files && void send(e.target.files)}
              />
            </Stack>
            {progress !== null && (
              <Box sx={{ width: 260 }}>
                <LinearProgress variant="determinate" value={progress} />
                <Typography variant="caption">{t('documents.uploading')}</Typography>
              </Box>
            )}
          </Stack>
        </Box>
      )}
      {docs.isLoading ? (
        <PageSkeleton rows={2} />
      ) : items.length === 0 ? (
        <EmptyState title={t('documents.empty')} compact />
      ) : (
        <Grid container spacing={3}>
          {items.map((f) => (
            <Grid item xs={6} sm={4} md={3} key={f.id}>
              <Thumb
                file={f}
                onDelete={
                  can('patients.document.delete')
                    ? async () => {
                        const r = await confirm({
                          title: t('documents.deleteTitle', { name: f.originalName || f.category }),
                          destructive: true,
                        });
                        if (!r.confirmed) return;
                        await del.mutateAsync(f.id);
                        notify.success(t('documents.deleted'));
                      }
                    : undefined
                }
              />
            </Grid>
          ))}
        </Grid>
      )}
    </SectionCard>
  );
}

/* ---------------- history ---------------- */

export function HistoryTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const q = useTimeline(p.id);
  if (q.isLoading) return <PageSkeleton rows={4} />;
  return (
    <SectionCard title={t('timeline.title')}>
      {(q.data ?? []).length === 0 ? (
        <EmptyState title={t('timeline.empty')} compact />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, position: 'relative' }}>
          {(q.data ?? []).map((e, i) => (
            <Box
              component="li"
              key={i}
              sx={{ display: 'flex', gap: 3, pb: 4, position: 'relative' }}
            >
              <Box
                sx={(th) => ({
                  width: 12,
                  height: 12,
                  mt: 0.75,
                  borderRadius: '50%',
                  bgcolor: th.palette.primary.main,
                  boxShadow: `0 0 0 4px ${alpha(th.palette.primary.main, 0.15)}`,
                  flexShrink: 0,
                })}
              />
              <Box>
                <Typography fontWeight={650}>
                  {t(`timeline.events.${e.kind}`, {
                    defaultValue: t(`timeline.events.${e.kind.split('.')[0]}`, {
                      defaultValue: e.kind,
                    }),
                  })}
                </Typography>
                {e.title && (
                  <Typography variant="body2" color="text.secondary" dir="auto">
                    {e.title}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(e.at, i18n.resolvedLanguage ?? 'ar')}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </SectionCard>
  );
}
