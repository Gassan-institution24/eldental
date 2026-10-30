import { Box, Button, Card, Chip, Container, Grid, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  ClipboardCheck,
  Crown,
  Lock,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  Wallet,
  Zap,
  Languages,
  Headset,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { GlowBackdrop, GradientText } from '@/shared/components/Brand';
import { brand } from '@/theme/tokens';
import { BoardMock, ChartMock, DashboardMock, LedgerMock } from '../components/Mockups';
import { CtaBand, FaqSection, ForwardArrow, PricingPlans } from '../components/Sections';
import {
  CheckList,
  IconTile,
  Overline,
  Reveal,
  Section,
  SectionHeading,
} from '../components/SiteBlocks';

function Hero() {
  const { t } = useTranslation('site');
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        pt: { xs: 30, md: 40 },
        pb: { xs: 16, md: 24 },
      }}
    >
      <GlowBackdrop />
      <Container maxWidth="lg" sx={{ position: 'relative' }}>
        <Reveal sx={{ textAlign: 'center', maxWidth: 880, mx: 'auto' }}>
          <Chip
            icon={<Sparkles size={14} />}
            label={t('hero.badge')}
            component={RouterLink}
            to="/features"
            clickable
            sx={(theme) => ({
              mb: 7,
              px: 1,
              py: 2.25,
              bgcolor: alpha(theme.palette.background.paper, 0.7),
              backdropFilter: 'blur(8px)',
              border: 1,
              borderColor: 'divider',
              '& .MuiChip-icon': { color: 'primary.main' },
            })}
          />
          <Typography variant="h1" component="h1">
            {t('hero.title')} <GradientText>{t('hero.highlight')}</GradientText>
          </Typography>
          <Typography
            variant="subtitle1"
            sx={{ mt: 6, fontSize: { xs: 17, md: 20 }, maxWidth: 720, mx: 'auto' }}
          >
            {t('hero.subtitle')}
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={3}
            justifyContent="center"
            sx={{ mt: 10 }}
          >
            <Button
              component={RouterLink}
              to="/contact"
              variant="contained"
              size="large"
              endIcon={<ForwardArrow />}
            >
              {t('hero.ctaPrimary')}
            </Button>
            <Button
              component={RouterLink}
              to="/features"
              variant="outlined"
              size="large"
              color="inherit"
            >
              {t('hero.ctaSecondary')}
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={{ xs: 4, sm: 8 }}
            justifyContent="center"
            sx={{ mt: 8, color: 'text.secondary', flexWrap: 'wrap', rowGap: 2 }}
          >
            {[
              [<Languages key="l" size={16} />, t('hero.trust1')],
              [<ShieldCheck key="s" size={16} />, t('hero.trust2')],
              [<Zap key="z" size={16} />, t('hero.trust3')],
            ].map(([icon, label]) => (
              <Stack key={String(label)} direction="row" spacing={1.5} alignItems="center">
                <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
                <Typography variant="body2" fontWeight={600}>
                  {label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Reveal>
        <Reveal delay={150} sx={{ mt: { xs: 14, md: 20 } }}>
          <DashboardMock />
        </Reveal>
      </Container>
    </Box>
  );
}

function Stats() {
  const { t } = useTranslation('site');
  return (
    <Container maxWidth="lg">
      <Card sx={{ p: { xs: 6, md: 8 }, borderRadius: '24px' }}>
        <Grid container spacing={6}>
          {[1, 2, 3, 4].map((n) => (
            <Grid item xs={6} md={3} key={n}>
              <Reveal delay={n * 60}>
                <Typography
                  fontSize={{ xs: 28, md: 36 }}
                  fontWeight={800}
                  sx={{
                    backgroundImage: brand.gradient,
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    display: 'inline-block',
                  }}
                >
                  {t(`stats.s${n}v`)}
                </Typography>
                <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
                  {t(`stats.s${n}l`)}
                </Typography>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Card>
    </Container>
  );
}

export const FEATURE_ITEMS = [
  { key: 'scheduling', icon: <CalendarClock size={22} /> },
  { key: 'charting', icon: <Stethoscope size={22} /> },
  { key: 'plans', icon: <ClipboardCheck size={22} /> },
  { key: 'billing', icon: <ReceiptText size={22} /> },
  { key: 'accounting', icon: <BarChart3 size={22} /> },
  { key: 'hr', icon: <Wallet size={22} /> },
  { key: 'portal', icon: <Smartphone size={22} /> },
  { key: 'security', icon: <Lock size={22} /> },
] as const;

export function FeatureGrid() {
  const { t } = useTranslation('site');
  return (
    <Grid container spacing={5}>
      {FEATURE_ITEMS.map((f, i) => (
        <Grid item xs={12} sm={6} md={3} key={f.key}>
          <Reveal delay={(i % 4) * 70} sx={{ height: '100%' }}>
            <Card
              sx={(theme) => ({
                p: 6,
                height: '100%',
                transition: 'transform .25s ease, box-shadow .25s ease, border-color .25s ease',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: theme.brand.elevated,
                  borderColor: alpha(theme.palette.primary.main, 0.35),
                },
              })}
            >
              <IconTile>{f.icon}</IconTile>
              <Typography variant="h5" sx={{ mt: 5 }}>
                {t(`features.${f.key}.title`)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {t(`features.${f.key}.body`)}
              </Typography>
            </Card>
          </Reveal>
        </Grid>
      ))}
    </Grid>
  );
}

function HowItWorks() {
  const { t } = useTranslation('site');
  return (
    <Section tinted>
      <SectionHeading overline={t('how.overline')} title={t('how.title')} />
      <Grid container spacing={8}>
        {[1, 2, 3].map((n) => (
          <Grid item xs={12} md={4} key={n}>
            <Reveal delay={n * 100}>
              <Typography
                fontSize={56}
                fontWeight={800}
                lineHeight={1}
                sx={{
                  backgroundImage: brand.gradient,
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                  opacity: 0.9,
                }}
              >
                0{n}
              </Typography>
              <Typography variant="h4" sx={{ mt: 4 }}>
                {t(`how.s${n}.title`)}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 2 }}>
                {t(`how.s${n}.body`)}
              </Typography>
            </Reveal>
          </Grid>
        ))}
      </Grid>
    </Section>
  );
}

export function Spotlight({
  n,
  visual,
  flip,
}: {
  n: 1 | 2 | 3;
  visual: React.ReactNode;
  flip?: boolean;
}) {
  const { t } = useTranslation('site');
  return (
    <Grid
      container
      spacing={{ xs: 10, md: 16 }}
      alignItems="center"
      direction={flip ? 'row-reverse' : 'row'}
      sx={{ py: { xs: 8, md: 12 } }}
    >
      <Grid item xs={12} md={5}>
        <Reveal>
          <Overline>{t(`spotlight.s${n}.overline`)}</Overline>
          <Typography variant="h2">{t(`spotlight.s${n}.title`)}</Typography>
          <Typography variant="subtitle1" sx={{ mt: 4, mb: 7 }}>
            {t(`spotlight.s${n}.body`)}
          </Typography>
          <CheckList items={[1, 2, 3].map((b) => t(`spotlight.s${n}.b${b}`))} />
        </Reveal>
      </Grid>
      <Grid item xs={12} md={7}>
        <Reveal delay={120}>{visual}</Reveal>
      </Grid>
    </Grid>
  );
}

function Roles() {
  const { t } = useTranslation('site');
  const roles = [
    { key: 'owner', icon: <Crown size={22} /> },
    { key: 'dentist', icon: <Stethoscope size={22} /> },
    { key: 'reception', icon: <Headset size={22} /> },
    { key: 'accountant', icon: <Briefcase size={22} /> },
  ];
  return (
    <Section tinted>
      <SectionHeading overline={t('roles.overline')} title={t('roles.title')} />
      <Grid container spacing={5}>
        {roles.map((r, i) => (
          <Grid item xs={12} sm={6} md={3} key={r.key}>
            <Reveal delay={i * 70} sx={{ height: '100%' }}>
              <Box
                sx={{
                  p: 6,
                  height: '100%',
                  borderRadius: '18px',
                  border: 1,
                  borderColor: 'divider',
                  backgroundImage: brand.gradientSoft,
                }}
              >
                <Box sx={{ color: 'primary.main' }}>{r.icon}</Box>
                <Typography variant="h5" sx={{ mt: 4 }}>
                  {t(`roles.${r.key}.title`)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                  {t(`roles.${r.key}.body`)}
                </Typography>
              </Box>
            </Reveal>
          </Grid>
        ))}
      </Grid>
    </Section>
  );
}

/** Marketing home page. */
export function HomePage() {
  const { t } = useTranslation('site');
  useEffect(() => {
    document.title = t('meta.homeTitle');
  }, [t]);
  return (
    <>
      <Hero />
      <Stats />
      <Section id="features">
        <SectionHeading
          overline={t('features.overline')}
          title={t('features.title')}
          subtitle={t('features.subtitle')}
        />
        <FeatureGrid />
      </Section>
      <HowItWorks />
      <Section>
        <Spotlight n={1} visual={<BoardMock />} />
        <Spotlight n={2} visual={<ChartMock />} flip />
        <Spotlight n={3} visual={<LedgerMock />} />
      </Section>
      <Roles />
      <Section id="pricing">
        <SectionHeading
          overline={t('pricing.overline')}
          title={t('pricing.title')}
          subtitle={t('pricing.subtitle')}
        />
        <PricingPlans />
      </Section>
      <FaqSection />
      <CtaBand />
    </>
  );
}
