import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  Chip,
  Grid,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { GlowBackdrop } from '@/shared/components/Brand';
import { brand } from '@/theme/tokens';
import { CheckList, Reveal, Section, SectionHeading } from './SiteBlocks';

/** Arrow that points "forward" in the current reading direction. */
export function ForwardArrow({ size = 18 }: { size?: number }) {
  const { i18n } = useTranslation();
  return i18n.dir() === 'rtl' ? <ArrowLeft size={size} /> : <ArrowRight size={size} />;
}

/** Placeholder list prices in JOD per month — edit here (or move to platform plans later). */
const PLANS = [
  { key: 'starter', monthly: 29, yearly: 24 },
  { key: 'pro', monthly: 59, yearly: 49, popular: true },
  { key: 'enterprise', monthly: null, yearly: null },
] as const;

export function PricingPlans() {
  const { t } = useTranslation('site');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  return (
    <>
      <Stack
        direction="row"
        justifyContent="center"
        alignItems="center"
        spacing={3}
        sx={{ mb: 10 }}
      >
        <ToggleButtonGroup
          exclusive
          value={cycle}
          onChange={(_e, v: 'monthly' | 'yearly' | null) => v && setCycle(v)}
          size="small"
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 999,
            p: 0.5,
            '& .MuiToggleButton-root': {
              border: 0,
              borderRadius: '999px !important',
              px: 5,
              fontWeight: 700,
              textTransform: 'none',
            },
            '& .Mui-selected': { backgroundImage: brand.gradient, color: '#fff !important' },
          }}
        >
          <ToggleButton value="monthly">{t('pricing.monthly')}</ToggleButton>
          <ToggleButton value="yearly">{t('pricing.yearly')}</ToggleButton>
        </ToggleButtonGroup>
        <Chip size="small" color="success" variant="outlined" label={t('pricing.save')} />
      </Stack>
      <Grid container spacing={5} alignItems="stretch">
        {PLANS.map((p, i) => {
          const price = p[cycle];
          const popular = 'popular' in p && p.popular;
          return (
            <Grid item xs={12} md={4} key={p.key}>
              <Reveal delay={i * 90} sx={{ height: '100%' }}>
                <Card
                  sx={(theme) => ({
                    p: 7,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    overflow: 'visible',
                    borderWidth: popular ? 2 : 1,
                    borderColor: popular ? 'primary.main' : 'divider',
                    boxShadow: popular
                      ? `0 30px 60px -30px ${alpha(brand.violet, 0.6)}`
                      : undefined,
                    transform: popular ? { md: 'translateY(-12px)' } : undefined,
                    bgcolor:
                      popular && theme.palette.mode === 'dark'
                        ? alpha(brand.indigo, 0.08)
                        : 'background.paper',
                  })}
                >
                  {popular && (
                    <Chip
                      label={t('pricing.popular')}
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: -13,
                        insetInlineStart: '50%',
                        transform: 'translateX(-50%)',
                        backgroundImage: brand.gradient,
                        color: '#fff',
                      }}
                    />
                  )}
                  <Typography variant="h4">{t(`pricing.${p.key}.name`)}</Typography>
                  <Typography color="text.secondary" sx={{ mt: 1, minHeight: 48 }}>
                    {t(`pricing.${p.key}.desc`)}
                  </Typography>
                  <Stack direction="row" alignItems="baseline" spacing={2} sx={{ my: 6 }}>
                    {price === null ? (
                      <Typography fontSize={40} fontWeight={800}>
                        {t('pricing.custom')}
                      </Typography>
                    ) : (
                      <>
                        <Typography fontSize={48} fontWeight={800} lineHeight={1}>
                          {price}
                        </Typography>
                        <Typography color="text.secondary" fontWeight={600}>
                          {t('pricing.currency')} {t('pricing.perMonth')}
                        </Typography>
                      </>
                    )}
                  </Stack>
                  {cycle === 'yearly' && price !== null && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: -4, mb: 4 }}>
                      {t('pricing.billedYearly')}
                    </Typography>
                  )}
                  <CheckList items={[1, 2, 3, 4].map((n) => t(`pricing.${p.key}.f${n}`))} />
                  <Box sx={{ flex: 1 }} />
                  <Button
                    component={RouterLink}
                    to={`/contact?plan=${p.key}`}
                    variant={popular ? 'contained' : 'outlined'}
                    size="large"
                    fullWidth
                    sx={{ mt: 8 }}
                  >
                    {t(`pricing.${p.key}.cta`)}
                  </Button>
                </Card>
              </Reveal>
            </Grid>
          );
        })}
      </Grid>
    </>
  );
}

export function FaqList() {
  const { t } = useTranslation('site');
  return (
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      {[1, 2, 3, 4, 5, 6].map((n, i) => (
        <Reveal key={n} delay={i * 50}>
          <Accordion sx={{ bgcolor: 'background.paper' }}>
            <AccordionSummary expandIcon={<ChevronDown size={20} />} sx={{ px: 5, py: 1.5 }}>
              <Typography fontWeight={700}>{t(`faq.q${n}`)}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 5, pb: 5 }}>
              <Typography color="text.secondary">{t(`faq.a${n}`)}</Typography>
            </AccordionDetails>
          </Accordion>
        </Reveal>
      ))}
    </Box>
  );
}

export function FaqSection() {
  const { t } = useTranslation('site');
  return (
    <Section id="faq">
      <SectionHeading overline={t('faq.overline')} title={t('faq.title')} />
      <FaqList />
    </Section>
  );
}

export function CtaBand() {
  const { t } = useTranslation('site');
  return (
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
            background: `${brand.sidebar}`,
          }}
        >
          <GlowBackdrop dense />
          <Box sx={{ position: 'relative' }}>
            <Typography variant="h2" sx={{ color: '#fff', maxWidth: 720, mx: 'auto' }}>
              {t('cta.title')}
            </Typography>
            <Typography
              sx={{
                mt: 4,
                color: 'rgba(226,232,255,.75)',
                fontSize: 18,
                maxWidth: 620,
                mx: 'auto',
              }}
            >
              {t('cta.subtitle')}
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
                {t('cta.primary')}
              </Button>
              <Button
                component={RouterLink}
                to="/login"
                size="large"
                sx={{
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,.25)',
                  '&:hover': { bgcolor: 'rgba(255,255,255,.08)' },
                }}
              >
                {t('cta.secondary')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Reveal>
    </Section>
  );
}
