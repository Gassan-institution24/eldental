import {
  Box,
  Button,
  ButtonBase,
  FormControlLabel,
  Popover,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ChevronDown } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useRegisterLabel } from '@/shared/form/fieldLabels';
import { useErrorText } from '@/shared/form/useFieldError';
import {
  isValidSurface,
  isValidTooth,
  SURFACES,
  type Surface,
} from '@/shared/generated/validation/fields';
import { LOWER_PERMANENT, LOWER_PRIMARY, UPPER_PERMANENT, UPPER_PRIMARY } from './odontogram/teeth';
import { toothList } from './shared';

/**
 * Teeth and surfaces are picked, never typed: a small mouth map (FDI, the patient's right on the
 * viewer's left, like the chart) and only the surfaces that exist on the chosen teeth.
 * Both keep the form value as text ("11, 21" / "MO") so the form schemas stay the same.
 */

const teethOf = (v: unknown): number[] => toothList(String(v ?? '')).filter(isValidTooth);
const surfacesOf = (v: unknown): Surface[] =>
  String(v ?? '')
    .toUpperCase()
    .split('')
    .filter((s): s is Surface => (SURFACES as readonly string[]).includes(s));

/** Surfaces valid on every chosen tooth (a front tooth has no O, a back tooth no I/F). */
export function surfacesFor(teeth: number[]): Surface[] {
  const order: Surface[] = ['M', 'D', 'O', 'I', 'B', 'F', 'L', 'P'];
  return teeth.length ? order.filter((s) => teeth.every((t) => isValidSurface(t, s))) : order;
}

function PickerField({
  id,
  label,
  required,
  value,
  placeholder,
  error,
  helperText,
  disabled,
  onOpen,
}: {
  id: string;
  label: string;
  required?: boolean;
  value: string;
  placeholder: string;
  error?: string;
  helperText?: string;
  disabled?: boolean;
  onOpen: (e: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <TextField
      id={id}
      label={required ? `${label} *` : label}
      size="small"
      fullWidth
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      error={Boolean(error)}
      helperText={error ?? helperText}
      onClick={(e) => !disabled && onOpen(e)}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
          e.preventDefault();
          onOpen(e as unknown as MouseEvent<HTMLElement>);
        }
      }}
      InputLabelProps={{ shrink: Boolean(value) || undefined }}
      InputProps={{
        readOnly: true,
        endAdornment: <ChevronDown size={16} aria-hidden />,
        sx: { cursor: disabled ? 'default' : 'pointer', '& input': { cursor: 'inherit' } },
      }}
      inputProps={{ dir: 'ltr', 'aria-haspopup': 'dialog', 'aria-required': required }}
    />
  );
}

function ToothButton({ n, on, toggle }: { n: number; on: boolean; toggle: (n: number) => void }) {
  return (
    <ButtonBase
      onClick={() => toggle(n)}
      aria-pressed={on}
      aria-label={String(n)}
      sx={(th) => ({
        width: 30,
        height: 30,
        borderRadius: 1,
        fontSize: 12,
        fontWeight: 700,
        border: 1,
        borderColor: on ? 'primary.main' : 'divider',
        bgcolor: on ? 'primary.main' : 'background.paper',
        color: on ? 'primary.contrastText' : 'text.primary',
        '&:hover': { bgcolor: on ? 'primary.dark' : alpha(th.palette.primary.main, 0.08) },
        '&.Mui-focusVisible': { outline: `2px solid ${th.palette.primary.main}`, outlineOffset: 1 },
      })}
    >
      {n}
    </ButtonBase>
  );
}

function Arch({ teeth, sel, toggle }: { teeth: number[]; sel: number[]; toggle: (n: number) => void }) {
  const half = teeth.length / 2;
  return (
    <Stack direction="row" spacing={0.5} justifyContent="center">
      {teeth.map((n, i) => (
        <Box
          key={n}
          // The midline (the map is always drawn left-to-right, like the chart).
          sx={i === half ? { borderLeft: 2, borderColor: 'divider', pl: 0.5 } : undefined}
        >
          <ToothButton n={n} on={sel.includes(n)} toggle={toggle} />
        </Box>
      ))}
    </Stack>
  );
}

/** Multi-select teeth from a mouth map. */
export function RHFTeethPicker({
  name,
  label,
  required,
  single,
  disabled,
}: {
  name: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  /** One tooth only (the click replaces the selection). */
  single?: boolean;
}) {
  const { t } = useTranslation('clinical');
  const { control } = useFormContext();
  const errorText = useErrorText();
  useRegisterLabel(name, label);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [showPrimary, setShowPrimary] = useState(false);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const sel = teethOf(field.value);
        const primaryChosen = sel.some((n) => n >= 51);
        const set = (next: number[]) => field.onChange(next.join(', '));
        const toggle = (n: number) => {
          if (single) set(sel.includes(n) ? [] : [n]);
          else set(sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]);
        };
        const baby = showPrimary || primaryChosen;
        return (
          <>
            <PickerField
              id={`field-${name.replace(/\./g, '-')}`}
              label={label}
              required={required}
              value={sel.join(', ')}
              placeholder={t('picker.chooseTeeth')}
              error={errorText(fieldState.error, label)}
              disabled={disabled}
              onOpen={(e) => setAnchor(e.currentTarget)}
            />
            <Popover
              open={Boolean(anchor)}
              anchorEl={anchor}
              onClose={() => {
                setAnchor(null);
                field.onBlur();
              }}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              slotProps={{ paper: { sx: { p: 3, maxWidth: 'calc(100vw - 32px)' } } }}
            >
              <Stack spacing={2}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                  <Typography variant="subtitle2">{label}</Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={baby}
                        disabled={primaryChosen}
                        onChange={(e) => setShowPrimary(e.target.checked)}
                      />
                    }
                    label={<Typography variant="caption">{t('picker.babyTeeth')}</Typography>}
                  />
                </Stack>
                <Box dir="ltr" sx={{ overflowX: 'auto' }}>
                  <Stack spacing={1}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="caption" color="text.secondary">
                        {t('picker.patientRight')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('picker.upper')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('picker.patientLeft')}
                      </Typography>
                    </Stack>
                    <Arch teeth={UPPER_PERMANENT} sel={sel} toggle={toggle} />
                    {baby && <Arch teeth={UPPER_PRIMARY} sel={sel} toggle={toggle} />}
                    <Box sx={{ borderTop: 1, borderColor: 'divider', my: 0.5 }} />
                    {baby && <Arch teeth={LOWER_PRIMARY} sel={sel} toggle={toggle} />}
                    <Arch teeth={LOWER_PERMANENT} sel={sel} toggle={toggle} />
                    <Typography variant="caption" color="text.secondary" textAlign="center">
                      {t('picker.lower')}
                    </Typography>
                  </Stack>
                </Box>
                <Stack direction="row" justifyContent="space-between">
                  <Button size="small" disabled={!sel.length} onClick={() => set([])}>
                    {t('picker.clear')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => {
                      setAnchor(null);
                      field.onBlur();
                    }}
                  >
                    {t('picker.done')}
                  </Button>
                </Stack>
              </Stack>
            </Popover>
          </>
        );
      }}
    />
  );
}

/**
 * Surfaces for the teeth in `teethName`: only the ones that exist on those teeth are offered,
 * and a surface that stops fitting when the teeth change is dropped.
 */
export function RHFSurfacesPicker({
  name,
  teethName,
  label,
  required,
}: {
  name: string;
  teethName: string;
  label: string;
  required?: boolean;
}) {
  const { t } = useTranslation('clinical');
  const { control, getValues, setValue } = useFormContext();
  const errorText = useErrorText();
  useRegisterLabel(name, label);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const teeth = teethOf(useWatch({ control, name: teethName }));
  const allowed = surfacesFor(teeth);
  const allowedKey = allowed.join('');

  useEffect(() => {
    const cur = surfacesOf(getValues(name));
    const kept = cur.filter((s) => allowedKey.includes(s));
    if (kept.length !== cur.length) setValue(name, kept.join(''), { shouldDirty: true });
  }, [allowedKey, name, getValues, setValue]);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const sel = surfacesOf(field.value);
        const toggle = (s: Surface) =>
          field.onChange(
            (sel.includes(s) ? sel.filter((x) => x !== s) : [...sel, s])
              .sort((a, b) => allowed.indexOf(a) - allowed.indexOf(b))
              .join(''),
          );
        return (
          <>
            <PickerField
              id={`field-${name.replace(/\./g, '-')}`}
              label={label}
              required={required}
              value={sel.join('')}
              placeholder={t('picker.chooseSurfaces')}
              error={errorText(fieldState.error, label)}
              disabled={!teeth.length}
              helperText={!teeth.length ? t('picker.teethFirst') : undefined}
              onOpen={(e) => setAnchor(e.currentTarget)}
            />
            <Popover
              open={Boolean(anchor)}
              anchorEl={anchor}
              onClose={() => {
                setAnchor(null);
                field.onBlur();
              }}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              slotProps={{ paper: { sx: { p: 3, width: 280, maxWidth: 'calc(100vw - 32px)' } } }}
            >
              <Typography variant="subtitle2" sx={{ mb: 2 }}>
                {label} · <span dir="ltr">{teeth.join(', ')}</span>
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                {allowed.map((s) => (
                  <ToggleButton
                    key={s}
                    value={s}
                    size="small"
                    selected={sel.includes(s)}
                    onChange={() => toggle(s)}
                    color="primary"
                    sx={{ justifyContent: 'flex-start', gap: 1.5, textTransform: 'none' }}
                  >
                    <Box component="b" dir="ltr" sx={{ minWidth: 14 }}>
                      {s}
                    </Box>
                    {t(`surfaces.${s}`)}
                  </ToggleButton>
                ))}
              </Box>
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 2 }}>
                <Button size="small" disabled={!sel.length} onClick={() => field.onChange('')}>
                  {t('picker.clear')}
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => {
                    setAnchor(null);
                    field.onBlur();
                  }}
                >
                  {t('picker.done')}
                </Button>
              </Stack>
            </Popover>
          </>
        );
      }}
    />
  );
}
