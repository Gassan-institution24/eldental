import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { CalendarCheck, CheckCircle2, ShieldCheck, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Outlet } from 'react-router-dom';
import { ForwardArrow } from '@/features/site/components/Sections';
import { GlowBackdrop, Logo } from '@/shared/components/Brand';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { brand } from '@/theme/tokens';
import { LanguageToggle, ThemeToggle } from './shell/ShellControls';

function BrandPanel() {
  const { t } = useTranslation('site');
  const points = [
    { icon: <CalendarCheck size={18} />, text: t('authPanel.p1') },
    { icon: <TrendingUp size={18} />, text: t('authPanel.p2') },
    { icon: <ShieldCheck size={18} />, text: t('authPanel.p3') },
  ];
  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        background: brand.sidebar,
        color: '#fff',
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        p: { md: 12, lg: 16 },
      }}
    >
      <GlowBackdrop dense />
      <Box sx={{ position: 'relative' }}>
        <Logo to="/" size={40} light />
      </Box>
      <Box sx={{ position: 'relative', my: 'auto', maxWidth: 520 }}>
        <Typography variant="h2" sx={{ color: '#fff' }}>
          {t('authPanel.title')}
        </Typography>
        <Typography sx={{ mt: 4, color: 'rgba(226,232,255,.72)', fontSize: 17 }}>
          {t('authPanel.subtitle')}
        </Typography>
        <Stack spacing={4} sx={{ mt: 10 }}>
          {points.map((p) => (
            <Stack key={p.text} direction="row" spacing={3} alignItems="center">
              <Box
                sx={{
                  width: 38,
                  height: 38,
                  borderRadius: '12px',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'rgba(255,255,255,.08)',
                  border: '1px solid rgba(255,255,255,.12)',
                }}
              >
                {p.icon}
              </Box>
              <Typography fontWeight={600}>{p.text}</Typography>
            </Stack>
          ))}
        </Stack>
        <Card
          sx={{
            mt: 12,
            p: 5,
            maxWidth: 340,
            borderRadius: '18px',
            bgcolor: 'rgba(255,255,255,.06)',
            border: '1px solid rgba(255,255,255,.12)',
            backdropFilter: 'blur(12px)',
            color: '#fff',
            animation: 'eldFloat 6s ease-in-out infinite',
            '@keyframes eldFloat': {
              '0%,100%': { transform: 'translateY(0)' },
              '50%': { transform: 'translateY(-8px)' },
            },
          }}
        >
          <Stack direction="row" spacing={3} alignItems="center">
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: '12px',
                display: 'grid',
                placeItems: 'center',
                backgroundImage: brand.gradient,
              }}
            >
              <CheckCircle2 size={22} />
            </Box>
            <Box>
              <Typography fontSize={26} fontWeight={800} lineHeight={1.1} dir="ltr">
                {t('authPanel.statValue')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'rgba(226,232,255,.72)' }}>
                {t('authPanel.statLabel')}
              </Typography>
            </Box>
          </Stack>
        </Card>
      </Box>
      <Typography variant="caption" sx={{ position: 'relative', color: 'rgba(226,232,255,.5)' }}>
        © {new Date().getFullYear()} {t('common:appName')}
      </Typography>
    </Box>
  );
}

/** Split screen: brand panel + the form, with language and theme toggles on the page (16 §6). */
export function AuthLayout() {
  const { t } = useTranslation('site');
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.05fr 1fr' },
        bgcolor: 'background.default',
      }}
    >
      <BrandPanel />
      <Box
        sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative' }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          sx={{ px: { xs: 4, md: 10 }, py: 5 }}
        >
          <Box sx={{ display: { md: 'none' } }}>
            <Logo to="/" size={34} />
          </Box>
          <Button
            component={RouterLink}
            to="/"
            color="inherit"
            size="small"
            sx={{ display: { xs: 'none', md: 'inline-flex' }, color: 'text.secondary' }}
            startIcon={
              <Box sx={{ transform: 'scaleX(-1)', display: 'flex' }}>
                <ForwardArrow size={16} />
              </Box>
            }
          >
            {t('authPanel.back')}
          </Button>
          <Stack direction="row" spacing={1} alignItems="center">
            <ThemeToggle />
            <LanguageToggle />
          </Stack>
        </Stack>
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            px: { xs: 4, sm: 8 },
            pb: 10,
          }}
        >
          <Box component="main" id="main" sx={{ width: '100%', maxWidth: 440 }}>
            <ErrorBoundary name="auth">
              <Outlet />
            </ErrorBoundary>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
