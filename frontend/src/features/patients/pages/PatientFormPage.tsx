import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Grid,
  Link,
  Stack,
  TextField,
} from '@mui/material';
import { useEffect, useMemo } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { staffApi } from '@/features/staff/api';
import {
  dateOfBirth,
  email,
  enumOf,
  freeText,
  nationalId,
  optional,
  passportNo,
  personName,
  phone,
  ageOn,
} from '@/shared/generated/validation/fields';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFDate, RHFPhone } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { useFieldAccess, usePermission } from '@/shared/rbac/usePermission';
import { patientsApi, useDuplicateCheck, type Patient } from '../api/patients';

const opt = <T extends z.ZodTypeAny>(s: T) => optional(s);

/** Same rules as the backend `patientCreateBody` (16 §5.1), guardian auto-required under 18. */
const schema = z
  .object({
    name: z.object({
      first: personName(),
      father: opt(personName()),
      grandfather: opt(personName()),
      family: personName(),
    }),
    gender: opt(enumOf(['male', 'female'])),
    dateOfBirth: opt(dateOfBirth()),
    nationalId: opt(nationalId()),
    passportNo: opt(passportNo()),
    phone: phone({ mobile: true }),
    altPhone: opt(phone()),
    email: opt(email()),
    address: z.object({ line1: opt(freeText(200)), city: opt(freeText(60)) }),
    guardian: z.object({
      name: opt(personName({ max: 120 })),
      relation: opt(freeText(40)),
      phone: opt(phone()),
    }),
    emergencyContact: z.object({
      name: opt(personName({ max: 120 })),
      relation: opt(freeText(40)),
      phone: opt(phone()),
    }),
    referralSource: opt(freeText(80)),
    preferredDentistId: opt(z.string()),
    preferredLanguage: enumOf(['ar', 'en']),
    communicationPrefs: z.object({
      whatsapp: z.boolean(),
      sms: z.boolean(),
      email: z.boolean(),
      marketing: z.boolean(),
    }),
    tags: z.array(z.string().max(30)).max(10),
    notes: opt(freeText(2000)),
  })
  .superRefine((v, ctx) => {
    if (v.dateOfBirth && ageOn(v.dateOfBirth) < 18) {
      if (!v.guardian.name)
        ctx.addIssue({ code: 'custom', path: ['guardian', 'name'], message: 'guardian_required' });
      if (!v.guardian.phone)
        ctx.addIssue({ code: 'custom', path: ['guardian', 'phone'], message: 'required' });
    }
    if (v.guardian.name && !v.guardian.phone)
      ctx.addIssue({ code: 'custom', path: ['guardian', 'phone'], message: 'required' });
    if (v.emergencyContact.name && !v.emergencyContact.phone)
      ctx.addIssue({ code: 'custom', path: ['emergencyContact', 'phone'], message: 'required' });
  });
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

function toForm(p?: Patient): Values {
  return {
    name: {
      first: p?.name.first ?? '',
      father: p?.name.father ?? '',
      grandfather: p?.name.grandfather ?? '',
      family: p?.name.family ?? '',
    },
    gender: p?.gender ?? '',
    dateOfBirth: p?.dateOfBirth ?? '',
    nationalId:
      p?.nationalId && !p.nationalId.includes('•') && !p.nationalId.includes('*')
        ? p.nationalId
        : '',
    passportNo: p?.passportNo ?? '',
    phone: p?.phone ?? '',
    altPhone: p?.altPhone ?? '',
    email: p?.email ?? '',
    address: { line1: p?.address?.line1 ?? '', city: p?.address?.city ?? '' },
    guardian: {
      name: p?.guardian?.name ?? '',
      relation: p?.guardian?.relation ?? '',
      phone: p?.guardian?.phone ?? '',
    },
    emergencyContact: {
      name: p?.emergencyContact?.name ?? '',
      relation: p?.emergencyContact?.relation ?? '',
      phone: p?.emergencyContact?.phone ?? '',
    },
    referralSource: p?.referralSource ?? '',
    preferredDentistId: p?.preferredDentist ?? '',
    preferredLanguage: p?.preferredLanguage ?? 'ar',
    communicationPrefs: {
      whatsapp: p?.communicationPrefs?.whatsapp ?? true,
      sms: p?.communicationPrefs?.sms ?? false,
      email: p?.communicationPrefs?.email ?? true,
      marketing: p?.communicationPrefs?.marketing ?? false,
    },
    tags: p?.tags ?? [],
    notes: p?.notes ?? '',
  };
}

/** Body for the API: drop empty sub-objects and (on edit) untouched fields. */
function toBody(v: Output, dirty: Record<string, unknown> | undefined) {
  const body: Record<string, unknown> = {
    name: {
      first: v.name.first,
      ...(v.name.father ? { father: v.name.father } : {}),
      ...(v.name.grandfather ? { grandfather: v.name.grandfather } : {}),
      family: v.name.family,
    },
    gender: v.gender,
    dateOfBirth: v.dateOfBirth,
    nationalId: v.nationalId,
    passportNo: v.passportNo,
    phone: v.phone,
    altPhone: v.altPhone,
    email: v.email,
    address: v.address.line1 || v.address.city ? v.address : undefined,
    guardian: v.guardian.name ? v.guardian : undefined,
    emergencyContact: v.emergencyContact.name ? v.emergencyContact : undefined,
    referralSource: v.referralSource,
    preferredDentistId: v.preferredDentistId || undefined,
    preferredLanguage: v.preferredLanguage,
    communicationPrefs: v.communicationPrefs,
    tags: v.tags,
    notes: v.notes,
  };
  const cleaned = Object.fromEntries(
    Object.entries(body).filter(([, x]) => x !== undefined && x !== ''),
  );
  if (!dirty) return cleaned;
  return Object.fromEntries(
    Object.entries(cleaned).filter(
      ([k]) => k in dirty || (k === 'preferredDentistId' && 'preferredDentistId' in dirty),
    ),
  );
}

function PatientForm({ patient }: { patient?: Patient }) {
  const { t } = useTranslation('patients');
  const navigate = useNavigate();
  const notify = useNotify();
  const create = patientsApi.useCreate();
  const update = patientsApi.useUpdate();
  const access = useFieldAccess('patients.patient', 'write');
  const { can } = usePermission();
  const dentists = staffApi.useList(
    { limit: 100, bookable: 'true', status: 'active' },
    { enabled: can('staff.member.read', 'all') },
  );
  const form = useAppForm<Values>({ schema, defaultValues: toForm(patient) });
  const dobRaw: unknown = useWatch({ control: form.control, name: 'dateOfBirth' });
  const phoneRaw: unknown = useWatch({ control: form.control, name: 'phone' });
  const dob = typeof dobRaw === 'string' ? dobRaw : '';
  const duplicates = useDuplicateCheck(typeof phoneRaw === 'string' ? phoneRaw : undefined, patient?.id);
  const isMinor = useMemo(
    () => (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob) ? ageOn(dob) < 18 : false),
    [dob],
  );

  useEffect(() => {
    if (patient) form.reset(toForm(patient));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id, patient?.version]);

  const onSubmit = async (values: Values) => {
    const v = values as unknown as Output;
    if (patient) {
      const body = toBody(v, form.formState.dirtyFields as Record<string, unknown>);
      await update.mutateAsync({
        id: patient.id,
        version: patient.version,
        ...(body as Partial<Patient>),
      });
      notify.success(t('saved'));
      navigate(`/clinic/patients/${patient.id}`);
    } else {
      const created = await create.mutateAsync(toBody(v, undefined) as Partial<Patient>);
      notify.success(t('created'));
      navigate(`/clinic/patients/${created.id}`, { replace: true });
    }
  };

  const dupes = (duplicates.data ?? []).filter((d) => d.id !== patient?.id);

  return (
    <FieldScope value={access}>
      <Form
        form={form}
        name={patient ? 'patient.update' : 'patient.create'}
        onSubmit={onSubmit}
        requiredLegend
        guardUnsaved
      >
        <SectionCard title={t('sections.personal')}>
          <Grid container spacing={4}>
            <Grid item xs={12} sm={6} md={3}>
              <RHFTextField
                name="name.first"
                label={t('fields.first')}
                required
                autoFocus
                fieldKey="name"
                maxLength={60}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <RHFTextField
                name="name.father"
                label={t('fields.father')}
                fieldKey="name"
                maxLength={60}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <RHFTextField
                name="name.grandfather"
                label={t('fields.grandfather')}
                fieldKey="name"
                maxLength={60}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <RHFTextField
                name="name.family"
                label={t('fields.family')}
                required
                fieldKey="name"
                maxLength={60}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <RHFSelect
                name="gender"
                label={t('fields.gender')}
                fieldKey="gender"
                clearable
                options={(['male', 'female'] as const).map((g) => ({
                  value: g,
                  label: t(`genders.${g}`),
                }))}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <RHFDate
                name="dateOfBirth"
                label={t('fields.dateOfBirth')}
                fieldKey="dateOfBirth"
                disableFuture
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <RHFTextField
                name="nationalId"
                label={t('fields.nationalId')}
                fieldKey="nationalId"
                helperText={patient?.nationalId?.includes('•') ? patient.nationalId : undefined}
                inputProps={{ dir: 'ltr', inputMode: 'numeric', maxLength: 10 }}
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard title={t('sections.contact')}>
          {dupes.length > 0 && (
            <Alert severity="warning" sx={{ mb: 4 }}>
              {t('duplicateWarning')}{' '}
              {dupes.map((d) => (
                <Link
                  key={d.id}
                  component={RouterLink}
                  to={`/clinic/patients/${d.id}`}
                  sx={{ mx: 1 }}
                >
                  <span dir="auto">{d.fullName}</span> ({d.fileNumber})
                </Link>
              ))}
            </Alert>
          )}
          <Grid container spacing={4}>
            <Grid item xs={12} md={6}>
              <RHFPhone name="phone" label={t('fields.phone')} required fieldKey="phone" />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFPhone name="altPhone" label={t('fields.altPhone')} fieldKey="altPhone" />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="email"
                label={t('fields.email')}
                type="email"
                fieldKey="email"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="address.line1"
                label={t('fields.addressLine1')}
                fieldKey="address"
                maxLength={200}
              />
            </Grid>
            <Grid item xs={12} md={2}>
              <RHFTextField
                name="address.city"
                label={t('fields.city')}
                fieldKey="address"
                maxLength={60}
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard title={t('sections.guardian')} subtitle={t('sections.guardianHint')}>
          {isMinor && (
            <Alert severity="info" sx={{ mb: 4 }}>
              {t('sections.guardianHint')}
            </Alert>
          )}
          <Grid container spacing={4}>
            <Grid item xs={12} md={5}>
              <RHFTextField
                name="guardian.name"
                label={t('fields.guardianName')}
                required={isMinor}
                fieldKey="guardian"
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <RHFTextField
                name="guardian.relation"
                label={t('fields.relation')}
                fieldKey="guardian"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFPhone
                name="guardian.phone"
                label={t('fields.guardianPhone')}
                required={isMinor}
                fieldKey="guardian"
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard title={t('sections.emergency')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={5}>
              <RHFTextField
                name="emergencyContact.name"
                label={t('fields.emergencyName')}
                fieldKey="emergencyContact"
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <RHFTextField
                name="emergencyContact.relation"
                label={t('fields.relation')}
                fieldKey="emergencyContact"
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFPhone
                name="emergencyContact.phone"
                label={t('fields.emergencyPhone')}
                fieldKey="emergencyContact"
              />
            </Grid>
          </Grid>
        </SectionCard>

        <SectionCard title={t('sections.preferences')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="preferredDentistId"
                label={t('fields.preferredDentist')}
                fieldKey="preferredDentist"
                clearable
                options={(dentists.data?.data ?? []).map((d) => ({ value: d.id, label: d.name }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="preferredLanguage"
                label={t('fields.preferredLanguage')}
                fieldKey="preferredLanguage"
                options={[
                  { value: 'ar', label: 'العربية' },
                  { value: 'en', label: 'English' },
                ]}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="referralSource"
                label={t('fields.referralSource')}
                fieldKey="referralSource"
                maxLength={80}
              />
            </Grid>
            <Grid item xs={12}>
              <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                <RHFCheckbox
                  name="communicationPrefs.whatsapp"
                  label={t('fields.commWhatsapp')}
                  fieldKey="communicationPrefs"
                />
                <RHFCheckbox
                  name="communicationPrefs.sms"
                  label={t('fields.commSms')}
                  fieldKey="communicationPrefs"
                />
                <RHFCheckbox
                  name="communicationPrefs.email"
                  label={t('fields.commEmail')}
                  fieldKey="communicationPrefs"
                />
                <RHFCheckbox
                  name="communicationPrefs.marketing"
                  label={t('fields.commMarketing')}
                  fieldKey="communicationPrefs"
                />
              </Stack>
            </Grid>
            {access.canSee('tags') && (
              <Grid item xs={12}>
                <Controller
                  name="tags"
                  control={form.control}
                  render={({ field }) => (
                    <Autocomplete
                      multiple
                      freeSolo
                      options={['VIP', 'Ortho', 'Implant', 'Kids', 'Insurance']}
                      value={field.value}
                      disabled={!access.canEdit('tags')}
                      onChange={(_e, v) =>
                        field.onChange(v.map((x) => String(x).slice(0, 30)).slice(0, 10))
                      }
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => (
                          <Chip
                            size="small"
                            label={option}
                            {...getTagProps({ index })}
                            key={option}
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('fields.tags')}
                          helperText={t('fields.tagsHelper')}
                        />
                      )}
                    />
                  )}
                />
              </Grid>
            )}
          </Grid>
        </SectionCard>

        <SectionCard title={t('sections.notes')}>
          <RHFTextField
            name="notes"
            label={t('fields.notes')}
            fieldKey="notes"
            multiline
            minRows={3}
            maxLength={2000}
          />
        </SectionCard>

        <Box
          sx={(th) => ({
            position: 'sticky',
            bottom: 0,
            py: 3,
            px: 4,
            mx: -4,
            display: 'flex',
            gap: 2,
            justifyContent: 'flex-end',
            bgcolor: th.palette.background.default,
            borderTop: 1,
            borderColor: 'divider',
            zIndex: 5,
          })}
        >
          <Button onClick={() => navigate(-1)}>{t('common:actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? t('common:states.saving')
              : patient
                ? t('common:actions.saveChanges')
                : t('new')}
          </Button>
        </Box>
      </Form>
    </FieldScope>
  );
}

export function PatientCreatePage() {
  const { t } = useTranslation('patients');
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/clinic/patients' }, { label: t('newTitle') }]}
        title={t('newTitle')}
      />
      <PatientForm />
    </>
  );
}

export function PatientEditPage() {
  const { t } = useTranslation('patients');
  const { id } = useParams();
  const q = patientsApi.useItem(id);
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: t('title'), to: '/clinic/patients' },
          { label: q.data.fullName, to: `/clinic/patients/${q.data.id}` },
          { label: t('editTitle') },
        ]}
        title={t('editTitle')}
      />
      <PatientForm patient={q.data} />
    </>
  );
}
