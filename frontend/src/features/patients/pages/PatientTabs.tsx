import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  LinearProgress,
  Link,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Check,
  ChevronDown,
  FileText,
  History,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { useFieldArray } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { usePlans } from '@/features/clinical/api';
import { formatDate, formatDateTime, formatTime } from '@/lib/dates';
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
import { StatusChip } from '@/shared/components/StatusChip';
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
  useFamily,
  useLinkFamily,
  useMedicalHistory,
  useMedicalVersions,
  usePolicies,
  useSaveMedicalHistory,
  useSavePolicy,
  useTimeline,
  useUnlinkFamily,
  useUploadDocument,
  type FileItem,
  type MedicalHistory,
  type Policy,
  type TimelineEvent,
} from '../api/patients';
import { PatientPicker } from '../components/PatientPicker';
import { ageOf, useAlertLabel, useNextAppointment } from '../utils';
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

function Glance({
  label,
  children,
  onClick,
}: {
  label: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <Box sx={{ p: 4 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Box sx={{ mt: 1, fontWeight: 700 }}>{children}</Box>
    </Box>
  );
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      {onClick ? (
        <CardActionArea onClick={onClick} sx={{ height: '100%' }}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  );
}

const OPEN_PLAN = ['presented', 'accepted', 'partially_accepted', 'in_progress'];

/** Next visit, open treatment plan, last visit and no-shows; each only with its permission. */
function AtAGlance() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const navigate = useNavigate();
  const lang = i18n.resolvedLanguage ?? 'ar';
  const next = useNextAppointment(p.id);
  const canPlans = can('clinical.treatmentPlan.read');
  const plans = usePlans(p.id, canPlans);
  const plan = (plans.data ?? []).find((x) => OPEN_PLAN.includes(x.status));
  const base = `/clinic/patients/${p.id}`;
  return (
    <Grid container spacing={4} sx={{ mb: 6 }}>
      {next.allowed && (
        <Grid item xs={6} md={3}>
          <Glance
            label={t('header.nextAppointment')}
            onClick={() => navigate(`${base}/appointments`)}
          >
            {next.isLoading ? (
              <Skeleton width={100} />
            ) : next.next ? (
              <>
                {formatDate(next.next.start, lang, 'ddd ll')}
                <Typography
                  variant="body2"
                  color="text.secondary"
                  dir="ltr"
                  sx={{ textAlign: 'start' }}
                >
                  {formatTime(next.next.start, lang)}
                </Typography>
              </>
            ) : (
              <Typography color="text.secondary">{t('header.none')}</Typography>
            )}
          </Glance>
        </Grid>
      )}
      {canPlans && (
        <Grid item xs={6} md={3}>
          <Glance label={t('overview.openPlan')} onClick={() => navigate(`${base}/plans`)}>
            {plans.isLoading ? (
              <Skeleton width={100} />
            ) : plan ? (
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ flexWrap: 'wrap', rowGap: 1 }}
              >
                <span dir="auto">{plan.title || plan.number}</span>
                <StatusChip status={plan.status} />
              </Stack>
            ) : (
              <Typography color="text.secondary">{t('header.none')}</Typography>
            )}
          </Glance>
        </Grid>
      )}
      <Grid item xs={6} md={3}>
        <Glance label={t('fields.lastVisit')}>
          {p.lastVisitAt ? formatDate(p.lastVisitAt, lang, 'll') : '—'}
        </Glance>
      </Grid>
      <Grid item xs={6} md={3}>
        <Glance label={t('overview.noShows')}>
          <Typography
            component="span"
            fontWeight={700}
            color={(p.noShowCount ?? 0) > 0 ? 'warning.main' : undefined}
          >
            {p.noShowCount ?? 0}
          </Typography>
        </Glance>
      </Grid>
    </Grid>
  );
}

function LinkFamilyDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const { t } = useTranslation('patients');
  const link = useLinkFamily(patientId);
  const notify = useNotify();
  const [other, setOther] = useState<{ id: string; fullName: string } | null>(null);
  const run = async () => {
    if (!other) return;
    try {
      await link.mutateAsync(other.id);
      notify.success(t('family.linked', { name: other.fullName }));
      onClose();
    } catch (err) {
      notify.error(err);
    }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('family.linkTitle')}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 4 }}>
          {t('family.linkHint')}
        </Typography>
        <PatientPicker
          label={t('family.member')}
          value={other}
          onChange={setOther}
          excludeId={patientId}
        />
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" disabled={!other || link.isPending} onClick={() => void run()}>
          {t('family.link')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FamilyCard() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const scope = useFieldScope();
  const { can } = usePermission();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const notify = useNotify();
  const visible = scope.canSee('guardian');
  const canEdit =
    can('patients.patient.update') && scope.canEdit('guardian') && p.status !== 'merged';
  const family = useFamily(p.id, visible);
  const unlink = useUnlinkFamily();
  const [linking, setLinking] = useState(false);
  const members = family.data ?? [];

  const remove = async (id: string, name: string) => {
    const r = await confirm({ title: t('family.unlinkTitle', { name }), destructive: true });
    if (!r.confirmed) return;
    try {
      await unlink.mutateAsync(id);
      notify.success(t('family.unlinked'));
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <SectionCard
      title={t('overview.family')}
      actions={
        canEdit && (
          <Button startIcon={<Users size={16} />} onClick={() => setLinking(true)}>
            {t('family.link')}
          </Button>
        )
      }
    >
      {visible && p.guardian && (
        <>
          <Info label={t('fields.guardianName')} value={p.guardian.name} />
          <Info label={t('fields.relation')} value={p.guardian.relation} />
          <Info
            label={t('fields.guardianPhone')}
            value={<span dir="ltr">{p.guardian.phone}</span>}
          />
        </>
      )}
      {scope.canSee('emergencyContact') && p.emergencyContact && (
        <Info
          label={t('sections.emergency')}
          value={
            <>
              <span dir="auto">{p.emergencyContact.name}</span>
              {p.emergencyContact.relation ? ` (${p.emergencyContact.relation})` : ''} ·{' '}
              <span dir="ltr">{p.emergencyContact.phone}</span>
            </>
          }
        />
      )}
      {visible && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {t('family.members')}
          </Typography>
          {family.isLoading ? (
            <Skeleton height={40} />
          ) : family.isError ? (
            <ErrorState error={family.error} onRetry={() => void family.refetch()} />
          ) : members.length === 0 ? (
            <Typography color="text.secondary">{t('family.none')}</Typography>
          ) : (
            <Stack spacing={1} sx={{ mt: 1 }}>
              {members.map((m) => {
                const age = ageOf(m.dateOfBirth);
                return (
                  <Stack
                    key={m.id}
                    direction="row"
                    spacing={2}
                    alignItems="center"
                    sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Link
                        component="button"
                        type="button"
                        onClick={() => navigate(`/clinic/patients/${m.id}`)}
                        fontWeight={650}
                        sx={{ textAlign: 'start' }}
                      >
                        <span dir="auto">{m.fullName}</span>
                      </Link>
                      <Typography variant="caption" color="text.secondary" display="block">
                        <span dir="ltr">{m.fileNumber}</span>
                        {age !== null ? ` · ${t('years', { count: age })}` : ''}
                        {m.dateOfBirth
                          ? ` · ${formatDate(m.dateOfBirth, i18n.resolvedLanguage ?? 'ar', 'll')}`
                          : ''}
                      </Typography>
                    </Box>
                    {m.relation !== 'member' && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={t(`family.relations.${m.relation}`)}
                      />
                    )}
                    {canEdit && (
                      <Tooltip title={t('family.unlink')}>
                        <IconButton
                          size="small"
                          aria-label={t('family.unlink')}
                          onClick={() => void remove(m.id, m.fullName)}
                        >
                          <X size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Box>
      )}
      {linking && <LinkFamilyDialog patientId={p.id} onClose={() => setLinking(false)} />}
    </SectionCard>
  );
}

const COMM_LABEL = {
  whatsapp: 'commWhatsapp',
  sms: 'commSms',
  email: 'commEmail',
  marketing: 'commMarketing',
} as const;
const COMM_CHANNELS = Object.keys(COMM_LABEL) as (keyof typeof COMM_LABEL)[];

export function OverviewTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const scope = useFieldScope();
  const alertLabel = useAlertLabel();
  const { can } = usePermission();
  const canMedical = can('patients.medicalHistory.read');
  const medical = useMedicalHistory(p.id, canMedical);
  const lang = i18n.resolvedLanguage ?? 'ar';
  const sixMonths = 182 * 86_400_000;
  const overdue = medical.data
    ? !medical.data.reviewedAt || Date.now() - Date.parse(medical.data.reviewedAt) > sixMonths
    : false;
  const prefs = p.communicationPrefs ?? {};
  return (
    <>
      <AtAGlance />
      <Grid container spacing={5}>
        <Grid item xs={12} md={6}>
          <SectionCard title={t('overview.contact')}>
            {scope.canSee('phone') || scope.isMasked('phone') ? (
              <Info label={t('fields.phone')} value={<span dir="ltr">{p.phone}</span>} />
            ) : null}
            {(scope.canSee('altPhone') || scope.isMasked('altPhone')) && p.altPhone && (
              <Info label={t('fields.altPhone')} value={<span dir="ltr">{p.altPhone}</span>} />
            )}
            {(scope.canSee('email') || scope.isMasked('email')) && (
              <Info
                label={t('fields.email')}
                value={p.email && <span dir="ltr">{p.email}</span>}
              />
            )}
            {scope.canSee('address') && (
              <Info
                label={t('fields.addressLine1')}
                value={[p.address?.line1, p.address?.city]
                  .filter(Boolean)
                  .join(lang === 'ar' ? '، ' : ', ')}
              />
            )}
            {(scope.canSee('nationalId') || scope.isMasked('nationalId')) && (
              <>
                <Info
                  label={t('fields.nationalId')}
                  value={p.nationalId && <span dir="ltr">{p.nationalId}</span>}
                />
                {p.passportNo && (
                  <Info
                    label={t('fields.passportNo')}
                    value={<span dir="ltr">{p.passportNo}</span>}
                  />
                )}
              </>
            )}
            {p.dateOfBirth && (
              <Info label={t('fields.dateOfBirth')} value={formatDate(p.dateOfBirth, lang)} />
            )}
          </SectionCard>
          <SectionCard title={t('overview.preferences')}>
            {scope.canSee('preferredDentist') && (
              <Info
                label={t('fields.preferredDentist')}
                value={p.preferredDentistName && <span dir="auto">{p.preferredDentistName}</span>}
              />
            )}
            {scope.canSee('preferredLanguage') && p.preferredLanguage && (
              <Info
                label={t('fields.preferredLanguage')}
                value={t(`overview.languages.${p.preferredLanguage}`)}
              />
            )}
            {scope.canSee('communicationPrefs') && (
              <Box sx={{ py: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  {t('overview.channels')}
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
                  {COMM_CHANNELS.map((c) => (
                    <Chip
                      key={c}
                      size="small"
                      variant={prefs[c] ? 'filled' : 'outlined'}
                      color={prefs[c] ? 'success' : 'default'}
                      icon={prefs[c] ? <Check size={14} /> : <X size={14} />}
                      label={t(`fields.${COMM_LABEL[c]}`)}
                    />
                  ))}
                </Stack>
              </Box>
            )}
            {scope.canSee('referralSource') && p.referralSource && (
              <Info label={t('fields.referralSource')} value={p.referralSource} />
            )}
            <Info label={t('overview.registered')} value={formatDate(p.createdAt, lang)} />
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          {canMedical && (
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
          )}
          <FamilyCard />
          <SectionCard title={t('overview.portal')}>
            <Chip
              icon={<ShieldCheck size={16} />}
              color={p.hasPortalAccount ? 'success' : 'default'}
              label={
                p.hasPortalAccount ? t('overview.portalLinked') : t('overview.portalNotLinked')
              }
            />
          </SectionCard>
        </Grid>
        {scope.canSee('notes') && p.notes && (
          <Grid item xs={12}>
            <SectionCard title={t('fields.notes')}>
              <Typography sx={{ whiteSpace: 'pre-wrap' }} dir="auto">
                {p.notes}
              </Typography>
            </SectionCard>
          </Grid>
        )}
      </Grid>
    </>
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

/** Every saved version, newest first; expand one to read exactly what was recorded then. */
function MedicalVersions({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('patients');
  const q = useMedicalVersions(patientId, true);
  const [open, setOpen] = useState<string | null>(null);
  const lang = i18n.resolvedLanguage ?? 'ar';
  const sep = lang === 'ar' ? '، ' : ', ';
  if (q.isLoading) return <PageSkeleton rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  return (
    <Box>
      <Typography fontWeight={700} sx={{ mb: 2 }}>
        {t('medical.versions')}
      </Typography>
      <Stack spacing={1}>
        {(q.data ?? []).map((v: MedicalHistory) => (
          <Card variant="outlined" key={v.id}>
            <CardActionArea
              onClick={() => setOpen((o) => (o === v.id ? null : v.id))}
              aria-expanded={open === v.id}
              sx={{ px: 4, py: 2 }}
            >
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography fontWeight={650}>{t('medical.version', { n: v.version })}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {formatDateTime(v.createdAt, lang)}
                </Typography>
                {v.reviewedAt && (
                  <Chip
                    size="small"
                    color="success"
                    variant="outlined"
                    label={t('medical.reviewedShort')}
                  />
                )}
                <ChevronDown
                  size={16}
                  style={{ transform: open === v.id ? 'rotate(180deg)' : undefined }}
                />
              </Stack>
            </CardActionArea>
            <Collapse in={open === v.id} unmountOnExit>
              <Box sx={{ px: 4, pb: 3 }}>
                <Info
                  label={t('medical.conditions')}
                  value={v.conditions.map((c) => t(`medical.condition.${c}`)).join(sep)}
                />
                <Info
                  label={t('medical.allergies')}
                  value={v.allergies
                    .map((a) => `${a.substance} (${t(`medical.severities.${a.severity}`)})`)
                    .join(sep)}
                />
                {v.medications && <Info label={t('medical.medications')} value={v.medications} />}
                {v.notes && <Info label={t('medical.notes')} value={v.notes} />}
              </Box>
            </Collapse>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

export function MedicalTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const q = useMedicalHistory(p.id);
  const [editing, setEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
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
                {h.allergies.map((a, i) => (
                  <Stack key={`${a.substance}-${i}`} direction="row" spacing={2} alignItems="center">
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
          {showVersions && <MedicalVersions patientId={p.id} />}
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
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
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
                              try {
                                await del.mutateAsync(pol.id);
                                notify.success(t('insurance.deleted'));
                              } catch (err) {
                                notify.error(err);
                              }
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
      ) : docs.isError ? (
        <ErrorState error={docs.error} onRetry={() => void docs.refetch()} compact />
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
                        try {
                          await del.mutateAsync(f.id);
                          notify.success(t('documents.deleted'));
                        } catch (err) {
                          notify.error(err);
                        }
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

/** Group of an event kind (`invoice.paid` → `invoice`), used for the filter and the dot colour. */
const groupOf = (kind: string) => kind.split('.')[0] ?? kind;
const DOT: Record<string, 'primary' | 'success' | 'warning' | 'info' | 'secondary' | 'error'> = {
  appointment: 'primary',
  procedure: 'success',
  plan: 'success',
  note: 'secondary',
  invoice: 'warning',
  payment: 'warning',
  medicalHistory: 'error',
};

export function HistoryTab() {
  const { t, i18n } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const navigate = useNavigate();
  const q = useTimeline(p.id);
  const [group, setGroup] = useState('');
  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const events = q.data ?? [];
  const groups = [...new Set(events.map((e) => groupOf(e.kind)))];
  const shown = group ? events.filter((e) => groupOf(e.kind) === group) : events;
  const open = (e: TimelineEvent) => {
    if (!e.ref) return;
    navigate(e.ref.startsWith('/') ? e.ref : `/clinic/patients/${p.id}/${e.ref}`);
  };
  const label = (kind: string) =>
    t(`timeline.events.${kind}`, {
      defaultValue: t(`timeline.events.${groupOf(kind)}`, { defaultValue: kind }),
    });

  return (
    <SectionCard
      title={t('timeline.title')}
      actions={
        groups.length > 1 && (
          <TextField
            select
            size="small"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            label={t('timeline.filter')}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">{t('documents.all')}</MenuItem>
            {groups.map((g) => (
              <MenuItem key={g} value={g}>
                {t(`timeline.groups.${g}`, { defaultValue: g })}
              </MenuItem>
            ))}
          </TextField>
        )
      }
    >
      {shown.length === 0 ? (
        <EmptyState title={t('timeline.empty')} compact />
      ) : (
        <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, position: 'relative' }}>
          {shown.map((e, i) => (
            <Box
              component="li"
              key={`${e.kind}-${e.at}-${i}`}
              sx={{ display: 'flex', gap: 3, pb: 4, position: 'relative' }}
            >
              <Box
                sx={(th) => {
                  const c = th.palette[DOT[groupOf(e.kind)] ?? 'info'].main;
                  return {
                    width: 12,
                    height: 12,
                    mt: 0.75,
                    borderRadius: '50%',
                    bgcolor: c,
                    boxShadow: `0 0 0 4px ${alpha(c, 0.15)}`,
                    flexShrink: 0,
                  };
                }}
              />
              <Box>
                {e.ref ? (
                  <Link
                    component="button"
                    type="button"
                    fontWeight={650}
                    onClick={() => open(e)}
                    sx={{ textAlign: 'start' }}
                  >
                    {label(e.kind)}
                  </Link>
                ) : (
                  <Typography fontWeight={650}>{label(e.kind)}</Typography>
                )}
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
