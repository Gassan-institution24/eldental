import { Alert, Avatar, Box, Button, Card, Chip, Grid, Stack, Typography } from '@mui/material';
import { Baby, Link2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { formatDate } from '@/lib/dates';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import {
  dateOfBirth,
  enumOf,
  objectId,
  otpCode,
  personName,
  slug,
} from '@/shared/generated/validation/fields';
import { Form } from '@/shared/form/Form';
import { RHFDate, RHFOtp } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import {
  useAddDependant,
  useLinkFile,
  useOnlineClinics,
  usePortalMe,
  type PortalPatient,
} from '../api';
import { PortalHeader } from '../components';
import { patientCta } from './PatientAuthPages';

/** Same rules as the server's `linkStartBody` / `linkConfirmBody` / `dependantBody`. */
const fileNumber = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, { message: 'required' })
  .max(20, { message: 'too_long' });
const linkSchema = z.object({ clinicSlug: slug(), fileNumber, code: z.string() });
type LinkValues = { clinicSlug: string; fileNumber: string; code: string };
const childSchema = z.object({
  guardianPatientId: objectId(),
  first: personName(),
  family: personName(),
  dateOfBirth: dateOfBirth(),
  gender: enumOf(['male', 'female']),
});
type ChildValues = z.input<typeof childSchema>;

function LinkFileCard() {
  const { t } = useTranslation('patient');
  const notify = useNotify();
  const clinics = useOnlineClinics();
  const link = useLinkFile();
  const [sent, setSent] = useState<{ phoneHint: string; devCode?: string } | null>(null);
  const form = useAppForm<LinkValues>({
    schema: sent ? linkSchema.extend({ code: otpCode() }) : linkSchema,
    defaultValues: { clinicSlug: '', fileNumber: '', code: '' },
  });

  const onSubmit = async (v: LinkValues) => {
    const body = {
      clinicSlug: v.clinicSlug.trim().toLowerCase(),
      fileNumber: v.fileNumber.trim().toUpperCase(),
    };
    if (!sent) {
      const r = await link.start.mutateAsync(body);
      setSent(r);
      return;
    }
    await link.confirm.mutateAsync({ ...body, code: v.code });
    notify.success(t('portal.family.link.done'));
    setSent(null);
    form.reset();
  };

  return (
    <Card sx={{ p: { xs: 4, md: 6 }, height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Link2 size={22} />
        <Typography variant="h5" component="h2">
          {t('portal.family.link.title')}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        {t('portal.family.link.body')}
      </Typography>
      <Form form={form} name="portal.linkFile" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <RHFTextField
            name="clinicSlug"
            label={t('portal.family.link.clinic')}
            helperText={t('portal.family.link.clinicHint')}
            required
            disabled={Boolean(sent)}
            inputProps={{ dir: 'ltr' }}
          />
          {!sent && (clinics.data ?? []).length > 0 && (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: -2 }}>
              {(clinics.data ?? []).slice(0, 8).map((c) => (
                <Chip
                  key={c.slug}
                  label={c.name}
                  variant="outlined"
                  onClick={() =>
                    form.setValue('clinicSlug', c.slug, { shouldValidate: true, shouldDirty: true })
                  }
                />
              ))}
            </Stack>
          )}
          <RHFTextField
            name="fileNumber"
            label={t('portal.family.link.fileNumber')}
            helperText={t('portal.family.link.fileNumberHint')}
            required
            disabled={Boolean(sent)}
            maxLength={20}
            inputProps={{ dir: 'ltr' }}
          />
          {sent && (
            <>
              <Alert severity="info">
                {t('portal.family.link.codeSent', { phone: sent.phoneHint })}
                {sent.devCode ? ` (${t('auth.devCode', { code: sent.devCode })})` : ''}
              </Alert>
              <RHFOtp name="code" label={t('portal.family.link.code')} autoFocus />
            </>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Button
              type="submit"
              variant="contained"
              sx={patientCta}
              disabled={form.formState.isSubmitting}
            >
              {sent ? t('portal.family.link.confirm') : t('portal.family.link.send')}
            </Button>
            {sent && (
              <Button onClick={() => setSent(null)}>{t('portal.family.link.change')}</Button>
            )}
          </Stack>
        </Stack>
      </Form>
    </Card>
  );
}

function AddChildCard({ guardians }: { guardians: PortalPatient[] }) {
  const { t } = useTranslation('patient');
  const notify = useNotify();
  const add = useAddDependant();
  const form = useAppForm<ChildValues>({
    schema: childSchema,
    defaultValues: {
      guardianPatientId: guardians[0]?.id ?? '',
      first: '',
      family: '',
      dateOfBirth: '',
      gender: '' as 'male',
    },
  });
  const onSubmit = async (v: ChildValues) => {
    await add.mutateAsync(childSchema.parse(v));
    notify.success(t('portal.family.child.done', { name: v.first }));
    form.reset({ ...form.getValues(), first: '', dateOfBirth: '' });
  };
  return (
    <Card sx={{ p: { xs: 4, md: 6 }, height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Baby size={22} />
        <Typography variant="h5" component="h2">
          {t('portal.family.child.title')}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        {t('portal.family.child.body')}
      </Typography>
      <Form form={form} name="portal.addDependant" onSubmit={onSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <RHFSelect
              name="guardianPatientId"
              label={t('portal.family.child.clinicFile')}
              required
              options={guardians.map((g) => ({
                value: g.id,
                label: `${g.clinic?.name ?? ''} · ${g.fileNumber}`,
              }))}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField name="first" label={t('portal.family.child.first')} required />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField name="family" label={t('portal.family.child.family')} required />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFDate
              name="dateOfBirth"
              label={t('portal.family.child.dateOfBirth')}
              required
              disableFuture
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect
              name="gender"
              label={t('portal.family.child.gender')}
              required
              options={[
                { value: 'male', label: t('portal.common.male') },
                { value: 'female', label: t('portal.common.female') },
              ]}
            />
          </Grid>
          <Grid item xs={12}>
            <Button
              type="submit"
              variant="contained"
              sx={patientCta}
              disabled={form.formState.isSubmitting}
            >
              {t('portal.family.child.submit')}
            </Button>
          </Grid>
        </Grid>
      </Form>
    </Card>
  );
}

/** Linked clinic files and dependants (guardian manages child profiles, 01 §4.10). */
export function FamilyPage() {
  const { t, i18n } = useTranslation('patient');
  const me = usePortalMe();
  if (me.isLoading) return <PageSkeleton />;
  if (me.isError || !me.data)
    return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const patients = me.data.patients;
  const guardians = patients.filter((p) => p.relation === 'self');

  return (
    <>
      <PortalHeader title={t('portal.family.title')} subtitle={t('portal.family.subtitle')} />
      {patients.length === 0 ? (
        <Alert severity="info" sx={{ mb: 5 }}>
          {t('portal.family.none')}
        </Alert>
      ) : (
        <Grid container spacing={4} sx={{ mb: 6 }}>
          {patients.map((p) => (
            <Grid item xs={12} sm={6} lg={4} xl={3} key={p.id}>
              <Card sx={{ p: 5, height: '100%' }}>
                <Stack direction="row" spacing={3} alignItems="center">
                  <Avatar
                    sx={{ bgcolor: p.gender === 'female' ? 'secondary.main' : 'primary.main' }}
                  >
                    {p.relation === 'dependant' ? <Baby size={20} /> : <UserRound size={20} />}
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={800} dir="auto" noWrap>
                      {p.fullName}
                    </Typography>
                    <Chip
                      size="small"
                      label={t(`portal.common.${p.relation}`)}
                      color={p.relation === 'self' ? 'primary' : 'default'}
                      variant="outlined"
                    />
                  </Box>
                </Stack>
                <Stack spacing={0.5} sx={{ mt: 3 }}>
                  <Typography variant="body2" color="text.secondary" dir="auto">
                    {p.clinic?.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('portal.common.file')}: <span dir="ltr">{p.fileNumber}</span>
                  </Typography>
                  {p.dateOfBirth && (
                    <Typography variant="body2" color="text.secondary">
                      {t('portal.family.born', { date: formatDate(p.dateOfBirth, i18n.language) })}
                    </Typography>
                  )}
                </Stack>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      <Grid container spacing={4}>
        <Grid item xs={12} lg={6}>
          <LinkFileCard />
        </Grid>
        {guardians.length > 0 && (
          <Grid item xs={12} lg={6}>
            <AddChildCard guardians={guardians} />
          </Grid>
        )}
      </Grid>
    </>
  );
}
