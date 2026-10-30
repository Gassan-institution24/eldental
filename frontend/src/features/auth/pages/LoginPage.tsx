import { Alert, Box, Button, Chip, Link, Stack, Typography } from '@mui/material';
import { env } from '@/config/env';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { isApiError } from '@/lib/api/apiError';
import { track } from '@/lib/telemetry';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFPasswordField } from '@/shared/form/RHFPasswordField';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { login } from '../api/authApi';
import { MfaStep } from '../components/MfaStep';
import { loginSchema, type LoginForm } from '../schemas';
import type { LoginResponse } from '../types';

export function landingPathFor(res: Pick<LoginResponse, 'user' | 'clinics' | 'clinicId'>, next?: string | null): string {
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const kind = res.user?.kind;
  if (kind === 'platform') return safeNext?.startsWith('/admin') ? safeNext : '/admin';
  if (kind === 'patient') return safeNext?.startsWith('/portal') ? safeNext : '/portal';
  if (!res.clinicId && (res.clinics?.length ?? 0) > 1) return '/select-clinic';
  return safeNext?.startsWith('/clinic') ? safeNext : '/clinic/dashboard';
}

function useCountdown(seconds: number | null) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    setLeft(seconds ?? 0);
    if (!seconds) return;
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds]);
  return left;
}

/** Email/phone + password, show/hide, remember device, lockout countdown, MFA step (16 §6). */
export function LoginPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mfa, setMfa] = useState<{ token: string; setup: boolean } | null>(null);
  const [lockSeconds, setLockSeconds] = useState<number | null>(null);
  const left = useCountdown(lockSeconds);
  const form = useAppForm<LoginForm>({ schema: loginSchema, defaultValues: { identifier: '', password: '', remember: true } });

  const finish = (res: LoginResponse) => navigate(landingPathFor(res, params.get('next')), { replace: true });

  const onSubmit = async (values: LoginForm) => {
    track('auth.login.submit');
    try {
      const res = await login(values);
      if (res.mfaRequired || res.mfaSetupRequired) {
        setMfa({ token: res.mfaToken ?? '', setup: Boolean(res.mfaSetupRequired) });
        return;
      }
      finish(res);
    } catch (err) {
      if (isApiError(err) && err.code === 'ACCOUNT_LOCKED') {
        setLockSeconds(Number(err.details?.retryAfterSeconds ?? 60));
      }
      form.resetField('password');
      throw err;
    }
  };

  if (mfa) return <MfaStep mfaToken={mfa.token} setup={mfa.setup} onDone={finish} onBack={() => setMfa(null)} />;

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <Box>
      <Typography variant="h2" component="h1">
        {t('login.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 6 }}>
        {t('login.subtitle')}
      </Typography>
      {left > 0 && (
        <Alert severity="warning" sx={{ mb: 4 }} role="status">
          {t('login.lockedCountdown', { time: `${mm}:${ss}` })}
        </Alert>
      )}
      <Form form={form} name="auth.login" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <RHFTextField name="identifier" label={t('login.identifier')} helperText={t('login.identifierHelper')} autoComplete="username" autoFocus required inputProps={{ dir: 'ltr', inputMode: 'email' }} />
          <RHFPasswordField name="password" label={t('login.password')} required />
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <RHFCheckbox name="remember" label={t('login.remember')} />
            <Link component={RouterLink} to="/forgot-password" variant="body2">
              {t('login.forgot')}
            </Link>
          </Stack>
          <Button type="submit" variant="contained" size="large" disabled={form.formState.isSubmitting || left > 0}>
            {form.formState.isSubmitting ? t('common:states.loading') : t('login.submit')}
          </Button>
        </Stack>
      </Form>
      {env.isDev && (
        <Box sx={{ mt: 6, p: 4, borderRadius: 3, border: 1, borderStyle: 'dashed', borderColor: 'divider' }}>
          <Typography variant="body2" fontWeight={700}>
            {t('demo.title')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('demo.hint')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
            {(['owner', 'dentist', 'reception', 'accountant', 'hr'] as const).map((k) => (
              <Chip
                key={k}
                label={t(`demo.${k}`)}
                size="small"
                onClick={() => {
                  form.setValue('identifier', `${k}@smile.local`);
                  form.setValue('password', 'Password123!');
                }}
              />
            ))}
          </Stack>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 6, textAlign: 'center' }}>
        <Link component={RouterLink} to="/portal/login">
          {t('login.patientPortal')}
        </Link>
      </Typography>
    </Box>
  );
}
