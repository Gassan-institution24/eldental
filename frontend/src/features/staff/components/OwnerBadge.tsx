import { Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * The clinic owner marker (04 §9): a protected identity, so it looks different from every role
 * chip (Manager, Accountant, Doctor…), with its own icon and colour.
 */
export function OwnerBadge() {
  const { t } = useTranslation('staff');
  const theme = useTheme();
  return (
    // Headers may inherit the direction of an Arabic name; the chip follows the UI direction instead.
    <Chip
      dir={theme.direction}
      size="small"
      color="warning"
      icon={<Crown size={12} />}
      label={t('owner')}
      data-testid="owner-badge"
    />
  );
}
