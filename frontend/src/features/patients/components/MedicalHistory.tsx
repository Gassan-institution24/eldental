import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardActionArea,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ChevronDown, History, Pencil, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { formatDate, formatDateTime } from '@/lib/dates';
import {
  ALCOHOL_LEVELS,
  ALLERGY_SEVERITIES,
  MAX_MEDICATIONS,
  MAX_SURGERIES,
  MEDICAL_CONDITIONS,
  medicalHistoryBody,
  SMOKING_LEVELS,
} from '@/shared/generated/patients';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { useRegisterLabel } from '@/shared/form/fieldLabels';
import { RHFCheckbox, RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useErrorText } from '@/shared/form/useFieldError';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  useMedicalHistory,
  useMedicalVersions,
  useMedicineSearch,
  useSaveMedicalHistory,
  type MedicalHistory,
} from '../api/patients';
import { usePatientContext } from '../pages/PatientWorkspace';

/** The API's own rules (shared/patients), so the editor and the server agree (16 §5). */
const schema = medicalHistoryBody();
type Med = z.input<typeof schema>;

function Info({ label, value }: { label: string; value?: ReactNode }) {
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

function toForm(h?: MedicalHistory | null): Med {
  return {
    conditions: (h?.conditions ?? []) as Med['conditions'],
    medicationsList: (h?.medicationsList ?? []).map((m) => ({
      name: m.name,
      medicineId: m.medicineId ?? '',
      dose: m.dose ?? '',
      frequency: m.frequency ?? '',
      since: m.since ?? '',
    })),
    medications: h?.medications ?? '',
    surgeries: (h?.surgeries ?? []).map((s) => ({ name: s.name, year: s.year ?? '', note: s.note ?? '' })),
    lifestyle: { smoking: h?.lifestyle?.smoking ?? '', alcohol: h?.lifestyle?.alcohol ?? '' },
    pregnancyWeeks: h?.pregnancyWeeks ?? '',
    allergies: h?.allergies ?? [],
    notes: h?.notes ?? '',
    reviewed: false,
  };
}

/** Free text with suggestions from the medicine catalog; picking one links it by id. */
function MedicineName({ index }: { index: number }) {
  const { t } = useTranslation('patients');
  const { control, setValue, getValues } = useFormContext();
  const errorText = useErrorText();
  const name = `medicationsList.${index}.name`;
  const label = t('medical.medicineName');
  useRegisterLabel(name, label);
  const [input, setInput] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQ(input.trim()), 250);
    return () => clearTimeout(h);
  }, [input]);
  const meds = useMedicineSearch(q, q.length >= 2);
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Autocomplete
          freeSolo
          options={meds.data ?? []}
          filterOptions={(x) => x}
          loading={meds.isFetching}
          getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
          inputValue={(field.value as string | undefined) ?? ''}
          onInputChange={(_e, v, reason) => {
            if (reason === 'reset') return;
            field.onChange(v);
            setValue(`medicationsList.${index}.medicineId`, '', { shouldDirty: true });
            setInput(v);
          }}
          onChange={(_e, v) => {
            if (!v || typeof v === 'string') return;
            field.onChange(v.name);
            setValue(`medicationsList.${index}.medicineId`, v.id, { shouldDirty: true });
            const prefix = `medicationsList.${index}`;
            if (v.dose && !getValues(`${prefix}.dose`)) setValue(`${prefix}.dose`, v.dose);
            if (v.frequency && !getValues(`${prefix}.frequency`)) setValue(`${prefix}.frequency`, v.frequency);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              id={`field-${name.replace(/\./g, '-')}`}
              name={field.name}
              inputRef={field.ref}
              onBlur={field.onBlur}
              label={`${label} *`}
              error={Boolean(fieldState.error)}
              helperText={errorText(fieldState.error, label)}
              inputProps={{ ...params.inputProps, dir: 'auto', maxLength: 120 }}
            />
          )}
        />
      )}
    />
  );
}

function Editor({ h, onDone }: { h?: MedicalHistory | null; onDone: () => void }) {
  const { t } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const save = useSaveMedicalHistory(p.id);
  const notify = useNotify();
  const form = useAppForm<Med>({ schema, defaultValues: toForm(h) });
  const allergies = useFieldArray({ control: form.control, name: 'allergies' });
  const medications = useFieldArray({ control: form.control, name: 'medicationsList' });
  const surgeries = useFieldArray({ control: form.control, name: 'surgeries' });
  const conditions = (useWatch({ control: form.control, name: 'conditions' }) ?? []) as string[];
  const pregnant = conditions.includes('pregnancy');
  const year = new Date().getFullYear();

  const onSubmit = async (v: Med) => {
    const saved = await save.mutateAsync(v as unknown as Record<string, unknown>);
    notify.success(t('medical.saved', { n: saved.version }));
    onDone();
  };

  return (
    <Form form={form} name="patient.medicalHistory" onSubmit={onSubmit} guardUnsaved>
      <SectionCard title={t('medical.conditions')}>
        <Grid container>
          {MEDICAL_CONDITIONS.map((c) => (
            <Grid item xs={12} sm={6} md={4} key={c}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={conditions.includes(c)}
                    onChange={(e) => {
                      const cur = form.getValues('conditions') ?? [];
                      form.setValue('conditions', e.target.checked ? [...cur, c] : cur.filter((x) => x !== c), {
                        shouldDirty: true,
                      });
                      if (c === 'pregnancy' && !e.target.checked) form.setValue('pregnancyWeeks', '', { shouldDirty: true });
                    }}
                  />
                }
                label={t(`medical.condition.${c}`)}
              />
            </Grid>
          ))}
        </Grid>
        {pregnant && (
          <Box sx={{ mt: 3, maxWidth: 240 }}>
            <RHFTextField
              name="pregnancyWeeks"
              label={t('medical.pregnancyWeeks')}
              type="number"
              inputProps={{ dir: 'ltr', min: 1, max: 42 }}
            />
          </Box>
        )}
      </SectionCard>

      <SectionCard
        title={t('medical.medicationsList')}
        subtitle={t('medical.medicationsHint')}
        actions={
          <Button
            startIcon={<Plus size={16} />}
            disabled={medications.fields.length >= MAX_MEDICATIONS}
            onClick={() => medications.append({ name: '', medicineId: '', dose: '', frequency: '', since: '' })}
          >
            {t('medical.addMedication')}
          </Button>
        }
      >
        {medications.fields.length === 0 && <Typography color="text.secondary">{t('medical.noMedications')}</Typography>}
        {medications.fields.map((f, i) => (
          <Grid container spacing={3} key={f.id} sx={{ mb: 3 }} alignItems="flex-start" data-testid={`medication-${i}`}>
            <Grid item xs={12} md={4}>
              <MedicineName index={i} />
            </Grid>
            <Grid item xs={6} md={2}>
              <RHFTextField name={`medicationsList.${i}.dose`} label={t('medical.dose')} maxLength={60} />
            </Grid>
            <Grid item xs={6} md={3}>
              <RHFTextField name={`medicationsList.${i}.frequency`} label={t('medical.frequency')} maxLength={60} />
            </Grid>
            <Grid item xs={10} md={2}>
              <RHFDate name={`medicationsList.${i}.since`} label={t('medical.since')} disableFuture />
            </Grid>
            <Grid item xs={2} md={1}>
              <IconButton onClick={() => medications.remove(i)} aria-label={t('common:actions.remove')}>
                <X size={18} />
              </IconButton>
            </Grid>
          </Grid>
        ))}
        <RHFTextField name="medications" label={t('medical.otherMedications')} multiline minRows={2} maxLength={1000} />
      </SectionCard>

      <SectionCard
        title={t('medical.allergies')}
        actions={
          <Button
            startIcon={<Plus size={16} />}
            disabled={allergies.fields.length >= 20}
            onClick={() => allergies.append({ substance: '', reaction: '', severity: 'moderate' })}
          >
            {t('medical.addAllergy')}
          </Button>
        }
      >
        {allergies.fields.length === 0 && <Typography color="text.secondary">{t('medical.noAllergies')}</Typography>}
        {allergies.fields.map((f, i) => (
          <Grid container spacing={3} key={f.id} sx={{ mb: 3 }} alignItems="flex-start">
            <Grid item xs={12} sm={4}>
              <RHFTextField name={`allergies.${i}.substance`} label={t('medical.substance')} required />
            </Grid>
            <Grid item xs={12} sm={4}>
              <RHFTextField name={`allergies.${i}.reaction`} label={t('medical.reaction')} />
            </Grid>
            <Grid item xs={10} sm={3}>
              <RHFSelect
                name={`allergies.${i}.severity`}
                label={t('medical.severity')}
                options={ALLERGY_SEVERITIES.map((s) => ({ value: s, label: t(`medical.severities.${s}`) }))}
              />
            </Grid>
            <Grid item xs={2} sm={1}>
              <IconButton onClick={() => allergies.remove(i)} aria-label={t('common:actions.remove')}>
                <X size={18} />
              </IconButton>
            </Grid>
          </Grid>
        ))}
      </SectionCard>

      <SectionCard
        title={t('medical.surgeries')}
        actions={
          <Button
            startIcon={<Plus size={16} />}
            disabled={surgeries.fields.length >= MAX_SURGERIES}
            onClick={() => surgeries.append({ name: '', year: '', note: '' })}
          >
            {t('medical.addSurgery')}
          </Button>
        }
      >
        {surgeries.fields.length === 0 && <Typography color="text.secondary">{t('medical.noSurgeries')}</Typography>}
        {surgeries.fields.map((f, i) => (
          <Grid container spacing={3} key={f.id} sx={{ mb: 3 }} alignItems="flex-start">
            <Grid item xs={12} sm={5}>
              <RHFTextField name={`surgeries.${i}.name`} label={t('medical.surgeryName')} required maxLength={120} />
            </Grid>
            <Grid item xs={4} sm={2}>
              <RHFTextField
                name={`surgeries.${i}.year`}
                label={t('medical.year')}
                type="number"
                inputProps={{ dir: 'ltr', min: 1900, max: year }}
              />
            </Grid>
            <Grid item xs={6} sm={4}>
              <RHFTextField name={`surgeries.${i}.note`} label={t('medical.surgeryNote')} maxLength={300} />
            </Grid>
            <Grid item xs={2} sm={1}>
              <IconButton onClick={() => surgeries.remove(i)} aria-label={t('common:actions.remove')}>
                <X size={18} />
              </IconButton>
            </Grid>
          </Grid>
        ))}
      </SectionCard>

      <SectionCard
        title={t('medical.lifestyle')}
        footer={
          <>
            <Button onClick={onDone}>{t('common:actions.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
              {t('common:actions.save')}
            </Button>
          </>
        }
      >
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <RHFSelect
                name="lifestyle.smoking"
                label={t('medical.smoking')}
                clearable
                options={SMOKING_LEVELS.map((s) => ({ value: s, label: t(`medical.smokingLevels.${s}`) }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect
                name="lifestyle.alcohol"
                label={t('medical.alcohol')}
                clearable
                options={ALCOHOL_LEVELS.map((s) => ({ value: s, label: t(`medical.alcoholLevels.${s}`) }))}
              />
            </Grid>
          </Grid>
          <RHFTextField name="notes" label={t('medical.notes')} multiline minRows={2} maxLength={2000} />
          <RHFCheckbox name="reviewed" label={t('medical.reviewed')} />
        </Stack>
      </SectionCard>
    </Form>
  );
}

function medicationLine(m: MedicalHistory['medicationsList'][number], lang: string, t: (k: string, o?: Record<string, unknown>) => string) {
  return [m.dose, m.frequency, m.since ? t('medical.sinceValue', { date: formatDate(m.since, lang) }) : undefined]
    .filter(Boolean)
    .join(' · ');
}

/** Everything one version recorded; used by the current view and by the version viewer. */
export function HistoryDetails({ h }: { h: MedicalHistory }) {
  const { t, i18n } = useTranslation('patients');
  const lang = i18n.resolvedLanguage ?? 'ar';
  const medications = h.medicationsList ?? [];
  const surgeries = h.surgeries ?? [];
  const life = h.lifestyle ?? {};
  return (
    <Stack spacing={4}>
      <Box>
        <Typography fontWeight={700} sx={{ mb: 2 }}>
          {t('medical.conditions')}
        </Typography>
        {h.conditions.length ? (
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {h.conditions.map((c) => (
              <Chip
                key={c}
                label={c === 'pregnancy' && h.pregnancyWeeks ? t('medical.pregnancyValue', { n: h.pregnancyWeeks }) : t(`medical.condition.${c}`)}
              />
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
                  color={a.severity === 'severe' ? 'error' : a.severity === 'moderate' ? 'warning' : 'default'}
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
      <Box>
        <Typography fontWeight={700} sx={{ mb: 2 }}>
          {t('medical.medicationsList')}
        </Typography>
        {medications.length ? (
          <Stack spacing={1}>
            {medications.map((m, i) => (
              <Box key={`${m.name}-${i}`}>
                <Typography dir="auto" fontWeight={600} component="span">
                  {m.name}
                </Typography>
                {medicationLine(m, lang, t) && (
                  <Typography variant="body2" color="text.secondary" component="span" dir="auto">
                    {' — '}
                    {medicationLine(m, lang, t)}
                  </Typography>
                )}
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">{t('medical.noMedications')}</Typography>
        )}
        {h.medications && <Info label={t('medical.otherMedications')} value={h.medications} />}
      </Box>
      <Box>
        <Typography fontWeight={700} sx={{ mb: 2 }}>
          {t('medical.surgeries')}
        </Typography>
        {surgeries.length ? (
          <Stack spacing={1}>
            {surgeries.map((s, i) => (
              <Typography key={`${s.name}-${i}`} dir="auto">
                {s.name}
                {s.year ? ` (${s.year})` : ''}
                {s.note ? ` — ${s.note}` : ''}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Typography color="text.secondary">{t('medical.noSurgeries')}</Typography>
        )}
      </Box>
      {(life.smoking || life.alcohol) && (
        <Box>
          <Typography fontWeight={700} sx={{ mb: 2 }}>
            {t('medical.lifestyle')}
          </Typography>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {life.smoking && <Chip variant="outlined" label={`${t('medical.smoking')}: ${t(`medical.smokingLevels.${life.smoking}`)}`} />}
            {life.alcohol && <Chip variant="outlined" label={`${t('medical.alcohol')}: ${t(`medical.alcoholLevels.${life.alcohol}`)}`} />}
          </Stack>
        </Box>
      )}
      {h.notes && <Info label={t('medical.notes')} value={h.notes} />}
    </Stack>
  );
}

/** Every saved version, newest first; expand one to read exactly what was recorded then. */
function MedicalVersions({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('patients');
  const q = useMedicalVersions(patientId, true);
  const [open, setOpen] = useState<string | null>(null);
  const lang = i18n.resolvedLanguage ?? 'ar';
  if (q.isLoading) return <PageSkeleton rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  return (
    <Box>
      <Typography fontWeight={700} sx={{ mb: 2 }}>
        {t('medical.versions')}
      </Typography>
      <Stack spacing={1}>
        {(q.data ?? []).map((v) => (
          <Card variant="outlined" key={v.id}>
            <CardActionArea onClick={() => setOpen((o) => (o === v.id ? null : v.id))} aria-expanded={open === v.id} sx={{ px: 4, py: 2 }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography fontWeight={650}>{t('medical.version', { n: v.version })}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                  {formatDateTime(v.createdAt, lang)}
                </Typography>
                {v.reviewedAt && <Chip size="small" color="success" variant="outlined" label={t('medical.reviewedShort')} />}
                <ChevronDown size={16} style={{ transform: open === v.id ? 'rotate(180deg)' : undefined }} />
              </Stack>
            </CardActionArea>
            <Collapse in={open === v.id} unmountOnExit>
              <Box sx={{ px: 4, pb: 3 }}>
                <HistoryDetails h={v} />
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
  const h = q.data;
  const lang = i18n.resolvedLanguage ?? 'ar';

  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (editing) return <Editor h={h} onDone={() => setEditing(false)} />;

  return (
    <SectionCard
      title={t('medical.title')}
      subtitle={h ? `${t('medical.version', { n: h.version })} · ${t('medical.updatedBy', { date: formatDateTime(h.createdAt, lang) })}` : undefined}
      actions={
        <Stack direction="row" spacing={1}>
          {h && (
            <Button startIcon={<History size={16} />} onClick={() => setShowVersions((v) => !v)}>
              {t('medical.versions')}
            </Button>
          )}
          {can('patients.medicalHistory.update') && (
            <Button variant="contained" startIcon={<Pencil size={16} />} onClick={() => setEditing(true)}>
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
            {h.reviewedAt ? t('medical.reviewedAt', { date: formatDate(h.reviewedAt, lang) }) : t('medical.notReviewed')}
          </Typography>
          <HistoryDetails h={h} />
          {showVersions && <MedicalVersions patientId={p.id} />}
        </Stack>
      )}
    </SectionCard>
  );
}

/** Overview card: regular medicines, past surgeries, lifestyle and pregnancy at a glance. */
export function MedicalBackgroundCard({ patientId }: { patientId: string }) {
  const { t } = useTranslation('patients');
  const q = useMedicalHistory(patientId);
  const h = q.data;
  if (q.isLoading || q.isError) return null;
  const meds = h?.medicationsList ?? [];
  const surgeries = h?.surgeries ?? [];
  const life = h?.lifestyle ?? {};
  const empty = !meds.length && !surgeries.length && !life.smoking && !life.alcohol && !h?.pregnancyWeeks;
  return (
    <SectionCard title={t('medical.background')}>
      {empty ? (
        <Typography color="text.secondary">{t('medical.backgroundEmpty')}</Typography>
      ) : (
        <Stack spacing={1}>
          {h?.pregnancyWeeks && h.conditions.includes('pregnancy') && (
            <Box>
              <Chip size="small" color="warning" label={t('medical.pregnancyValue', { n: h.pregnancyWeeks })} />
            </Box>
          )}
          {meds.length > 0 && (
            <Info
              label={t('medical.medicationsList')}
              value={
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {meds.map((m, i) => (
                    <Chip key={`${m.name}-${i}`} size="small" variant="outlined" label={<span dir="auto">{m.dose ? `${m.name} ${m.dose}` : m.name}</span>} />
                  ))}
                </Stack>
              }
            />
          )}
          {surgeries.length > 0 && (
            <Info
              label={t('medical.surgeries')}
              value={surgeries.map((s) => (s.year ? `${s.name} (${s.year})` : s.name)).join(' · ')}
            />
          )}
          {(life.smoking || life.alcohol) && (
            <Info
              label={t('medical.lifestyle')}
              value={[
                life.smoking ? t(`medical.smokingLevels.${life.smoking}`) : undefined,
                life.alcohol ? `${t('medical.alcohol')}: ${t(`medical.alcoholLevels.${life.alcohol}`)}` : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          )}
        </Stack>
      )}
    </SectionCard>
  );
}
