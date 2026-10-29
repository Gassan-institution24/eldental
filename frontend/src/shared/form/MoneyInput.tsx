import { InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decimalsOf, parseDecimal, toDecimalString } from '@/shared/generated/money';
import { toWesternDigits } from '@/shared/generated/validation/normalize';

type Props = Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: number | null | undefined;
  onChange: (minor: number | string | undefined) => void;
  currency: string;
};

function groupThousands(s: string): string {
  const [whole = '', frac] = s.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/**
 * Edits a decimal string and emits integer minor units (10_FRONTEND.md §7). Invalid text is
 * passed through so the shared Zod rule reports `invalid_amount` / `too_many_decimals`.
 */
export function MoneyInput({ value, onChange, currency, onBlur, inputProps, ...rest }: Props) {
  const { t } = useTranslation();
  const decimals = decimalsOf(currency);
  const [text, setText] = useState(() => (typeof value === 'number' && Number.isInteger(value) ? groupThousands(toDecimalString(value, currency)) : ''));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    if (typeof value === 'number' && Number.isInteger(value)) setText(groupThousands(toDecimalString(value, currency)));
    else if (value === undefined || value === null) setText('');
  }, [value, currency, focused]);

  const emit = (raw: string) => {
    const clean = toWesternDigits(raw).replace(/[^\d.,-]/g, '');
    setText(clean);
    const plain = clean.replace(/,/g, '');
    if (plain === '') return onChange(undefined);
    const minor = parseDecimal(plain, currency);
    if (minor !== null) return onChange(minor);
    if (/^-?\d+\.\d+$/.test(plain)) return onChange(Number(plain) * 10 ** decimals); // non-integer → too_many_decimals
    onChange(plain); // not a number → invalid_amount
  };

  return (
    <TextField
      {...rest}
      value={text}
      onChange={(e) => emit(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        setFocused(false);
        const minor = parseDecimal(text.replace(/,/g, ''), currency);
        if (minor !== null) setText(groupThousands(toDecimalString(minor, currency)));
        onBlur?.(e);
      }}
      inputProps={{ inputMode: 'decimal', dir: 'ltr', ...inputProps }}
      InputProps={{ endAdornment: <InputAdornment position="end">{currency}</InputAdornment>, ...rest.InputProps }}
      helperText={rest.helperText ?? t('money.helper', { decimals })}
    />
  );
}
