import { Box, FormHelperText } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toWesternDigits } from '@/shared/generated/validation/normalize';

type Props = {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  error?: boolean;
  helperText?: string;
  autoFocus?: boolean;
  name?: string;
};

const LENGTH = 6;

/** 6 boxes, auto-advance, paste support, numeric keyboard, Arabic digits accepted (16 §5.3). */
export function OtpInput({ value, onChange, onComplete, error, helperText, autoFocus, name }: Props) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '');

  const setAt = (i: number, digit: string) => {
    const next = chars.slice();
    next[i] = digit;
    const joined = next.join('').slice(0, LENGTH);
    onChange(joined);
    if (joined.length === LENGTH && !joined.includes('')) onComplete?.(joined);
  };

  const onInput = (i: number, raw: string) => {
    const d = toWesternDigits(raw).replace(/\D/g, '');
    if (!d) return setAt(i, '');
    if (d.length > 1) return fill(d, i);
    setAt(i, d);
    refs.current[i + 1]?.focus();
  };

  const fill = (digits: string, from = 0) => {
    const next = chars.slice();
    for (let k = 0; k < digits.length && from + k < LENGTH; k += 1) next[from + k] = digits[k] ?? '';
    const joined = next.join('');
    onChange(joined);
    refs.current[Math.min(from + digits.length, LENGTH - 1)]?.focus();
    if (joined.length === LENGTH) onComplete?.(joined);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    fill(toWesternDigits(e.clipboardData.getData('text')).replace(/\D/g, '').slice(0, LENGTH));
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !chars[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
  };

  return (
    <Box>
      <Box role="group" aria-label={t('otp.label')} sx={{ display: 'flex', gap: 2, justifyContent: 'center' }} dir="ltr" data-field={name}>
        {chars.map((c, i) => (
          <Box
            key={i}
            component="input"
            ref={(el: HTMLInputElement | null) => {
              refs.current[i] = el;
            }}
            value={c}
            name={i === 0 ? name : undefined}
            autoFocus={autoFocus && i === 0}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={LENGTH}
            aria-label={t('otp.digit', { n: i + 1 })}
            aria-invalid={error}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onInput(i, e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.select()}
            sx={(theme) => ({
              width: 48,
              height: 56,
              textAlign: 'center',
              fontSize: 22,
              fontWeight: 600,
              borderRadius: '10px',
              border: `1px solid ${error ? theme.palette.error.main : theme.palette.divider}`,
              bgcolor: 'background.paper',
              color: 'text.primary',
              outline: 'none',
              '&:focus': { borderColor: theme.palette.primary.main, boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}` },
            })}
          />
        ))}
      </Box>
      {helperText && (
        <FormHelperText error={error} sx={{ textAlign: 'center', mt: 1 }}>
          {helperText}
        </FormHelperText>
      )}
    </Box>
  );
}
