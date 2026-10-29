import { Box, Card, Container, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router-dom';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { Brand } from './shell/AppShell';
import { LanguageToggle, ThemeToggle } from './shell/ShellControls';

/** Centered card with the language toggle on the page itself (16 §6 — Login). */
export function AuthLayout() {
  const { t } = useTranslation();
  return (
    <Box
      sx={(theme) => ({
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: `radial-gradient(1200px 600px at 10% -10%, ${alpha(theme.palette.primary.main, 0.14)}, transparent), ${theme.palette.background.default}`,
      })}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: { xs: 4, md: 8 }, py: 4 }}>
        <Brand subtitle={t('tagline')} />
        <Stack direction="row" spacing={1} alignItems="center">
          <ThemeToggle />
          <LanguageToggle />
        </Stack>
      </Stack>
      <Container maxWidth="xs" sx={{ flex: 1, display: 'flex', alignItems: 'center', py: 6 }}>
        <Card component="main" id="main" sx={{ width: '100%', p: { xs: 6, sm: 8 } }}>
          <ErrorBoundary name="auth">
            <Outlet />
          </ErrorBoundary>
        </Card>
      </Container>
      <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ pb: 4 }}>
        © {new Date().getFullYear()} {t('appName')}
      </Typography>
    </Box>
  );
}
