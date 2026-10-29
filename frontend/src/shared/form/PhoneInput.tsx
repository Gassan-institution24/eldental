import { Box, MenuItem, TextField, type TextFieldProps } from '@mui/material';
import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toWesternDigits } from '@/shared/generated/validation/normalize';

export const PHONE_COUNTRIES: { code: CountryCode; dial: string }[] = [
  { code: 'JO', dial: '962' },
  { code: 'SA', dial: '966' },
  { code: 'AE', dial: '971' },
  { code: 'KW', dial: '965' },
  { code: 'QA', dial: '974' },
  { code: 'BH', dial: '973' },
  { code: 'OM', dial: '968' },
  { code: 'IQ', dial: '964' },
  { code: 'PS', dial: '970' },
  { code: 'LB', dial: '961' },
  { code: 'SY', dial: '963' },
  { code: 'EG', dial: '20' },
  { code: 'TR', dial: '90' },
  { code: 'GB', dial: '44' },
  { code: 'US', dial: '1' },
];

type Props = Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string | undefined;
  onChange: (value: string) => void;
  defaultCountry?: CountryCode;
};

/**
 * Country selector + number formatted as you type; accepts Arabic-Indic digits. The form value
 * is the typed number in international form; the shared Zod rule normalises it to E.164.
 */
export function PhoneInput({ value, onChange, defaultCountry = 'JO', label, error, helperText, onBlur, id, name, inputRef, disabled, required }: Props) {
  const { t } = useTranslation();
  const initial = value ? parsePhoneNumberFromString(value, defaultCountry) : undefined;
  const [country, setCountry] = useState<CountryCode>(initial?.country ?? defaultCountry);
  const [local, setLocal] = useState(() => (initial ? initial.formatNational() : (value ?? '')));

  useEffect(() => {
    if (!value) return;
    const p = parsePhoneNumberFromString(value, country);
    if (p?.country && p.country !== country) setCountry(p.country);
    // keep what the user typed; only sync when the form is reset from outside
  }, [value, country]);

  const emit = (nextLocal: string, nextCountry: CountryCode) => {
    const digits = toWesternDigits(nextLocal).replace(/[^\d+]/g, '');
    const formatted = digits.startsWith('+') ? new AsYouType().input(digits) : new AsYouType(nextCountry).input(digits);
    setLocal(formatted);
    if (!digits) return onChange('');
    if (digits.startsWith('+') || digits.startsWith('00')) return onChange(digits);
    const dial = PHONE_COUNTRIES.find((c) => c.code === nextCountry)?.dial ?? '962';
    onChange(`+${dial}${digits.replace(/^0/, '')}`);
  };

  return (
    <Box sx={{ display: 'flex', gap: 2 }} dir="ltr">
      <TextField
        select
        label={t('phone.country')}
        value={country}
        onChange={(e) => {
          const c = e.target.value as CountryCode;
          setCountry(c);
          emit(local, c);
        }}
        disabled={disabled}
        sx={{ width: 120, flexShrink: 0 }}
        SelectProps={{ renderValue: (v) => `+${PHONE_COUNTRIES.find((c) => c.code === v)?.dial ?? ''}` }}
      >
        {PHONE_COUNTRIES.map((c) => (
          <MenuItem key={c.code} value={c.code}>
            {c.code} +{c.dial}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        id={id}
        name={name}
        inputRef={inputRef}
        label={label}
        value={local}
        onChange={(e) => emit(e.target.value, country)}
        onBlur={onBlur}
        error={error}
        helperText={helperText ?? t('phone.helper')}
        disabled={disabled}
        required={false}
        inputProps={{ inputMode: 'tel', dir: 'ltr', autoComplete: 'tel', 'aria-required': required }}
        type="tel"
      />
    </Box>
  );
}
