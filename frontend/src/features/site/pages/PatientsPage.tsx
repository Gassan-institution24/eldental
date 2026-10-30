import { Box, Button, Card, Grid, Stack, Typography } from '@mui/material';
import { Bell, CalendarClock, FileText, HeartHandshake, Lock, Users } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { GlowBackdrop } from '@/shared/components/Brand';
import { patientGradient } from '@/theme/tokens';
import { patientCta } from '@/features/portal/pages/PatientAuthPages';
import { PageHero, Reveal, Section, SectionHeading } from '../components/SiteBlocks';
import { ForwardArrow } from '../components/Sections';

const BENEFITS = [
  { k: 'b1', icon: <CalendarClock size={22} /> },
  { k: 'b2', icon: <Bell size={22} /> },
  { k: 'b3', icon: <HeartHandshake size={22} /> },
  { k: 'b4', icon: <FileText size={22} /> },
  { k: 'b5', icon: <Users size={22} /> },
  { k: 'b6', icon: <Lock size={22} /> },
];

/** Website page for patients, leading to the patient portal sign-up / sign-in. */
export function PatientsPage() {
  const { t } = useTranslation('patient');
  useEffect(() => {
    document.title = `${t('site.nav')} · ${t('common:appName')}`;
  }, [t]);

  return (
    <>
      <PageHero overline={t('site.overline')} title={t('site.title')} subtitle={t('site.subtitle')}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={3}
          justifyContent="center"
          sx={{ mt: 10 }}
        >
          <Button
            component={RouterLink}
            to="/portal/register"
            variant="contained"
            size="large"
            sx={patientCta}
            endIcon={<ForwardArrow />}
          >
            {t('site.create')}
          </Button>
          <Button
            component={RouterLink}
            to="/portal/login"
            variant="outlined"
            size="large"
            color="inherit"
          >
            {t('site.signIn')}
          </Button>
        </Stack>
      </PageHero>

      <Section sx={{ pt: 0 }}>
        <Grid container spacing={5}>
          {BENEFITS.map((b, i) => (
            <Grid item xs={12} sm={6} md={4} key={b.k}>
              <Reveal delay={(i % 3) * 80} sx={{ height: '100%' }}>
                <Card sx={{ p: 7, height: '100%' }}>
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '14px',
                      display: 'grid',
                      placeItems: 'center',
                      color: '#fff',
                      backgroundImage: patientGradient,
                    }}
                  >
                    {b.icon}
                  </Box>
                  <Typography variant="h5" sx={{ mt: 5 }}>
                    {t(`site.${b.k}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    {t(`site.${b.k}.body`)}
                  </Typography>
                </Card>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Section>

      <Section tinted>
        <SectionHeading title={t('site.howTitle')} />
        <Grid container spacing={8}>
          {[1, 2, 3].map((n) => (
            <Grid item xs={12} md={4} key={n}>
              <Reveal delay={n * 100}>
                <Typography
                  fontSize={56}
                  fontWeight={800}
                  lineHeight={1}
                  sx={{
                    backgroundImage: patientGradient,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    display: 'inline-block',
                  }}
                >
                  0{n}
                </Typography>
                <Typography variant="h4" sx={{ mt: 4 }}>
                  {t(`site.h${n}.title`)}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 2 }}>
                  {t(`site.h${n}.body`)}
                </Typography>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Section>

      <Section>
        <Reveal>
          <Box
            sx={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: '28px',
              px: { xs: 6, md: 16 },
              py: { xs: 14, md: 18 },
              textAlign: 'center',
              color: '#fff',
              background: patientGradient,
            }}
          >
            <GlowBackdrop dense sx={{ opacity: 0.5 }} />
            <Box sx={{ position: 'relative' }}>
              <Typography variant="h2" sx={{ color: '#fff' }}>
                {t('site.ctaTitle')}
              </Typography>
              <Typography sx={{ mt: 4, color: 'rgba(255,255,255,.88)', fontSize: 18 }}>
                {t('site.ctaBody')}
              </Typography>
              <Button
                component={RouterLink}
                to="/portal/register"
                size="large"
                sx={{
                  mt: 10,
                  bgcolor: '#fff',
                  color: '#0E7490',
                  fontWeight: 800,
                  '&:hover': { bgcolor: 'rgba(255,255,255,.9)' },
                }}
                endIcon={<ForwardArrow />}
              >
                {t('site.create')}
              </Button>
            </Box>
          </Box>
        </Reveal>
      </Section>
    </>
  );
}
