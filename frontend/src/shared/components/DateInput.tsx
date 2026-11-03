import { TextField } from '@mui/material';

/** Compact date filter for toolbars (YYYY-MM-DD, clinic-local). Clearing it sends ''. */
export function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <TextField
      type="date"
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      InputLabelProps={{ shrink: true }}
      inputProps={{ dir: 'ltr' }}
    />
  );
}
