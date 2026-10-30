import { Box, ButtonBase, FormHelperText, FormLabel, Stack, Tooltip } from '@mui/material';
import { Check } from 'lucide-react';
import { Controller, useFormContext } from 'react-hook-form';
import { useRegisterLabel } from './fieldLabels';
import { useErrorText } from './useFieldError';

export const SWATCHES = [
  '#4F46E5',
  '#7C3AED',
  '#06B6D4',
  '#0EA5E9',
  '#10B981',
  '#22C55E',
  '#F59E0B',
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#64748B',
  '#0F172A',
];

/** Swatch picker; the value is `#RRGGBB` (16 §5.3 colour rule). */
export function RHFColor({ name, label }: { name: string; label: string }) {
  const { control } = useFormContext();
  const errorText = useErrorText();
  useRegisterLabel(name, label);
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Box data-field={name}>
          <FormLabel sx={{ fontSize: 13, mb: 2, display: 'block' }}>{label}</FormLabel>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ flexWrap: 'wrap', rowGap: 1.5 }}
            role="radiogroup"
            aria-label={label}
          >
            {SWATCHES.map((c) => {
              const selected = String(field.value).toUpperCase() === c;
              return (
                <Tooltip key={c} title={c}>
                  <ButtonBase
                    role="radio"
                    aria-checked={selected}
                    aria-label={c}
                    onClick={() => field.onChange(c)}
                    onBlur={field.onBlur}
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: '10px',
                      bgcolor: c,
                      color: '#fff',
                      outline: selected ? '2px solid' : 'none',
                      outlineColor: 'text.primary',
                      outlineOffset: 2,
                    }}
                  >
                    {selected && <Check size={16} />}
                  </ButtonBase>
                </Tooltip>
              );
            })}
          </Stack>
          {fieldState.error && (
            <FormHelperText error>{errorText(fieldState.error, label)}</FormHelperText>
          )}
        </Box>
      )}
    />
  );
}
