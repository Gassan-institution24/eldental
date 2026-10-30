import { Autocomplete, MenuItem, TextField } from '@mui/material';
import { Controller, useFormContext } from 'react-hook-form';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { useRegisterLabel } from './fieldLabels';
import { useErrorText } from './useFieldError';

export type Option = { value: string; label: string; disabled?: boolean };

type Props = {
  name: string;
  label: string;
  options: Option[];
  required?: boolean;
  fieldKey?: string;
  helperText?: string;
  disabled?: boolean;
  /** Allow clearing to an empty value. */
  clearable?: boolean;
};

/** Select; becomes a searchable Autocomplete for more than 7 options (16 §5.3). */
export function RHFSelect({
  name,
  label,
  options,
  required,
  fieldKey,
  helperText,
  disabled,
  clearable,
}: Props) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  const scope = useFieldScope();
  useRegisterLabel(name, label);
  if (fieldKey && !scope.canSee(fieldKey)) return null;
  const readOnly = fieldKey ? !scope.canEdit(fieldKey) : false;
  const fullLabel = required ? `${label} *` : label;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const message = errorText(fieldState.error, label) ?? helperText;
        if (options.length > 7) {
          const selected = options.find((o) => o.value === field.value) ?? null;
          return (
            <Autocomplete
              options={options}
              value={selected}
              disabled={disabled || readOnly}
              getOptionLabel={(o) => o.label}
              getOptionDisabled={(o) => Boolean(o.disabled)}
              isOptionEqualToValue={(a, b) => a.value === b.value}
              disableClearable={!clearable}
              onChange={(_e, v) => field.onChange(v?.value ?? '')}
              onBlur={field.onBlur}
              renderInput={(params) => (
                <TextField
                  {...params}
                  id={`field-${name.replace(/\./g, '-')}`}
                  name={field.name}
                  inputRef={field.ref}
                  label={fullLabel}
                  error={Boolean(fieldState.error)}
                  helperText={message}
                />
              )}
            />
          );
        }
        return (
          <TextField
            select
            id={`field-${name.replace(/\./g, '-')}`}
            name={field.name}
            inputRef={field.ref}
            label={fullLabel}
            value={(field.value as string | undefined) ?? ''}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
            disabled={disabled || readOnly}
            error={Boolean(fieldState.error)}
            helperText={message}
          >
            {clearable && <MenuItem value="">—</MenuItem>}
            {options.map((o) => (
              <MenuItem key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        );
      }}
    />
  );
}
