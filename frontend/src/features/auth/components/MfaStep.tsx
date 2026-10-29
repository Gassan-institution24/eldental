import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Form } from '@/shared/form/Form';
import { RHFOtp } from '@/shared/form/RHFInputs';
import { useAppForm } from '@/shared/form/useAppForm';
import { api } from '@/lib/api/axios';
import { loginMfa, storeToken } from '../api/authApi';
import { mfaSchema } from '../schemas';
import type { LoginResponse } from '../types';

type Props = { mfaToken: string; setup: boolean; onDone: (res: LoginResponse) => void; onBack: () => void };

/** TOTP step after password; for superadmins without MFA it first shows the setup QR (11 §1). */
export function MfaStep({ mfaToken, setup, onDone, onBack }: Props) {
  const { t } = useTranslation('auth');
  const form = useAppForm<{ code: string }>({ schema: mfaSchema, defaultValues: { code: '' } });
  const [qr, setQr] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [recovery, setRecovery] = useState<{ codes: string[]; res: LoginResponse } | null>(null);

  useEffect(() => {
    if (!setup) return;
    void api
      .post<{ data: { qrDataUrl: string; secret: string } }>('/auth/mfa/setup', { mfaToken }, { skipAuthRefresh: true })
      .then((r) => setQr(r.data.data));
  }, [setup, mfaToken]);

  const onSubmit = async ({ code }: { code: string }) => {
    if (setup) {
      const r = await api.post<{ data: LoginResponse & { recoveryCodes: string[] } }>('/auth/mfa/enable', { mfaToken, code }, { skipAuthRefresh: true });
      const data = r.data.data;
      if (data.accessToken) storeToken(data.accessToken);
      setRecovery({ codes: data.recoveryCodes, res: data });
      return;
    }
    onDone(await loginMfa({ mfaToken, code }));
  };

  if (recovery) {
    return (
      <Box>
        <Typography variant="h3" component="h1">
          {t('mfa.recoveryTitle')}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 4 }}>
          {t('mfa.recoveryBody')}
        </Typography>
        <Box component="ul" dir="ltr" sx={{ fontFamily: 'monospace', columns: 2, p: 4, bgcolor: 'action.hover', borderRadius: 2, listStyle: 'none', m: 0 }}>
          {recovery.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </Box>
        <Button fullWidth variant="contained" sx={{ mt: 6 }} onClick={() => onDone(recovery.res)}>
          {t('mfa.recoveryDone')}
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h3" component="h1">
        {setup ? t('mfa.setupTitle') : t('mfa.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1, mb: 4 }}>
        {setup ? t('mfa.setupBody') : t('mfa.subtitle')}
      </Typography>
      {setup && qr && (
        <Stack alignItems="center" spacing={2} sx={{ mb: 4 }}>
          <img src={qr.qrDataUrl} alt="" width={180} height={180} />
          <Typography variant="caption" color="text.secondary">
            {t('mfa.secret')}
          </Typography>
          <Typography dir="ltr" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {qr.secret}
          </Typography>
        </Stack>
      )}
      {!mfaToken && <Alert severity="error">{t('errors:MFA_INVALID')}</Alert>}
      <Form form={form} name="auth.mfa" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <RHFOtp name="code" label={t('mfa.code')} autoFocus onComplete={() => void form.handleSubmit(onSubmit)()} />
          <Button type="submit" variant="contained" size="large" disabled={form.formState.isSubmitting}>
            {setup ? t('mfa.enable') : t('mfa.submit')}
          </Button>
          <Button onClick={onBack}>{t('mfa.back')}</Button>
        </Stack>
      </Form>
    </Box>
  );
}
