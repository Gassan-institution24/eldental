import {
  Box,
  Card,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  Check,
  Database,
  Eye,
  FileClock,
  Fingerprint,
  HardDriveDownload,
  Heart,
  KeyRound,
  Languages,
  Minus,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardMock, ChartMock, LedgerMock } from '../components/Mockups';
import { CtaBand, FaqSection, PricingPlans } from '../components/Sections';
import { IconTile, PageHero, Reveal, Section, SectionHeading } from '../components/SiteBlocks';
import { FeatureGrid, Spotlight } from './HomePage';
import { brand } from '@/theme/tokens';

function useTitle(key: string) {
  const { t } = useTranslation('site');
  useEffect(() => {
    document.title = `${t(key)} · ${t('common:appName')}`;
  }, [t, key]);
}

export function FeaturesPage() {
  const { t } = useTranslation('site');
  useTitle('meta.features');
  return (
    <>
      <PageHero
        overline={t('features.overline')}
        title={t('features.title')}
        subtitle={t('features.subtitle')}
      />
      <Section sx={{ pt: 0 }}>
        <FeatureGrid />
      </Section>
      <Section tinted>
        <Spotlight n={1} visual={<BoardMock />} />
        <Spotlight n={2} visual={<ChartMock />} flip />
        <Spotlight n={3} visual={<LedgerMock />} />
      </Section>
      <CtaBand />
    </>
  );
}

const COMPARE: [string, boolean, boolean, boolean][] = [
  ['r1', true, true, true],
  ['r2', true, true, true],
  ['r3', false, true, true],
  ['r4', false, true, true],
  ['r5', false, true, true],
  ['r6', true, true, true],
  ['r7', true, true, true],
  ['r8', false, false, true],
];

export function PricingPage() {
  const { t } = useTranslation('site');
  useTitle('meta.pricing');
  const cell = (v: boolean) =>
    v ? (
      <Box
        component="span"
        sx={{ color: 'success.main', display: 'inline-flex' }}
        aria-label={t('pricing.included')}
      >
        <Check size={18} />
      </Box>
    ) : (
      <Box
        component="span"
        sx={{ color: 'text.disabled', display: 'inline-flex' }}
        aria-label={t('pricing.notIncluded')}
      >
        <Minus size={18} />
      </Box>
    );
  return (
    <>
      <PageHero
        overline={t('pricing.overline')}
        title={t('pricing.title')}
        subtitle={t('pricing.subtitle')}
      />
      <Section sx={{ pt: 0 }}>
        <PricingPlans />
      </Section>
      <Section tinted>
        <SectionHeading title={t('pricing.compareTitle')} />
        <Reveal>
          <TableContainer component={Card}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('pricing.feature')}</TableCell>
                  <TableCell align="center">{t('pricing.starter.name')}</TableCell>
                  <TableCell align="center">{t('pricing.pro.name')}</TableCell>
                  <TableCell align="center">{t('pricing.enterprise.name')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {COMPARE.map(([k, a, b, c]) => (
                  <TableRow key={k} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{t(`pricing.rows.${k}`)}</TableCell>
                    <TableCell align="center">{cell(a)}</TableCell>
                    <TableCell align="center">{cell(b)}</TableCell>
                    <TableCell align="center">{cell(c)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Reveal>
      </Section>
      <FaqSection />
      <CtaBand />
    </>
  );
}

export function AboutPage() {
  const { t } = useTranslation('site');
  useTitle('meta.about');
  const values = [
    { k: 'v1', icon: <Heart size={22} /> },
    { k: 'v2', icon: <Languages size={22} /> },
    { k: 'v3', icon: <ShieldCheck size={22} /> },
    { k: 'v4', icon: <Scale size={22} /> },
  ];
  return (
    <>
      <PageHero
        overline={t('about.overline')}
        title={t('about.title')}
        subtitle={t('about.subtitle')}
      />
      <Section sx={{ pt: 0 }}>
        <Grid container spacing={6}>
          {(['mission', 'story'] as const).map((k, i) => (
            <Grid item xs={12} md={6} key={k}>
              <Reveal delay={i * 100} sx={{ height: '100%' }}>
                <Card
                  sx={{
                    p: { xs: 6, md: 10 },
                    height: '100%',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      insetInlineEnd: -40,
                      top: -40,
                      width: 160,
                      height: 160,
                      borderRadius: '50%',
                      backgroundImage: brand.gradient,
                      opacity: 0.12,
                    }}
                  />
                  <Typography variant="h3">{t(`about.${k}Title`)}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 4, fontSize: 17 }}>
                    {t(`about.${k}Body`)}
                  </Typography>
                </Card>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Section>
      <Section tinted>
        <SectionHeading title={t('about.valuesTitle')} />
        <Grid container spacing={5}>
          {values.map((v, i) => (
            <Grid item xs={12} sm={6} md={3} key={v.k}>
              <Reveal delay={i * 70}>
                <IconTile>{v.icon}</IconTile>
                <Typography variant="h5" sx={{ mt: 5 }}>
                  {t(`about.${v.k}.title`)}
                </Typography>
                <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
                  {t(`about.${v.k}.body`)}
                </Typography>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Section>
      <Section>
        <SectionHeading title={t('about.numbersTitle')} />
        <Grid container spacing={5}>
          {[1, 2, 3, 4].map((n) => (
            <Grid item xs={6} md={3} key={n}>
              <Reveal delay={n * 60}>
                <Card sx={{ p: 6, textAlign: 'center' }}>
                  <Typography
                    fontSize={40}
                    fontWeight={800}
                    sx={{
                      backgroundImage: brand.gradient,
                      WebkitBackgroundClip: 'text',
                      backgroundClip: 'text',
                      color: 'transparent',
                      display: 'inline-block',
                    }}
                    dir="ltr"
                  >
                    {t(`about.n${n}v`)}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {t(`about.n${n}l`)}
                  </Typography>
                </Card>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Section>
      <CtaBand />
    </>
  );
}

export function SecurityPage() {
  const { t } = useTranslation('site');
  useTitle('meta.security');
  const items = [
    { k: 'i1', icon: <Database size={22} /> },
    { k: 'i2', icon: <KeyRound size={22} /> },
    { k: 'i3', icon: <Eye size={22} /> },
    { k: 'i4', icon: <FileClock size={22} /> },
    { k: 'i5', icon: <Fingerprint size={22} /> },
    { k: 'i6', icon: <HardDriveDownload size={22} /> },
  ];
  return (
    <>
      <PageHero
        overline={t('securityPage.overline')}
        title={t('securityPage.title')}
        subtitle={t('securityPage.subtitle')}
      />
      <Section sx={{ pt: 0 }}>
        <Grid container spacing={5}>
          {items.map((it, i) => (
            <Grid item xs={12} sm={6} md={4} key={it.k}>
              <Reveal delay={(i % 3) * 80} sx={{ height: '100%' }}>
                <Card sx={{ p: 7, height: '100%' }}>
                  <IconTile>{it.icon}</IconTile>
                  <Typography variant="h5" sx={{ mt: 5 }}>
                    {t(`securityPage.${it.k}.title`)}
                  </Typography>
                  <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
                    {t(`securityPage.${it.k}.body`)}
                  </Typography>
                </Card>
              </Reveal>
            </Grid>
          ))}
        </Grid>
      </Section>
      <CtaBand />
    </>
  );
}

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { t, i18n } = useTranslation('site');
  useTitle(`meta.${kind}`);
  const date = new Intl.DateTimeFormat(
    i18n.resolvedLanguage === 'ar' ? 'ar-JO-u-nu-latn' : 'en-GB',
    { dateStyle: 'long' },
  ).format(new Date('2026-10-01'));
  return (
    <>
      <PageHero
        overline={t('footer.legal')}
        title={t(`legal.${kind}.title`)}
        subtitle={t('legal.updated', { date })}
      />
      <Section sx={{ pt: 0 }}>
        <Card sx={{ maxWidth: 820, mx: 'auto', p: { xs: 6, md: 12 } }}>
          <Typography sx={{ fontSize: 17 }}>{t(`legal.${kind}.intro`)}</Typography>
          <Stack spacing={8} sx={{ mt: 10 }}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <Box key={n}>
                <Typography variant="h4" component="h2">
                  {n}. {t(`legal.${kind}.s${n}t`)}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 2 }}>
                  {t(`legal.${kind}.s${n}b`)}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Card>
      </Section>
    </>
  );
}
