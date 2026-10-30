import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { CalendarCheck, Clock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PatientPicker } from '@/features/patients/components/PatientPicker';
import { getData, postData } from '@/lib/api/axios';
import { formatDate, formatTime, todayLocal } from '@/lib/dates';
import {
  dateOnly,
  freeText,
  objectId,
  optional,
  personName,
  phone,
  timeOfDay,
} from '@/shared/generated/validation/fields';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { useAvailability, useBook } from '../api';
import { localToIso, useSchedulingLookups } from './lookups';
import { useQuickBook } from './quickBookStore';

const schema = z.object({
  patient: z
    .object({ id: objectId(), fullName: z.string() })
    .nullable()
    .refine((v) => v !== null, { message: 'required' }),
  dentistId: objectId(),
  appointmentTypeId: optional(objectId()),
  durationMin: z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .int({ message: 'invalid' })
    .min(5, { message: 'too_small' })
    .max(480, { message: 'too_big' }),
  date: dateOnly(),
  time: timeOfDay(),
  chairId: optional(objectId()),
  notes: optional(freeText(1000)),
  emergency: z.boolean(),
  override: z.boolean(),
});
type Values = z.input<typeof schema>;

/** "Book appointment" drawer (06 §9): patient → dentist/type → pick a suggested slot. */
export function QuickBookDrawer() {
  const { t } = useTranslation('scheduling');
  const notify = useNotify();
  const { can } = usePermission();
  const { isOpen, preset, close } = useQuickBook();
  const lookups = useSchedulingLookups();
  const book = useBook();
  const [quickName, setQuickName] = useState<string | null>(null);
  const fullScope = can('scheduling.appointment.book', 'all');

  const initial = useMemo<Values>(() => {
    const start = preset.start ? new Date(preset.start) : null;
    return {
      patient: null,
      dentistId: preset.dentistId ?? '',
      appointmentTypeId: preset.appointmentTypeId ?? '',
      durationMin: preset.durationMin ?? 30,
      date: start ? formatDate(start, 'en', 'YYYY-MM-DD') : todayLocal(),
      time: start ? formatTime(start, 'en') : '',
      chairId: preset.chairId ?? '',
      notes: '',
      emergency: false,
      override: false,
    };
  }, [preset]);

  const form = useAppForm<Values>({ schema, defaultValues: initial });
  useEffect(() => {
    if (isOpen) form.reset(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when (re)opened
  }, [isOpen, initial]);

  // Preset patient (from the patient workspace / recalls / waiting list).
  useEffect(() => {
    if (!isOpen || !preset.patientId) return;
    void getData<{ id: string; fullName: string }>(`/patients/${preset.patientId}`).then((p) =>
      form.setValue('patient', { id: p.id, fullName: p.fullName }),
    );
  }, [isOpen, preset.patientId, form]);

  const [dentistId, typeId, date, durationMin, time, chairId] = useWatch({
    control: form.control,
    name: ['dentistId', 'appointmentTypeId', 'date', 'durationMin', 'time', 'chairId'],
  }) as [string, string, string, number | string, string, string];

  // Choosing a type proposes its default length.
  useEffect(() => {
    const type = typeId ? lookups.typeById.get(typeId) : undefined;
    if (type) form.setValue('durationMin', type.defaultDurationMin);
  }, [typeId, lookups.typeById, form]);
  // Choosing a dentist proposes their default chair.
  useEffect(() => {
    const d = dentistId ? lookups.dentistById.get(dentistId) : undefined;
    if (d?.defaultChairId && !form.getValues('chairId')) form.setValue('chairId', d.defaultChairId);
  }, [dentistId, lookups.dentistById, form]);

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '');
  const duration = Number(durationMin) || 30;
  const slots = useAvailability(
    {
      from: date,
      to: date,
      dentistId: dentistId || undefined,
      appointmentTypeId: typeId || undefined,
      durationMin: duration,
    },
    isOpen && validDate,
  );
  const daySlots = slots.data?.days[0]?.slots ?? [];
  const chosenIso = time && validDate && /^\d{2}:\d{2}$/.test(time) ? localToIso(date, time) : '';

  const onSubmit = async (raw: Values) => {
    const v = raw as z.output<typeof schema>;
    const created = await book.mutateAsync({
      patientId: v.patient!.id,
      dentistId: v.dentistId,
      ...(v.appointmentTypeId ? { appointmentTypeId: v.appointmentTypeId } : {}),
      ...(v.chairId ? { chairId: v.chairId } : {}),
      start: localToIso(v.date, v.time),
      durationMin: Number(v.durationMin),
      ...(v.notes ? { notes: v.notes } : {}),
      priority: v.emergency ? 'emergency' : 'normal',
      ...(v.override ? { override: true } : {}),
      source: preset.source ?? 'staff',
      ...(preset.recallId ? { recallId: preset.recallId } : {}),
      ...(preset.waitlistId ? { waitlistId: preset.waitlistId } : {}),
      ...(preset.plannedItemIds?.length
        ? { plannedItems: preset.plannedItemIds.map((id) => ({ treatmentPlanItemId: id })) }
        : {}),
    });
    notify.success(t('book.booked', { number: created.number }));
    close();
  };

  const dentistOptions = lookups.dentists.map((d) => ({ value: d.id, label: d.name }));
  const typeOptions = lookups.types.map((ty) => ({
    value: ty.id,
    label: lookups.typeLabel(ty.id),
  }));
  const chairOptions = lookups.chairs.map((c) => ({ value: c.id, label: c.name }));

  return (
    <>
      <FormDrawer
        open={isOpen}
        onClose={close}
        title={t('book.title')}
        subtitle={t('book.subtitle')}
        formId="quick-book"
        submitting={form.formState.isSubmitting}
        dirty={form.formState.isDirty}
        submitLabel={t('book.submit')}
        width={560}
      >
        <Form form={form} name="scheduling.book" onSubmit={onSubmit} id="quick-book">
          <Stack spacing={4}>
            <Controller
              name="patient"
              control={form.control}
              render={({ field, fieldState }) => (
                <Box data-field="patient">
                  <PatientPicker
                    name="patient"
                    value={field.value ?? null}
                    onChange={(v) => field.onChange(v)}
                    onCreate={(name) => setQuickName(name)}
                    required
                    autoFocus
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
                  options={dentistOptions}
                  required
                  clearable
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <RHFSelect
                  name="appointmentTypeId"
                  label={t('fields.type')}
                  options={typeOptions}
                  clearable
                />
              </Grid>
              <Grid item xs={7} sm={6}>
                <RHFDate
                  name="date"
                  label={t('fields.date')}
                  required
                  minDate={fullScope ? undefined : todayLocal()}
                />
              </Grid>
              <Grid item xs={5} sm={6}>
                <RHFTextField
                  name="durationMin"
                  label={t('fields.duration')}
                  type="number"
                  inputProps={{ dir: 'ltr', min: 5, step: 5 }}
                />
              </Grid>
            </Grid>

            <Box>
              <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2 }}>
                <Clock size={16} />
                <Typography variant="subtitle2">{t('book.suggested')}</Typography>
                {slots.isFetching && <CircularProgress size={14} />}
              </Stack>
              {!validDate ? null : slots.error ? (
                <Alert severity="error">{t('book.slotsError')}</Alert>
              ) : !slots.isLoading && daySlots.length === 0 ? (
                <Alert severity="info">{t('book.noSlots')}</Alert>
              ) : (
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 2,
                    maxHeight: 180,
                    overflowY: 'auto',
                  }}
                >
                  {daySlots.slice(0, 60).map((s) => {
                    const selected =
                      s.start === chosenIso && (!dentistId || s.dentistId === dentistId);
                    return (
                      <Chip
                        key={`${s.dentistId}-${s.start}`}
                        clickable
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        label={
                          dentistId
                            ? formatTime(s.start, 'en')
                            : `${formatTime(s.start, 'en')} · ${lookups.dentistById.get(s.dentistId)?.name ?? ''}`
                        }
                        onClick={() => {
                          form.setValue('time', formatTime(s.start, 'en'), {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          if (!dentistId)
                            form.setValue('dentistId', s.dentistId, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          if (s.chairId && !chairId) form.setValue('chairId', s.chairId);
                        }}
                        sx={{ direction: 'ltr' }}
                      />
                    );
                  })}
                </Box>
              )}
            </Box>

            <Grid container spacing={3}>
              <Grid item xs={6}>
                <RHFTextField
                  name="time"
                  label={t('fields.time')}
                  required
                  placeholder="09:30"
                  inputProps={{ dir: 'ltr' }}
                  helperText={t('book.timeHelper')}
                />
              </Grid>
              <Grid item xs={6}>
                <RHFSelect
                  name="chairId"
                  label={t('fields.chair')}
                  options={chairOptions}
                  clearable
                />
              </Grid>
            </Grid>
            <RHFTextField
              name="notes"
              label={t('fields.notes')}
              multiline
              minRows={2}
              maxLength={1000}
            />
            <RHFCheckbox name="emergency" label={t('book.emergency')} />
            {fullScope && (
              <RHFCheckbox
                name="override"
                label={t('book.override')}
                helperText={t('book.overrideHelper')}
              />
            )}
          </Stack>
        </Form>
      </FormDrawer>
      <QuickPatientDialog
        name={quickName}
        onClose={() => setQuickName(null)}
        onCreated={(p) => {
          form.setValue('patient', p, { shouldDirty: true, shouldValidate: true });
          setQuickName(null);
        }}
      />
    </>
  );
}

const quickSchema = z.object({
  first: personName(),
  family: personName(),
  phone: phone({ mobile: true }),
});
type QuickValues = z.input<typeof quickSchema>;

/** "Create quick patient" (name + mobile) from the booking typeahead. */
function QuickPatientDialog({
  name,
  onClose,
  onCreated,
}: {
  name: string | null;
  onClose: () => void;
  onCreated: (p: { id: string; fullName: string }) => void;
}) {
  const { t } = useTranslation('scheduling');
  const { t: tc } = useTranslation();
  const [first = '', ...rest] = (name ?? '').split(/\s+/);
  const form = useAppForm<QuickValues>({
    schema: quickSchema,
    defaultValues: { first, family: rest.join(' '), phone: '' },
  });
  useEffect(() => {
    if (name !== null) form.reset({ first, family: rest.join(' '), phone: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per opening
  }, [name]);
  const create = useMutation({
    mutationFn: (v: QuickValues) =>
      postData<{ id: string; fullName: string }>('/patients', {
        name: { first: v.first, family: v.family },
        phone: v.phone,
      }),
  });
  return (
    <Dialog open={name !== null} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('book.quickPatient')}</DialogTitle>
      <DialogContent>
        <Form
          form={form}
          name="scheduling.quickPatient"
          id="quick-patient"
          onSubmit={async (v) => onCreated(await create.mutateAsync(v))}
        >
          <Stack spacing={4} sx={{ pt: 2 }}>
            <RHFTextField name="first" label={t('book.firstName')} required maxLength={60} />
            <RHFTextField name="family" label={t('book.familyName')} required maxLength={60} />
            <RHFTextField
              name="phone"
              label={t('book.mobile')}
              required
              inputProps={{ dir: 'ltr', inputMode: 'tel' }}
            />
          </Stack>
        </Form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          type="submit"
          form="quick-patient"
          variant="contained"
          startIcon={<CalendarCheck size={16} />}
          disabled={create.isPending}
        >
          {tc('actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
