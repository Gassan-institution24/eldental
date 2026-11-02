import { Button, Card, Grid, Stack, TextField, Typography } from '@mui/material';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ChangePasswordForm } from '@/features/auth/pages/PasswordPages';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { email, enumOf, optional, personName } from '@/shared/generated/validation/fields';
import { Form } from '@/shared/form/Form';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePortalMe, useUpdateMe, type PortalMe } from '../api';
import { PortalHeader } from '../components';
import { patientCta } from './PatientAuthPages';

const schema = z.object({
  displayName: personName({ max: 120 }),
  email: optional(email()),
  locale: enumOf(['ar', 'en']),
});
type Values = z.input<typeof schema>;

function DetailsForm({ me }: { me: PortalMe }) {
  const { t, i18n } = useTranslation('patient');
  const notify = useNotify();
  const update = useUpdateMe();
  const form = useAppForm<Values>({
    schema,
    defaultValues: {
      displayName: me.user.displayName,
      email: me.user.email ?? '',
      locale: me.user.locale,
    },
  });
  useEffect(() => {
    form.reset({
      displayName: me.user.displayName,
      email: me.user.email ?? '',
      locale: me.user.locale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.user.id]);

  const onSubmit = async (v: Values) => {
    const out = schema.parse(v);
    const next = await update.mutateAsync({
      displayName: out.displayName,
      email: out.email ?? '',
      locale: out.locale,
    });
    form.reset({
      displayName: next.user.displayName,
      email: next.user.email ?? '',
      locale: next.user.locale,
    });
    if (next.user.locale !== i18n.resolvedLanguage) void i18n.changeLanguage(next.user.locale);
    notify.success(t('portal.profile.saved'));
  };

  return (
    <Card sx={{ p: { xs: 4, md: 6 }, height: '100%' }}>
      <Typography variant="h5" component="h2" sx={{ mb: 4 }}>
        {t('portal.profile.details')}
      </Typography>
      <Form form={form} name="portal.profile" onSubmit={onSubmit} guardUnsaved>
        <Stack spacing={4}>
          <RHFTextField
            name="displayName"
            label={t('portal.profile.name')}
            required
            maxLength={120}
          />
          <TextField
            label={t('portal.profile.phone')}
            value={me.user.phone ?? ''}
            helperText={t('portal.profile.phoneHint')}
            disabled
            inputProps={{ dir: 'ltr' }}
          />
          <RHFTextField
            name="email"
            label={t('portal.profile.email')}
            type="email"
            autoComplete="email"
            inputProps={{ dir: 'ltr', inputMode: 'email' }}
          />
          <RHFSelect
            name="locale"
            label={t('portal.profile.language')}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
          <Button
            type="submit"
            variant="contained"
            sx={{ ...patientCta, alignSelf: { sm: 'flex-start' } }}
            disabled={form.formState.isSubmitting || !form.formState.isDirty}
          >
            {t('portal.profile.save')}
          </Button>
        </Stack>
      </Form>
    </Card>
  );
}

/** Account details and password (01 §4.10). */
export function ProfilePage() {
  const { t } = useTranslation('patient');
  const me = usePortalMe();
  if (me.isLoading) return <PageSkeleton />;
  if (me.isError || !me.data)
    return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  return (
    <>
      <PortalHeader title={t('portal.profile.title')} subtitle={t('portal.profile.subtitle')} />
      <Grid container spacing={4}>
        <Grid item xs={12} lg={6}>
          <DetailsForm me={me.data} />
        </Grid>
        <Grid item xs={12} lg={6}>
          <Card sx={{ p: { xs: 4, md: 6 }, height: '100%' }}>
            <Typography variant="h5" component="h2" sx={{ mb: 4 }}>
              {t('portal.profile.password')}
            </Typography>
            <ChangePasswordForm />
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
