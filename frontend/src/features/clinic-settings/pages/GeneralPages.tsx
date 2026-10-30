import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Grid,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Copy } from 'lucide-react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  email,
  enumOf,
  freeText,
  nullable,
  optional,
  phone,
  taxNumber,
  timeOfDay,
  entityName,
} from '@/shared/generated/validation/fields';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFPhone } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useErrorText } from '@/shared/form/useFieldError';
import { SectionCard } from '@/shared/components/SectionCard';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { useClinic, useUpdateClinic, type Clinic } from '../api';

const TIMEZONES = [
  'Asia/Amman',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Baghdad',
  'Asia/Beirut',
  'Asia/Damascus',
  'Asia/Jerusalem',
  'Africa/Cairo',
  'Europe/Istanbul',
  'Europe/London',
  'UTC',
];

function useClinicGate() {
  const q = useClinic();
  const { can } = usePermission();
  return { q, readOnly: !can('clinic.settings.update') };
}

/* ---------------- profile ---------------- */

const profileSchema = z.object({
  name: entityName(),
  phone: nullable(phone()),
  email: nullable(email()),
  addressLine1: optional(freeText(200)),
  taxNumber: nullable(taxNumber()),
  commercialRegNo: optional(freeText(40)),
  timezone: z.string().min(1, { message: 'required' }),
  locale: enumOf(['ar', 'en']),
  printLanguage: enumOf(['ar', 'en']),
  invoiceFooter: optional(freeText(500)),
});
type Profile = z.input<typeof profileSchema>;

function ProfileForm({ clinic, readOnly }: { clinic: Clinic; readOnly: boolean }) {
  const { t } = useTranslation('settings');
  const notify = useNotify();
  const update = useUpdateClinic();
  const form = useAppForm<Profile>({
    schema: profileSchema,
    defaultValues: {
      name: clinic.name,
      phone: clinic.phone ?? '',
      email: clinic.email ?? '',
      addressLine1: clinic.addressLine1 ?? '',
      taxNumber: clinic.taxNumber ?? '',
      commercialRegNo: clinic.commercialRegNo ?? '',
      timezone: clinic.timezone,
      locale: clinic.locale,
      printLanguage: clinic.settings.printLanguage ?? 'ar',
      invoiceFooter: clinic.settings.invoiceFooter ?? '',
    },
  });

  const onSubmit = async (v: Profile) => {
    const { printLanguage, invoiceFooter, ...rest } = v;
    const saved = await update.mutateAsync({
      ...rest,
      version: clinic.version,
      settings: { printLanguage, invoiceFooter: invoiceFooter ?? '' },
    });
    form.reset(form.getValues());
    void saved;
    notify.success(t('general.saved'));
  };

  const langs = (['ar', 'en'] as const).map((l) => ({
    value: l,
    label: t(`general.languages.${l}`),
  }));

  return (
    <Form form={form} name="settings.profile" onSubmit={onSubmit} guardUnsaved>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SectionCard title={t('general.identity')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={8}>
              <RHFTextField name="name" label={t('general.name')} required maxLength={120} />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField
                label={t('general.slug')}
                value={`/book/${clinic.slug}`}
                disabled
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
          </Grid>
        </SectionCard>
        <SectionCard title={t('general.contact')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={6}>
              <RHFPhone name="phone" label={t('general.phone')} />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="email"
                label={t('general.email')}
                type="email"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={12}>
              <RHFTextField name="addressLine1" label={t('general.address')} maxLength={200} />
            </Grid>
          </Grid>
        </SectionCard>
        <SectionCard title={t('general.legal')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="taxNumber"
                label={t('general.taxNumber')}
                inputProps={{ dir: 'ltr', inputMode: 'numeric' }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="commercialRegNo"
                label={t('general.commercialRegNo')}
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={12}>
              <RHFTextField
                name="invoiceFooter"
                label={t('general.invoiceFooter')}
                helperText={t('general.invoiceFooterHelper')}
                multiline
                minRows={2}
                maxLength={500}
              />
            </Grid>
          </Grid>
        </SectionCard>
        <SectionCard
          title={t('general.regional')}
          footer={
            !readOnly && (
              <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
                {t('common:actions.saveChanges')}
              </Button>
            )
          }
        >
          <Grid container spacing={4}>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="timezone"
                label={t('general.timezone')}
                required
                options={TIMEZONES.map((z) => ({ value: z, label: z }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFSelect name="locale" label={t('general.locale')} required options={langs} />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="printLanguage"
                label={t('general.printLanguage')}
                required
                options={langs}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField label={t('general.currency')} value={clinic.currency} disabled />
            </Grid>
          </Grid>
        </SectionCard>
      </fieldset>
    </Form>
  );
}

export function GeneralSettingsPage() {
  const { t } = useTranslation('settings');
  const { q, readOnly } = useClinicGate();
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      {readOnly && (
        <Alert severity="info" sx={{ mb: 5 }}>
          {t('common.readOnly')}
        </Alert>
      )}
      <ProfileForm clinic={q.data} readOnly={readOnly} />
    </>
  );
}

/* ---------------- working hours ---------------- */

const hoursSchema = z.object({
  workingHours: z
    .array(
      z.object({ weekday: z.number(), open: timeOfDay(), close: timeOfDay(), closed: z.boolean() }),
    )
    .superRefine((days, ctx) => {
      days.forEach((d, i) => {
        if (!d.closed && d.close <= d.open)
          ctx.addIssue({ code: 'custom', path: [i, 'close'], message: 'end_before_start' });
      });
    }),
  weekendDays: z.array(z.number()),
});
type Hours = z.infer<typeof hoursSchema>;

/** Weekday order for display: Saturday-first is common in Jordan; we start on Sunday like the data. */
const ORDER = [6, 0, 1, 2, 3, 4, 5];

function HoursForm({ clinic, readOnly }: { clinic: Clinic; readOnly: boolean }) {
  const { t } = useTranslation('settings');
  const notify = useNotify();
  const update = useUpdateClinic();
  const errorText = useErrorText();
  const form = useAppForm<Hours>({
    schema: hoursSchema,
    defaultValues: {
      workingHours: [...clinic.workingHours].sort((a, b) => a.weekday - b.weekday),
      weekendDays: clinic.settings.weekendDays ?? [5],
    },
  });
  const { fields } = useFieldArray({ control: form.control, name: 'workingHours' });
  const values = useWatch({ control: form.control, name: 'workingHours' });

  const copyFrom = (index: number) => {
    const src = values[index];
    if (!src) return;
    values.forEach((d, i) => {
      if (!d.closed && i !== index) {
        form.setValue(`workingHours.${i}.open`, src.open, { shouldDirty: true });
        form.setValue(`workingHours.${i}.close`, src.close, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    });
  };

  const onSubmit = async (v: Hours) => {
    await update.mutateAsync({
      version: clinic.version,
      workingHours: v.workingHours,
      settings: { weekendDays: v.weekendDays },
    });
    form.reset(v);
    notify.success(t('hours.saved'));
  };

  return (
    <Form form={form} name="settings.hours" onSubmit={onSubmit} guardUnsaved>
      <SectionCard
        title={t('hours.title')}
        subtitle={t('hours.subtitle')}
        footer={
          !readOnly && (
            <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
              {t('common:actions.saveChanges')}
            </Button>
          )
        }
      >
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
          {ORDER.map((weekday) => {
            const i = fields.findIndex((f) => f.weekday === weekday);
            if (i < 0) return null;
            const closed = values[i]?.closed;
            return (
              <Stack
                key={fields[i]?.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={3}
                alignItems={{ sm: 'center' }}
                sx={{ py: 3 }}
              >
                <Typography fontWeight={700} sx={{ width: 120 }}>
                  {t(`hours.days.${weekday}`)}
                </Typography>
                <Controller
                  name={`workingHours.${i}.closed`}
                  control={form.control}
                  render={({ field }) => (
                    <FormControlLabel
                      sx={{ width: 120 }}
                      control={
                        <Switch
                          checked={!field.value}
                          onChange={(e) => field.onChange(!e.target.checked)}
                          disabled={readOnly}
                        />
                      }
                      label={field.value ? t('hours.closed') : t('hours.openDay')}
                    />
                  )}
                />
                {!closed && (
                  <>
                    {(['open', 'close'] as const).map((k) => (
                      <Controller
                        key={k}
                        name={`workingHours.${i}.${k}`}
                        control={form.control}
                        render={({ field, fieldState }) => (
                          <TextField
                            {...field}
                            id={`field-workingHours-${i}-${k}`}
                            type="time"
                            label={t(`hours.${k}`)}
                            disabled={readOnly}
                            error={Boolean(fieldState.error)}
                            helperText={errorText(fieldState.error, t(`hours.${k}`))}
                            inputProps={{ step: 900, dir: 'ltr' }}
                            sx={{ maxWidth: 160 }}
                          />
                        )}
                      />
                    ))}
                    {!readOnly && (
                      <Tooltip title={t('hours.copyToAll')}>
                        <IconButton onClick={() => copyFrom(i)} aria-label={t('hours.copyToAll')}>
                          <Copy size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </>
                )}
              </Stack>
            );
          })}
        </Stack>
        <Box sx={{ mt: 6 }}>
          <Typography fontWeight={700}>{t('hours.weekend')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('hours.weekendHelper')}
          </Typography>
          <Controller
            name="weekendDays"
            control={form.control}
            render={({ field }) => (
              <Stack direction="row" sx={{ flexWrap: 'wrap', mt: 2 }}>
                {ORDER.map((d) => (
                  <FormControlLabel
                    key={d}
                    disabled={readOnly}
                    control={
                      <Checkbox
                        checked={field.value.includes(d)}
                        onChange={(e) =>
                          field.onChange(
                            e.target.checked
                              ? [...field.value, d]
                              : field.value.filter((x) => x !== d),
                          )
                        }
                      />
                    }
                    label={t(`hours.days.${d}`)}
                  />
                ))}
              </Stack>
            )}
          />
        </Box>
      </SectionCard>
    </Form>
  );
}

export function HoursPage() {
  const { q, readOnly } = useClinicGate();
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <HoursForm clinic={q.data} readOnly={readOnly} />;
}

/* ---------------- booking & billing rules ---------------- */

const int = (min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .int({ message: 'invalid' })
    .min(min, { message: 'too_small' })
    .max(max, { message: 'too_big' });
const rulesSchema = z.object({
  cancellationWindowHours: int(0, 168),
  noShowGraceMinutes: int(0, 240),
  defaultAppointmentMinutes: int(5, 480),
  onlineBookingEnabled: z.boolean(),
  minOnlineLeadHours: int(0, 168),
  maxOnlineDaysAhead: int(1, 365),
  vatRegistered: z.boolean(),
  maxDiscountPercentWithoutApproval: z.coerce
    .number()
    .min(0, { message: 'out_of_range' })
    .max(100, { message: 'out_of_range' }),
  fiscalYearStartMonth: z.coerce.number().int().min(1).max(12),
  consentMode: enumOf(['off', 'warn', 'strict']),
});
type Rules = z.input<typeof rulesSchema>;

function RulesForm({ clinic, readOnly }: { clinic: Clinic; readOnly: boolean }) {
  const { t } = useTranslation('settings');
  const notify = useNotify();
  const update = useUpdateClinic();
  const s = clinic.settings;
  const form = useAppForm<Rules>({
    schema: rulesSchema,
    defaultValues: {
      cancellationWindowHours: s.cancellationWindowHours,
      noShowGraceMinutes: s.noShowGraceMinutes,
      defaultAppointmentMinutes: s.defaultAppointmentMinutes,
      onlineBookingEnabled: s.onlineBookingEnabled,
      minOnlineLeadHours: s.minOnlineLeadHours,
      maxOnlineDaysAhead: s.maxOnlineDaysAhead,
      vatRegistered: s.vatRegistered,
      maxDiscountPercentWithoutApproval: s.maxDiscountPercentWithoutApproval,
      // Select values are strings; the schema coerces back to a number.
      fiscalYearStartMonth: String(s.fiscalYearStartMonth) as unknown as number,
      consentMode: s.consentMode ?? 'warn',
    },
  });
  const onSubmit = async (v: Rules) => {
    await update.mutateAsync({ version: clinic.version, settings: v });
    form.reset(v);
    notify.success(t('booking.saved'));
  };
  const num = { type: 'number', inputProps: { dir: 'ltr', inputMode: 'numeric' as const } };
  return (
    <Form form={form} name="settings.rules" onSubmit={onSubmit} guardUnsaved>
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SectionCard title={t('booking.title')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="defaultAppointmentMinutes"
                label={t('booking.defaultAppointmentMinutes')}
                {...num}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="cancellationWindowHours"
                label={t('booking.cancellationWindowHours')}
                {...num}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="noShowGraceMinutes"
                label={t('booking.noShowGraceMinutes')}
                {...num}
              />
            </Grid>
            <Grid item xs={12}>
              <RHFCheckbox
                name="onlineBookingEnabled"
                label={t('booking.onlineBookingEnabled')}
                asSwitch
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="minOnlineLeadHours"
                label={t('booking.minOnlineLeadHours')}
                {...num}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="maxOnlineDaysAhead"
                label={t('booking.maxOnlineDaysAhead')}
                {...num}
              />
            </Grid>
          </Grid>
        </SectionCard>
        <SectionCard
          title={t('booking.billing')}
          footer={
            !readOnly && (
              <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
                {t('common:actions.saveChanges')}
              </Button>
            )
          }
        >
          <Grid container spacing={4}>
            <Grid item xs={12}>
              <RHFCheckbox name="vatRegistered" label={t('booking.vatRegistered')} asSwitch />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="maxDiscountPercentWithoutApproval"
                label={t('booking.maxDiscountPercentWithoutApproval')}
                {...num}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="fiscalYearStartMonth"
                label={t('booking.fiscalYearStartMonth')}
                options={Array.from({ length: 12 }, (_, i) => ({
                  value: String(i + 1),
                  label: t(`booking.months.${i + 1}`),
                }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="consentMode"
                label={t('booking.consentMode')}
                options={(['off', 'warn', 'strict'] as const).map((m) => ({
                  value: m,
                  label: t(`booking.consentModes.${m}`),
                }))}
              />
            </Grid>
          </Grid>
        </SectionCard>
      </fieldset>
    </Form>
  );
}

export function BookingRulesPage() {
  const { q, readOnly } = useClinicGate();
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <RulesForm clinic={q.data} readOnly={readOnly} />;
}
