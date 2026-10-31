import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Form } from '@/shared/form/Form';
import { RHFOtp } from '@/shared/form/RHFInputs';
import { RHFPasswordField } from '@/shared/form/RHFPasswordField';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { PageSkeleton } from '@/shared/components/States';
import { authApi, storeToken } from '../api/authApi';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotSchema,
  resetSchema,
} from '../schemas';
import { landingPathFor } from './LoginPage';

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const form = useAppForm<{ target: string }>({
    schema: forgotSchema,
    defaultValues: { target: '' },
  });
  const onSubmit = async ({ target }: { target: string }) => {
    await authApi.forgot(target);
    navigate(`/reset-password?target=${encodeURIComponent(target)}`);
  };
  return (
    <Box>
      <Typography variant="h2" component="h1">
        {t('forgot.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 6 }}>
        {t('forgot.subtitle')}
      </Typography>
      <Form form={form} name="auth.forgot" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <RHFTextField
            name="target"
            label={t('forgot.target')}
            autoFocus
            required
            inputProps={{ dir: 'ltr' }}
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={form.formState.isSubmitting}
          >
            {t('forgot.submit')}
          </Button>
          <Link component={RouterLink} to="/login" textAlign="center">
            {t('forgot.back')}
          </Link>
        </Stack>
      </Form>
    </Box>
  );
}

type ResetForm = { code: string; newPassword: string; confirmPassword: string };

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  const [params] = useSearchParams();
  const target = params.get('target') ?? '';
  const navigate = useNavigate();
  const notify = useNotify();
  const [cooldown, setCooldown] = useState(60);
  const form = useAppForm<ResetForm>({
    schema: resetSchema,
    defaultValues: { code: '', newPassword: '', confirmPassword: '' },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const onSubmit = async (v: ResetForm) => {
    await authApi.reset({ target, code: v.code, newPassword: v.newPassword });
    notify.success(t('reset.done'));
    navigate('/login', { replace: true });
  };

  return (
    <Box>
      <Typography variant="h2" component="h1">
        {t('reset.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 6 }}>
        <span>{t('reset.subtitle', { target })}</span>
      </Typography>
      <Form form={form} name="auth.reset" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <RHFOtp name="code" label={t('reset.code')} autoFocus />
          <Button
            size="small"
            disabled={cooldown > 0}
            onClick={() => {
              void authApi.forgot(target);
              setCooldown(60);
            }}
          >
            {cooldown > 0 ? t('reset.resendIn', { seconds: cooldown }) : t('reset.resend')}
          </Button>
          <RHFPasswordField
            name="newPassword"
            label={t('reset.newPassword')}
            required
            showRules
            autoComplete="new-password"
          />
          <RHFPasswordField
            name="confirmPassword"
            label={t('reset.confirmPassword')}
            required
            autoComplete="new-password"
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={form.formState.isSubmitting}
          >
            {t('reset.submit')}
          </Button>
        </Stack>
      </Form>
    </Box>
  );
}

type InviteForm = { password: string; confirmPassword: string };

export function AcceptInvitationPage() {
  const { t } = useTranslation('auth');
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => authApi.invitationInfo(token),
    retry: false,
  });
  const form = useAppForm<InviteForm>({
    schema: acceptInvitationSchema,
    defaultValues: { password: '', confirmPassword: '' },
  });

  if (info.isLoading) return <PageSkeleton rows={3} />;
  if (info.isError) return <Alert severity="error">{t('invite.invalid')}</Alert>;

  const onSubmit = async (v: InviteForm) => {
    const res = await authApi.acceptInvitation({ token, password: v.password });
    if (res.accessToken) storeToken(res.accessToken);
    navigate(landingPathFor(res), { replace: true });
  };

  return (
    <Box>
      <Typography variant="h2" component="h1">
        {t('invite.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 6 }} dir="auto">
        {info.data?.clinicName
          ? t('invite.subtitle', { clinic: info.data.clinicName })
          : t('invite.subtitleNoClinic')}
      </Typography>
      <Form form={form} name="auth.invite" onSubmit={onSubmit}>
        <Stack spacing={4}>
          {info.data?.email && <Typography dir="ltr">{info.data.email}</Typography>}
          <RHFPasswordField
            name="password"
            label={t('invite.password')}
            required
            showRules
            autoComplete="new-password"
          />
          <RHFPasswordField
            name="confirmPassword"
            label={t('invite.confirmPassword')}
            required
            autoComplete="new-password"
          />
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={form.formState.isSubmitting}
          >
            {t('invite.submit')}
          </Button>
        </Stack>
      </Form>
    </Box>
  );
}

type ChangeForm = { currentPassword: string; newPassword: string; confirmPassword: string };

export function ChangePasswordForm({
  mustChange,
  onDone,
}: {
  mustChange?: boolean;
  onDone?: () => void;
}) {
  const { t } = useTranslation('auth');
  const notify = useNotify();
  const form = useAppForm<ChangeForm>({
    schema: changePasswordSchema,
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const onSubmit = async (v: ChangeForm) => {
    const res = await authApi.change({
      currentPassword: v.currentPassword,
      newPassword: v.newPassword,
    });
    if (res?.accessToken) storeToken(res.accessToken);
    notify.success(t('change.done'));
    form.reset();
    onDone?.();
  };
  return (
    <Form form={form} name="auth.changePassword" onSubmit={onSubmit}>
      <Stack spacing={4}>
        {mustChange && <Alert severity="info">{t('change.mustChange')}</Alert>}
        <RHFPasswordField name="currentPassword" label={t('change.current')} required />
        <RHFPasswordField
          name="newPassword"
          label={t('change.new')}
          required
          showRules
          autoComplete="new-password"
        />
        <RHFPasswordField
          name="confirmPassword"
          label={t('change.confirm')}
          required
          autoComplete="new-password"
        />
        <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
          {t('change.submit')}
        </Button>
      </Stack>
    </Form>
  );
}

export function ChangePasswordPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  return (
    <Box>
      <Typography variant="h2" component="h1" sx={{ mb: 6 }}>
        {t('change.title')}
      </Typography>
      <ChangePasswordForm mustChange onDone={() => navigate('/app', { replace: true })} />
    </Box>
  );
}
