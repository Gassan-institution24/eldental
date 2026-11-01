import { Autocomplete, Chip, Grid, TextField } from '@mui/material';
import { Star } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useRegisterLabel } from '@/shared/form/fieldLabels';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { useErrorText } from '@/shared/form/useFieldError';
import { DENTAL_SPECIALTIES, type DentalSpecialty } from '@/shared/generated/dental/specialties';
import { useFieldScope } from '@/shared/rbac/fieldAccess';

/** Specialty name in the UI language; codes are stored, names are never typed by users (07 §13). */
export function useSpecialtyName() {
  const { t } = useTranslation('staff');
  return (code: string) => t(`specialties.${code}`, { defaultValue: code });
}

/**
 * Multi-select of the fixed dental specialties + the primary one (07 §13). Expects form fields
 * `specialties: string[]` and `primarySpecialty: string`. Field access key: `specialties`.
 */
export function SpecialtyFields() {
  const { t } = useTranslation('staff');
  const name = useSpecialtyName();
  const { control, getValues, setValue } = useFormContext();
  const scope = useFieldScope();
  const errorText = useErrorText();
  useRegisterLabel('specialties', t('fields.specialties'));
  const watched = useWatch({ control, name: 'specialties' }) as string[] | undefined;
  const chosen = useMemo(() => watched ?? [], [watched]);
  // Keep the primary specialty consistent with the list: first pick becomes primary, removal clears it.
  useEffect(() => {
    const primary = getValues('primarySpecialty') as string;
    if (chosen.length && !chosen.includes(primary))
      setValue('primarySpecialty', chosen[0], { shouldDirty: true });
    if (!chosen.length && primary) setValue('primarySpecialty', '', { shouldDirty: true });
  }, [chosen, getValues, setValue]);
  if (!scope.canSee('specialties')) return null;
  const readOnly = !scope.canEdit('specialties');

  return (
    <>
      <Grid item xs={12} md={8}>
        <Controller
          name="specialties"
          control={control}
          render={({ field, fieldState }) => (
            <Autocomplete<DentalSpecialty, true>
              multiple
              options={[...DENTAL_SPECIALTIES]}
              value={(field.value as DentalSpecialty[] | undefined) ?? []}
              disabled={readOnly}
              getOptionLabel={(o) => name(o)}
              onChange={(_e, v) => field.onChange(v)}
              onBlur={field.onBlur}
              filterSelectedOptions
              renderTags={(value, getTagProps) =>
                value.map((code, i) => {
                  const { key, ...rest } = getTagProps({ index: i });
                  return <Chip key={key} {...rest} size="small" label={name(code)} />;
                })
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  id="field-specialties"
                  name={field.name}
                  inputRef={field.ref}
                  label={t('fields.specialties')}
                  error={Boolean(fieldState.error)}
                  helperText={
                    errorText(fieldState.error, t('fields.specialties')) ?? t('specialtiesHint')
                  }
                  inputProps={{ ...params.inputProps, 'data-testid': 'specialties-input' }}
                />
              )}
            />
          )}
        />
      </Grid>
      <Grid item xs={12} md={4}>
        <RHFSelect
          name="primarySpecialty"
          label={t('fields.primarySpecialty')}
          fieldKey="specialties"
          required={chosen.length > 0}
          disabled={!chosen.length}
          options={chosen.map((c) => ({ value: c, label: name(c) }))}
          helperText={chosen.length > 1 ? t('primarySpecialtyHint') : undefined}
        />
      </Grid>
    </>
  );
}

/** Read-only chips, primary first and starred. */
export function SpecialtyChips({
  specialties,
  primary,
}: {
  specialties?: string[];
  primary?: string;
}) {
  const name = useSpecialtyName();
  if (!specialties?.length) return null;
  const ordered = [...specialties].sort((a, b) => Number(b === primary) - Number(a === primary));
  return (
    <>
      {ordered.map((c) => (
        <Chip
          key={c}
          size="small"
          variant={c === primary ? 'filled' : 'outlined'}
          color={c === primary ? 'secondary' : 'default'}
          icon={c === primary ? <Star size={12} /> : undefined}
          label={name(c)}
        />
      ))}
    </>
  );
}
