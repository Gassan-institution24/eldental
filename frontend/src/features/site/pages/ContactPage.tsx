import { Box, Button, Card, Grid, Stack, Typography } from '@mui/material';
import { CheckCircle2, Clock, Mail, MapPin, Phone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { postData } from '@/lib/api/axios';
import { track } from '@/lib/telemetry';
import {
  email,
  entityName,
  enumOf,
  freeText,
  optional,
  personName,
  phone,
} from '@/shared/generated/validation/fields';
import { Form } from '@/shared/form/Form';
import { RHFPhone } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { IconTile, PageHero, Reveal, Section } from '../components/SiteBlocks';

/** Same rules as the backend `contactBody` (16 §5.1). */
const contactSchema = z.object({
  name: personName({ max: 120 }),
  email: email(),
  phone: optional(phone()),
  clinicName: optional(entityName()),
  clinicSize: optional(enumOf(['s1', 's2', 's3', 's4'])),
  interest: enumOf(['demo', 'pricing', 'migration', 'other']),
  plan: optional(enumOf(['starter', 'pro', 'enterprise'])),
  message: optional(freeText(2000)),
});
type ContactForm = z.input<typeof contactSchema>;

export function ContactPage() {
  const { t, i18n } = useTranslation('site');
  const [params] = useSearchParams();
  const [sent, setSent] = useState(false);
  const plan = params.get('plan');
  const form = useAppForm<ContactForm>({
    schema: contactSchema,
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      clinicName: '',
      clinicSize: '',
      interest: plan ? 'pricing' : 'demo',
      plan: plan ?? '',
      message: '',
    },
  });

  useEffect(() => {
    document.title = `${t('meta.contact')} · ${t('common:appName')}`;
  }, [t]);

  const onSubmit = async (values: ContactForm) => {
    await postData('/public/contact', {
      ...values,
      locale: i18n.resolvedLanguage === 'en' ? 'en' : 'ar',
    });
    track('site.contact.submit', { interest: String(values.interest) });
    setSent(true);
    form.reset();
  };

  const info = [
    {
      icon: <Mail size={20} />,
      label: t('contact.emailLabel'),
      value: 'hello@eldental.app',
      ltr: true,
    },
    {
      icon: <Phone size={20} />,
      label: t('contact.phoneLabel'),
      value: '+962 6 500 0000',
      ltr: true,
    },
    { icon: <MapPin size={20} />, label: t('contact.addressLabel'), value: t('contact.address') },
    { icon: <Clock size={20} />, label: t('contact.hoursLabel'), value: t('contact.hours') },
  ];

  return (
    <>
      <PageHero
        overline={t('contact.overline')}
        title={t('contact.title')}
        subtitle={t('contact.subtitle')}
      />
      <Section sx={{ pt: 0 }}>
        <Grid container spacing={8}>
          <Grid item xs={12} md={7}>
            <Reveal>
              <Card sx={{ p: { xs: 6, md: 10 } }}>
                {sent ? (
                  <Stack
                    alignItems="center"
                    textAlign="center"
                    spacing={3}
                    sx={{ py: 10 }}
                    role="status"
                  >
                    <Box sx={{ color: 'success.main' }}>
                      <CheckCircle2 size={56} />
                    </Box>
                    <Typography variant="h3">{t('contact.success')}</Typography>
                    <Typography color="text.secondary">{t('contact.successBody')}</Typography>
                    <Button variant="outlined" onClick={() => setSent(false)} sx={{ mt: 4 }}>
                      {t('contact.sendAnother')}
                    </Button>
                  </Stack>
                ) : (
                  <Form form={form} name="site.contact" onSubmit={onSubmit} requiredLegend>
                    <Grid container spacing={4}>
                      <Grid item xs={12} sm={6}>
                        <RHFTextField
                          name="name"
                          label={t('contact.name')}
                          required
                          autoComplete="name"
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <RHFTextField
                          name="email"
                          label={t('contact.email')}
                          required
                          type="email"
                          autoComplete="email"
                          inputProps={{ dir: 'ltr', inputMode: 'email' }}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <RHFPhone name="phone" label={t('contact.phone')} />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <RHFTextField
                          name="clinicName"
                          label={t('contact.clinicName')}
                          autoComplete="organization"
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <RHFSelect
                          name="clinicSize"
                          label={t('contact.clinicSize')}
                          clearable
                          options={(['s1', 's2', 's3', 's4'] as const).map((v) => ({
                            value: v,
                            label: t(`contact.sizes.${v}`),
                          }))}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6}>
                        <RHFSelect
                          name="interest"
                          label={t('contact.interest')}
                          required
                          options={(['demo', 'pricing', 'migration', 'other'] as const).map(
                            (v) => ({ value: v, label: t(`contact.interests.${v}`) }),
                          )}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <RHFTextField
                          name="message"
                          label={t('contact.message')}
                          helperText={t('contact.messageHelper')}
                          multiline
                          minRows={5}
                          maxLength={2000}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <Button
                          type="submit"
                          variant="contained"
                          size="large"
                          fullWidth
                          disabled={form.formState.isSubmitting}
                        >
                          {form.formState.isSubmitting
                            ? t('common:states.saving')
                            : t('contact.submit')}
                        </Button>
                      </Grid>
                    </Grid>
                  </Form>
                )}
              </Card>
            </Reveal>
          </Grid>
          <Grid item xs={12} md={5}>
            <Reveal delay={120}>
              <Typography variant="h4" sx={{ mb: 6 }}>
                {t('contact.infoTitle')}
              </Typography>
              <Stack spacing={6}>
                {info.map((i) => (
                  <Stack key={i.label} direction="row" spacing={4} alignItems="center">
                    <IconTile size={46}>{i.icon}</IconTile>
                    <Box>
                      <Typography variant="body2" color="text.secondary">
                        {i.label}
                      </Typography>
                      <Typography fontWeight={650} dir={i.ltr ? 'ltr' : undefined}>
                        {i.value}
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            </Reveal>
          </Grid>
        </Grid>
      </Section>
    </>
  );
}
