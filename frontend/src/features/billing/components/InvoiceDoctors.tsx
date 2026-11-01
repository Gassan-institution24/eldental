import { Chip, Stack, Tooltip, Typography } from '@mui/material';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/shared/rbac/usePermission';
import type { Invoice } from '../api';

/** True when the user only sees invoices that include their own work (own scope, 04 §3). */
export function useOwnInvoiceScope(): boolean {
  const { grant, session } = usePermission();
  if (session?.isOwner || session?.user.isRootSuperadmin) return false;
  return grant('billing.invoice.read')?.scope === 'own';
}

/** Responsible doctor of an invoice, with a marker when several doctors worked on it. */
export function InvoiceDoctorCell({
  invoice,
}: {
  invoice: Pick<Invoice, 'dentist' | 'doctors' | 'multipleDoctors'>;
}) {
  const { t } = useTranslation('billing');
  const name =
    invoice.dentist?.name ?? (invoice.doctors?.length === 1 ? invoice.doctors[0]?.name : undefined);
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      <Typography
        variant="body2"
        noWrap
        dir="auto"
        color={name ? 'text.primary' : 'text.secondary'}
      >
        {name || t('invoices.noDoctor')}
      </Typography>
      {invoice.multipleDoctors && (
        <Tooltip title={(invoice.doctors ?? []).map((d) => d.name).join(' · ')}>
          <Chip
            size="small"
            variant="outlined"
            color="info"
            icon={<Users size={12} />}
            label={t('invoices.multipleDoctors')}
            data-testid="multiple-doctors"
          />
        </Tooltip>
      )}
    </Stack>
  );
}
