import { Box, IconButton, InputAdornment, LinearProgress, Stack, TextField, Typography } from '@mui/material';
import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useRegisterLabel } from './fieldLabels';
import { useErrorText } from './useFieldError';

type Props = { name: string; label: string; required?: boolean; showRules?: boolean; autoComplete?: string };

export function passwordRules(v: string) {
  return { length: v.length >= 10, letter: /\p{L}/u.test(v), digit: /\d/.test(v) };
}

function strength(v: string): number {
  if (!v) return 0;
  let s = 0;
  if (v.length >= 10) s += 1;
  if (v.length >= 14) s += 1;
  if (/\p{L}/u.test(v) && /\d/.test(v)) s += 1;
  if (/[^\p{L}\d]/u.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v))) s += 1;
  return s;
}

/** Password with show/hide, a strength meter and a rule checklist that ticks live (16 §5.3). */
export function RHFPasswordField({ name, label, required, showRules, autoComplete = 'current-password' }: Props) {
  const { control } = useFormContext();
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [visible, setVisible] = useState(false);
  useRegisterLabel(name, label);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const value = (field.value ?? '') as string;
        const rules = passwordRules(value);
        const s = strength(value);
        const levels = ['weak', 'weak', 'fair', 'good', 'strong'] as const;
        return (
          <Box>
            <TextField
              id={`field-${name}`}
              name={field.name}
              inputRef={field.ref}
              type={visible ? 'text' : 'password'}
              label={required ? `${label} *` : label}
              value={value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              autoComplete={autoComplete}
              error={Boolean(fieldState.error)}
              helperText={errorText(fieldState.error, label)}
              inputProps={{ dir: 'ltr' }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={visible ? t('password.hide') : t('password.show')}
                      onClick={() => setVisible((v) => !v)}
                      edge="end"
                      size="small"
                    >
                      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            {showRules && (
              <Box sx={{ mt: 2 }} aria-live="polite">
                <LinearProgress
                  variant="determinate"
                  value={(s / 4) * 100}
                  color={s >= 3 ? 'success' : s === 2 ? 'warning' : 'error'}
                  sx={{ height: 6, borderRadius: 3 }}
                  aria-label={t('password.strength', { level: t(`password.${levels[s]}`) })}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('password.strength', { level: t(`password.${levels[s]}`) })}
                </Typography>
                <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }} spacing={0.5}>
                  {(
                    [
                      ['length', 'ruleLength'],
                      ['letter', 'ruleLetter'],
                      ['digit', 'ruleDigit'],
                    ] as const
                  ).map(([k, key]) => (
                    <Stack component="li" key={k} direction="row" spacing={1} alignItems="center" sx={{ color: rules[k] ? 'success.main' : 'text.secondary' }}>
                      {rules[k] ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
                      <Typography variant="caption">{t(`password.${key}`)}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        );
      }}
    />
  );
}
