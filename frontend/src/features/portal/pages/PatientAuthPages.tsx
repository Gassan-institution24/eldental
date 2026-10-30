import {
  Alert,
  Box,
  Button,
  Link,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { login, storeToken } from '@/features/auth/api/authApi';
import { identifier } from '@/features/auth/schemas';
import { landingPathFor } from '@/features/auth/pages/LoginPage';
import { api } from '@/lib/api/axios';
import { rotateSessionId } from '@/lib/session';
import { track, trackActivity } from '@/lib/telemetry';
import {
  email,
  optional,
  otpCode,
  password,
  personName,
  phone,
} from '@/shared/generated/validation/fields';
import { Form } from '@/shared/form/Form';
import { RHFOtp, RHFPhone } from '@/shared/form/RHFInputs';
import { RHFPasswordField } from '@/shared/form/RHFPasswordField';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { patientGradient } from '@/theme/tokens';
import type { LoginResponse } from '@/features/auth/types';

/** Wraps a value in U+2066…U+2069 so numbers read left-to-right inside Arabic text. */
const ltrIsolate = (v: string) => String.fromCharCode(0x2066) + v + String.fromCharCode(0x2069);

/** Patient CTA: same button, calmer gradient. */
export const patientCta = {
  backgroundImage: patientGradient,
  '&:hover': { backgroundImage: patientGradient, filter: 'brightness(1.05)' },
  boxShadow: '0 10px 24px -12px rgba(8,145,178,.8)',
} as const;

const loginSchema = z.object({
  identifier: identifier(),
  password: z.string().min(1, { message: 'required' }),
});
type LoginValues = z.infer<typeof loginSchema>;

export function PatientLoginPage() {
  const { t } = useTranslation('patient');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useAppForm<LoginValues>({
    schema: loginSchema,
    defaultValues: { identifier: '', password: '' },
  });

  const onSubmit = async (v: LoginValues) => {
    track('portal.login.submit');
    const res = await login({ identifier: v.identifier, password: v.password, remember: true });
    navigate(landingPathFor(res, params.get('next')), { replace: true });
  };

  return (
    <Box>
      <Typography variant="h3" component="h1">
        {t('auth.loginTitle')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 6 }}>
        {t('auth.loginSubtitle')}
      </Typography>
      <Form form={form} name="portal.login" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <RHFTextField
            name="identifier"
            label={t('auth.identifier')}
            helperText={t('auth.identifierHelper')}
            required
            autoFocus
            autoComplete="username"
            inputProps={{ dir: 'ltr', inputMode: 'tel' }}
          />
          <RHFPasswordField name="password" label={t('auth.password')} required />
          <Link
            component={RouterLink}
            to="/forgot-password"
            variant="body2"
            sx={{ alignSelf: 'flex-end' }}
          >
            {t('auth.forgot')}
          </Link>
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={form.formState.isSubmitting}
            sx={patientCta}
          >
            {form.formState.isSubmitting ? t('common:states.loading') : t('auth.submit')}
          </Button>
        </Stack>
      </Form>
      <Typography textAlign="center" sx={{ mt: 6 }}>
        {t('auth.noAccount')}{' '}
        <Link component={RouterLink} to="/portal/register" fontWeight={700}>
          {t('auth.createAccount')}
        </Link>
      </Typography>
      <Typography variant="body2" textAlign="center" sx={{ mt: 3 }}>
        <Link component={RouterLink} to="/login" color="text.secondary">
          {t('auth.staff')}
        </Link>
      </Typography>
    </Box>
  );
}

const detailsSchema = z.object({
  firstName: personName(),
  lastName: personName(),
  phone: phone({ mobile: true }),
  email: optional(email()),
});
type Details = z.infer<typeof detailsSchema>;

const verifySchema = z
  .object({
    code: otpCode(),
    password: password(),
    confirmPassword: z.string().min(1, { message: 'required' }),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'password_mismatch',
  });
type Verify = z.infer<typeof verifySchema>;

export function PatientRegisterPage() {
  const { t, i18n } = useTranslation('patient');
  const navigate = useNavigate();
  const [details, setDetails] = useState<Details | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const detailsForm = useAppForm<Details>({
    schema: detailsSchema,
    defaultValues: { firstName: '', lastName: '', phone: '', email: '' },
  });
  const verifyForm = useAppForm<Verify>({
    schema: verifySchema,
    defaultValues: { code: '', password: '', confirmPassword: '' },
  });
  const locale = i18n.resolvedLanguage === 'en' ? 'en' : 'ar';

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendCode = async (d: Details) => {
    const res = await api.post<{ data: { devCode?: string } }>('/auth/patient/register/start', {
      ...d,
      locale,
    });
    setDevCode(res.data.data.devCode ?? null);
    setDetails(d);
    setCooldown(60);
    track('portal.register.start');
  };

  const create = async (v: Verify) => {
    if (!details) return;
    const res = await api.post<{ data: LoginResponse }>('/auth/patient/register', {
      ...details,
      locale,
      code: v.code,
      password: v.password,
    });
    const data = res.data.data;
    if (data.accessToken) {
      rotateSessionId();
      storeToken(data.accessToken);
      trackActivity({ type: 'session_start' });
    }
    track('portal.register.complete');
    navigate('/portal', { replace: true });
  };

  return (
    <Box>
      <Typography variant="h3" component="h1">
        {t('auth.registerTitle')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 6 }}>
        {t('auth.registerSubtitle')}
      </Typography>
      <Stepper
        activeStep={details ? 1 : 0}
        alternativeLabel
        sx={{
          mb: 8,
          '& .MuiStepIcon-root.Mui-active, & .MuiStepIcon-root.Mui-completed': { color: '#06B6D4' },
        }}
      >
        <Step>
          <StepLabel>{t('auth.stepDetails')}</StepLabel>
        </Step>
        <Step>
          <StepLabel>{t('auth.stepVerify')}</StepLabel>
        </Step>
      </Stepper>

      {!details ? (
        <Form form={detailsForm} name="portal.register.details" onSubmit={sendCode}>
          <Stack spacing={4}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
              <RHFTextField
                name="firstName"
                label={t('auth.firstName')}
                required
                autoFocus
                autoComplete="given-name"
              />
              <RHFTextField
                name="lastName"
                label={t('auth.lastName')}
                required
                autoComplete="family-name"
              />
            </Stack>
            <RHFPhone
              name="phone"
              label={t('auth.phone')}
              helperText={t('auth.phoneHelper')}
              required
            />
            <RHFTextField
              name="email"
              label={`${t('auth.email')} ${t('validation:optional')}`}
              type="email"
              autoComplete="email"
              inputProps={{ dir: 'ltr', inputMode: 'email' }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={detailsForm.formState.isSubmitting}
              sx={patientCta}
            >
              {detailsForm.formState.isSubmitting ? t('common:states.loading') : t('auth.continue')}
            </Button>
          </Stack>
        </Form>
      ) : (
        <Form form={verifyForm} name="portal.register.verify" onSubmit={create}>
          <Stack spacing={4}>
            <Typography color="text.secondary">
              {/* U+2066/U+2069 isolate the number so it reads left-to-right inside Arabic text. */}
              {t('auth.codeSentTo', { phone: ltrIsolate(details.phone) })}
            </Typography>
            {devCode && <Alert severity="info">{t('auth.devCode', { code: devCode })}</Alert>}
            <RHFOtp name="code" label={t('auth.code')} autoFocus />
            <Stack direction="row" justifyContent="space-between">
              <Button size="small" onClick={() => setDetails(null)}>
                {t('auth.changeNumber')}
              </Button>
              <Button size="small" disabled={cooldown > 0} onClick={() => void sendCode(details)}>
                {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')}
              </Button>
            </Stack>
            <RHFPasswordField
              name="password"
              label={t('auth.choosePassword')}
              required
              showRules
              autoComplete="new-password"
            />
            <RHFPasswordField
              name="confirmPassword"
              label={t('auth.confirmPassword')}
              required
              autoComplete="new-password"
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={verifyForm.formState.isSubmitting}
              sx={patientCta}
            >
              {verifyForm.formState.isSubmitting ? t('common:states.saving') : t('auth.create')}
            </Button>
            <Typography variant="caption" color="text.secondary" textAlign="center">
              {t('auth.terms')}
            </Typography>
          </Stack>
        </Form>
      )}
      <Typography textAlign="center" sx={{ mt: 6 }}>
        {t('auth.haveAccount')}{' '}
        <Link component={RouterLink} to="/portal/login" fontWeight={700}>
          {t('auth.signIn')}
        </Link>
      </Typography>
    </Box>
  );
}
