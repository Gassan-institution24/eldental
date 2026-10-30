import { Autocomplete, Box, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatientSearch, type PatientHit } from '../api/patients';

type Value = { id: string; fullName: string; fileNumber?: string; phone?: string } | null;
type CreateOption = { create: true; name: string };
type Option = PatientHit | CreateOption;

type Props = {
  value: Value;
  onChange: (v: Value) => void;
  label?: string;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  excludeId?: string;
  /** Show "Register <name>" when nothing matches (quick patient, 06 §9). */
  onCreate?: (name: string) => void;
  autoFocus?: boolean;
  name?: string;
};

/** Async patient typeahead (`/patients/search`) used by booking, invoices, merge… */
export function PatientPicker({
  value,
  onChange,
  label,
  required,
  error,
  helperText,
  excludeId,
  onCreate,
  autoFocus,
  name,
}: Props) {
  const { t } = useTranslation('patients');
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(input), 250);
    return () => clearTimeout(id);
  }, [input]);
  const search = usePatientSearch(debounced);
  const hits = (search.data ?? []).filter((h) => h.id !== excludeId);
  const options: Option[] = [
    ...hits,
    ...(onCreate && debounced.trim().length >= 2
      ? [{ create: true as const, name: debounced.trim() }]
      : []),
  ];

  return (
    <Autocomplete<Option, false, false, false>
      options={options}
      value={value ? ({ ...value, status: 'active' } as PatientHit) : null}
      filterOptions={(x) => x}
      getOptionLabel={(o) => ('create' in o ? o.name : o.fullName)}
      isOptionEqualToValue={(a, b) => !('create' in a) && !('create' in b) && a.id === b.id}
      onInputChange={(_e, v, reason) => reason === 'input' && setInput(v)}
      onChange={(_e, v) => {
        if (!v) return onChange(null);
        if ('create' in v) return onCreate?.(v.name);
        onChange({ id: v.id, fullName: v.fullName, fileNumber: v.fileNumber, phone: v.phone });
      }}
      loading={search.isFetching}
      noOptionsText={debounced.length < 2 ? t('picker.placeholder') : t('picker.noResults')}
      renderOption={(props, o) => {
        const { key, ...rest } = props as typeof props & { key: string };
        if ('create' in o) {
          return (
            <Box component="li" key={key} {...rest} sx={{ color: 'primary.main', gap: 2 }}>
              <UserPlus size={16} />
              {t('picker.createQuick', { name: o.name })}
            </Box>
          );
        }
        return (
          <Box component="li" key={key} {...rest}>
            <Stack sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2" fontWeight={650} dir="auto" noWrap>
                  {o.fullName}
                </Typography>
                {(o.medicalAlerts?.length ?? 0) > 0 && (
                  <Box sx={{ color: 'error.main', display: 'flex' }}>
                    <AlertTriangle size={14} />
                  </Box>
                )}
              </Stack>
              <Typography
                variant="caption"
                color="text.secondary"
                dir="ltr"
                sx={{ textAlign: 'start' }}
              >
                {[o.fileNumber, o.phone].filter(Boolean).join(' · ')}
              </Typography>
            </Stack>
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          name={name}
          autoFocus={autoFocus}
          label={`${label ?? t('fields.fullName')}${required ? ' *' : ''}`}
          placeholder={t('picker.placeholder')}
          error={error}
          helperText={helperText}
          inputProps={{ ...params.inputProps, dir: 'auto' }}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {search.isFetching ? <CircularProgress size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
