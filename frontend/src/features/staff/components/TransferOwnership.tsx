import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { Crown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { SectionCard } from '@/shared/components/SectionCard';
import { Form } from '@/shared/form/Form';
import { RHFPasswordField } from '@/shared/form/RHFPasswordField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useTransferOwnership, type StaffMember } from '../api';

const schema = z.object({ password: z.string().min(1, { message: 'required' }).max(200) });
type Values = z.input<typeof schema>;

/**
 * Ownership transfer (04 §9): shown to the current owner on another active member's profile.
 * The server checks the owner and the password again; this is only the entry point.
 */
export function TransferOwnershipCard({ staff }: { staff: StaffMember }) {
  const { t } = useTranslation('staff');
  const [open, setOpen] = useState(false);
  return (
    <SectionCard title={t('transfer.title')} subtitle={t('transfer.hint')}>
      <Button
        color="warning"
        variant="outlined"
        startIcon={<Crown size={16} />}
        onClick={() => setOpen(true)}
      >
        {t('transfer.action', { name: staff.name })}
      </Button>
      {open && <TransferDialog staff={staff} onClose={() => setOpen(false)} />}
    </SectionCard>
  );
}

function TransferDialog({ staff, onClose }: { staff: StaffMember; onClose: () => void }) {
  const { t } = useTranslation('staff');
  const notify = useNotify();
  const transfer = useTransferOwnership();
  const form = useAppForm<Values>({ schema, defaultValues: { password: '' } });
  const onSubmit = async (v: Values) => {
    await transfer.mutateAsync({ id: staff.id, password: v.password });
    notify.success(t('transfer.done', { name: staff.name }));
    onClose();
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('transfer.confirmTitle', { name: staff.name })}</DialogTitle>
      <Form form={form} name="staff.transferOwnership" id="transfer-owner-form" onSubmit={onSubmit}>
        <DialogContent>
          <Stack spacing={3}>
            <Alert severity="warning">{t('transfer.warning')}</Alert>
            <Typography variant="body2" color="text.secondary">
              {t('transfer.passwordHint')}
            </Typography>
            <RHFPasswordField
              name="password"
              label={t('transfer.password')}
              autoComplete="current-password"
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button
            type="submit"
            color="warning"
            variant="contained"
            disabled={form.formState.isSubmitting}
          >
            {t('transfer.submit')}
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
