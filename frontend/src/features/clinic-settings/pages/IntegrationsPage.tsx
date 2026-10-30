import { Alert, Button, Chip, Grid, Stack, Typography } from '@mui/material';
import { MessageCircle, ReceiptText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { optional } from '@/shared/generated/validation/fields';
import { SectionCard } from '@/shared/components/SectionCard';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useClinic, useSaveJofotara, type Clinic } from '../api';

const schema = z.object({
  enabled: z.boolean(),
  clientId: optional(z.string().trim().max(120, { message: 'too_long' })),
  secretKey: optional(
    z.string().trim().min(8, { message: 'too_short' }).max(500, { message: 'too_long' }),
  ),
  activityNumber: optional(z.string().trim().max(40, { message: 'too_long' })),
  incomeSourceSequence: optional(z.string().trim().max(40, { message: 'too_long' })),
});
type Values = z.input<typeof schema>;

function JofotaraForm({ clinic }: { clinic: Clinic }) {
  const { t } = useTranslation('settings');
  const notify = useNotify();
  const save = useSaveJofotara();
  const j = clinic.integrations.jofotara;
  const form = useAppForm<Values>({
    schema,
    defaultValues: {
      enabled: j.enabled,
      clientId: j.clientId,
      secretKey: '',
      activityNumber: j.activityNumber,
      incomeSourceSequence: j.incomeSourceSequence,
    },
  });
  const onSubmit = async (v: Values) => {
    await save.mutateAsync(v);
    form.reset({ ...v, secretKey: '' });
    notify.success(t('integrations.saved'));
  };
  return (
    <Form form={form} name="settings.jofotara" onSubmit={onSubmit} guardUnsaved>
      <SectionCard
        title={
          <Stack direction="row" spacing={2} alignItems="center">
            <ReceiptText size={20} />
            <span>{t('integrations.jofotara')}</span>
            {j.enabled && <Chip size="small" color="success" label={t('common.active')} />}
          </Stack>
        }
        subtitle={t('integrations.jofotaraHint')}
        footer={
          <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
            {t('common:actions.saveChanges')}
          </Button>
        }
      >
        <Grid container spacing={4}>
          <Grid item xs={12}>
            <RHFCheckbox name="enabled" label={t('integrations.enabled')} asSwitch />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="clientId"
              label={t('integrations.clientId')}
              inputProps={{ dir: 'ltr', autoComplete: 'off' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="secretKey"
              label={t('integrations.secretKey')}
              type="password"
              helperText={
                j.hasSecret ? t('integrations.secretSet') : t('integrations.secretHelper')
              }
              inputProps={{ dir: 'ltr', autoComplete: 'new-password' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="activityNumber"
              label={t('integrations.activityNumber')}
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="incomeSourceSequence"
              label={t('integrations.incomeSource')}
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
        </Grid>
      </SectionCard>
    </Form>
  );
}

export function IntegrationsPage() {
  const { t } = useTranslation('settings');
  const q = useClinic();
  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <>
      <JofotaraForm clinic={q.data} />
      <SectionCard
        title={
          <Stack direction="row" spacing={2} alignItems="center">
            <MessageCircle size={20} />
            <span>{t('integrations.whatsapp')}</span>
            <Chip
              size="small"
              label={
                q.data.integrations.whatsapp.enabled ? t('common.active') : t('common.inactive')
              }
              color={q.data.integrations.whatsapp.enabled ? 'success' : 'default'}
            />
          </Stack>
        }
      >
        <Alert severity="info">
          <Typography variant="body2">{t('integrations.whatsappHint')}</Typography>
        </Alert>
      </SectionCard>
    </>
  );
}
