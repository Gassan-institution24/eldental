import { Box, Card, Container, Stack, Typography } from '@mui/material';
import { Bell, CalendarHeart, FileText, HeartPulse, Smile } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { Logo } from '@/shared/components/Brand';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { patientGradient } from '@/theme/tokens';
import { LanguageToggle, ThemeToggle } from './shell/ShellControls';

function Bubble({ icon, sx }: { icon: React.ReactNode; sx: object }) {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        width: 54,
        height: 54,
        borderRadius: '18px',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        bgcolor: 'rgba(255,255,255,.16)',
        border: '1px solid rgba(255,255,255,.28)',
        backdropFilter: 'blur(8px)',
        animation: 'eldFloat 6s ease-in-out infinite',
        '@keyframes eldFloat': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        ...sx,
      }}
    >
      {icon}
    </Box>
  );
}

/** Patient sign-in / sign-up: friendly, mobile-first, with a soft cyan→mint hero (10 §8). */
export function PatientAuthLayout() {
  const { t } = useTranslation('patient');
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 10 }}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          background: patientGradient,
          color: '#fff',
          pt: 5,
          pb: { xs: 28, md: 32 },
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 420,
            height: 420,
            borderRadius: '50%',
            top: -200,
            insetInlineEnd: -120,
            bgcolor: 'rgba(255,255,255,.14)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 260,
            height: 260,
            borderRadius: '50%',
            bottom: -150,
            insetInlineStart: -60,
            bgcolor: 'rgba(255,255,255,.1)',
          }}
        />
        <Container maxWidth="md" sx={{ position: 'relative' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Logo to="/patients" subtitle={t('brand')} size={36} light />
            <Stack
              direction="row"
              spacing={1}
              sx={{
                '& .MuiIconButton-root, & .MuiButton-root': {
                  color: '#fff',
                  borderColor: 'rgba(255,255,255,.4)',
                },
              }}
            >
              <ThemeToggle />
              <LanguageToggle />
            </Stack>
          </Stack>
          <Box sx={{ textAlign: 'center', mt: { xs: 10, md: 12 }, position: 'relative' }}>
            <Box
              sx={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 64,
                height: 64,
                borderRadius: '20px',
                bgcolor: 'rgba(255,255,255,.18)',
                mb: 5,
              }}
            >
              <Smile size={34} />
            </Box>
            <Typography variant="h2" component="p" sx={{ color: '#fff' }}>
              {t('auth.heroTitle')}
            </Typography>
            <Typography
              sx={{
                mt: 3,
                color: 'rgba(255,255,255,.85)',
                fontSize: 17,
                maxWidth: 520,
                mx: 'auto',
              }}
            >
              {t('auth.heroSubtitle')}
            </Typography>
          </Box>
          <Bubble
            icon={<CalendarHeart size={24} />}
            sx={{ top: 120, insetInlineStart: 0, display: { xs: 'none', md: 'grid' } }}
          />
          <Bubble
            icon={<Bell size={22} />}
            sx={{
              top: 210,
              insetInlineEnd: 20,
              animationDelay: '1.2s',
              display: { xs: 'none', md: 'grid' },
            }}
          />
          <Bubble
            icon={<FileText size={22} />}
            sx={{
              top: 300,
              insetInlineStart: 70,
              animationDelay: '2.4s',
              display: { xs: 'none', md: 'grid' },
            }}
          />
          <Bubble
            icon={<HeartPulse size={22} />}
            sx={{
              top: 320,
              insetInlineEnd: 110,
              animationDelay: '3.2s',
              display: { xs: 'none', md: 'grid' },
            }}
          />
        </Container>
      </Box>
      <Container maxWidth="sm" sx={{ mt: { xs: -22, md: -24 }, position: 'relative' }}>
        <Card
          component="main"
          id="main"
          sx={(theme) => ({
            p: { xs: 6, sm: 10 },
            borderRadius: '24px',
            boxShadow: theme.brand.elevated,
          })}
        >
          <ErrorBoundary name="patient-auth">
            <Outlet />
          </ErrorBoundary>
        </Card>
      </Container>
    </Box>
  );
}
