import { Checkbox, FormControlLabel, FormHelperText, Switch, Box } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { Controller, useFormContext } from 'react-hook-form';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { useRegisterLabel } from './fieldLabels';
import { MoneyInput } from './MoneyInput';
import { OtpInput } from './OtpInput';
import { PhoneInput } from './PhoneInput';
import { useErrorText } from './useFieldError';

type Base = { name: string; label: string; required?: boolean; fieldKey?: string; helperText?: string; disabled?: boolean };

function useAccess(fieldKey?: string) {
  const scope = useFieldScope();
  if (!fieldKey) return { visible: true, readOnly: false, masked: false };
  return { visible: scope.canSee(fieldKey), readOnly: !scope.canEdit(fieldKey), masked: scope.isMasked(fieldKey) };
}

export function RHFMoney({ name, label, required, fieldKey, helperText, disabled, currency }: Base & { currency: string }) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  const access = useAccess(fieldKey);
  useRegisterLabel(name, label);
  if (!access.visible) return null;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <MoneyInput
          id={`field-${name.replace(/\./g, '-')}`}
          name={field.name}
          inputRef={field.ref}
          label={required ? `${label} *` : label}
          value={field.value as number | undefined}
          onChange={field.onChange}
          onBlur={field.onBlur}
          currency={currency}
          disabled={disabled || access.readOnly || access.masked}
          error={Boolean(fieldState.error)}
          helperText={errorText(fieldState.error, label) ?? helperText}
        />
      )}
    />
  );
}

export function RHFPhone({ name, label, required, fieldKey, helperText, disabled }: Base) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  const access = useAccess(fieldKey);
  useRegisterLabel(name, label);
  if (!access.visible) return null;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <PhoneInput
          id={`field-${name.replace(/\./g, '-')}`}
          name={field.name}
          inputRef={field.ref}
          label={required ? `${label} *` : label}
          value={field.value as string | undefined}
          onChange={field.onChange}
          onBlur={field.onBlur}
          required={required}
          disabled={disabled || access.readOnly || access.masked}
          error={Boolean(fieldState.error)}
          helperText={errorText(fieldState.error, label) ?? helperText}
        />
      )}
    />
  );
}

export function RHFOtp({ name, label, onComplete, autoFocus }: Base & { onComplete?: (v: string) => void; autoFocus?: boolean }) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  useRegisterLabel(name, label);
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <OtpInput
          name={field.name}
          value={(field.value as string | undefined) ?? ''}
          onChange={field.onChange}
          onComplete={onComplete}
          autoFocus={autoFocus}
          error={Boolean(fieldState.error)}
          helperText={errorText(fieldState.error, label)}
        />
      )}
    />
  );
}

export function RHFCheckbox({ name, label, helperText, disabled, fieldKey, asSwitch }: Base & { asSwitch?: boolean }) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  const access = useAccess(fieldKey);
  useRegisterLabel(name, label);
  if (!access.visible) return null;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const Control = asSwitch ? Switch : Checkbox;
        return (
          <Box data-field={name}>
            <FormControlLabel
              control={<Control checked={Boolean(field.value)} onChange={(e) => field.onChange(e.target.checked)} onBlur={field.onBlur} inputRef={field.ref} name={field.name} />}
              label={label}
              disabled={disabled || access.readOnly}
            />
            {(fieldState.error || helperText) && <FormHelperText error={Boolean(fieldState.error)}>{errorText(fieldState.error, label) ?? helperText}</FormHelperText>}
          </Box>
        );
      }}
    />
  );
}

/** Clinic-local calendar date; the form value is `YYYY-MM-DD`. Typing DD/MM/YYYY is allowed. */
export function RHFDate({ name, label, required, fieldKey, helperText, disabled, disableFuture, minDate, maxDate }: Base & { disableFuture?: boolean; minDate?: string; maxDate?: string }) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  const access = useAccess(fieldKey);
  useRegisterLabel(name, label);
  if (!access.visible) return null;
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <DatePicker
          label={required ? `${label} *` : label}
          value={field.value ? dayjs(field.value as string) : null}
          onChange={(v) => field.onChange(v && v.isValid() ? v.format('YYYY-MM-DD') : v ? 'invalid' : '')}
          format="DD/MM/YYYY"
          disableFuture={disableFuture}
          minDate={minDate ? dayjs(minDate) : undefined}
          maxDate={maxDate ? dayjs(maxDate) : undefined}
          disabled={disabled || access.readOnly || access.masked}
          inputRef={field.ref}
          slotProps={{
            textField: {
              id: `field-${name.replace(/\./g, '-')}`,
              name: field.name,
              onBlur: field.onBlur,
              error: Boolean(fieldState.error),
              helperText: errorText(fieldState.error, label) ?? helperText,
              fullWidth: true,
              size: 'small',
            },
          }}
        />
      )}
    />
  );
}
