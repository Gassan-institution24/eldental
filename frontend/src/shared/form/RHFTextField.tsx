import { InputAdornment, TextField, Tooltip, type TextFieldProps } from '@mui/material';
import { Lock } from 'lucide-react';
import { Controller, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { useRegisterLabel } from './fieldLabels';
import { useErrorText } from './useFieldError';

export type RHFTextFieldProps = Omit<TextFieldProps, 'name' | 'label' | 'error'> & {
  name: string;
  label: string;
  /** Field-registry key; hidden → not rendered, masked → locked masked value, read → disabled. */
  fieldKey?: string;
  maxLength?: number;
  /** Optional transform for display → form value (e.g. digits only). */
  parse?: (raw: string) => unknown;
};

/** Text input bound to RHF with translated errors, label registry, counter and field access. */
export function RHFTextField({ name, label, fieldKey, required, helperText, maxLength, parse, inputProps, disabled, ...rest }: RHFTextFieldProps) {
  const { control } = useFormContext();
  const { t } = useTranslation();
  const errorText = useErrorText();
  const scope = useFieldScope();
  useRegisterLabel(name, label);

  if (fieldKey && !scope.canSee(fieldKey)) return null;
  const masked = fieldKey ? scope.isMasked(fieldKey) : false;
  const readOnly = fieldKey ? !scope.canEdit(fieldKey) : false;
  const fullLabel = required ? `${label} *` : label;

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const value = (field.value ?? '') as string;
        const counter = maxLength && value.length >= maxLength * 0.8 ? `${value.length}/${maxLength}` : undefined;
        const message = errorText(fieldState.error, label);
        return (
          <TextField
            {...rest}
            id={`field-${name.replace(/\./g, '-')}`}
            name={field.name}
            inputRef={field.ref}
            label={fullLabel}
            value={masked ? value || '••••' : value}
            onChange={(e) => field.onChange(parse ? parse(e.target.value) : e.target.value)}
            onBlur={field.onBlur}
            disabled={disabled || masked || readOnly}
            error={Boolean(fieldState.error)}
            helperText={message ?? counter ?? helperText}
            inputProps={{ dir: 'auto', maxLength, 'aria-required': required, ...inputProps }}
            InputProps={{
              ...rest.InputProps,
              ...(masked
                ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title={t('states.masked')}>
                          <Lock size={16} aria-label={t('states.masked')} />
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }
                : {}),
            }}
          />
        );
      }}
    />
  );
}
