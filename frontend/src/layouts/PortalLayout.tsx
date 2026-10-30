import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Container,
  Paper,
  Stack,
  Toolbar,
} from '@mui/material';
import {
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Home,
  ReceiptText,
  User,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useLogout } from '@/features/auth/api/authApi';
import { useSessionData } from '@/features/auth/api/session';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { OfflineNotice } from '@/shared/components/States';
import { useOnline } from '@/shared/hooks/useOnline';
import { Logo } from '@/shared/components/Brand';
import { LanguageToggle, ThemeToggle, UserMenu } from './shell/ShellControls';

const TABS = [
  { key: 'home', to: '/portal', icon: <Home size={22} /> },
  { key: 'book', to: '/portal/book', icon: <CalendarPlus size={22} /> },
  { key: 'appointments', to: '/portal/appointments', icon: <CalendarCheck size={22} /> },
  { key: 'plans', to: '/portal/plans', icon: <ClipboardList size={22} /> },
  { key: 'invoices', to: '/portal/invoices', icon: <ReceiptText size={22} /> },
];

/** Mobile-first patient portal with large tap targets and a bottom tab bar (10 §8). */
export function PortalLayout() {
  const { t } = useTranslation('nav');
  const session = useSessionData();
  const logout = useLogout();
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const current =
    [...TABS]
      .reverse()
      .find((tab) =>
        tab.to === '/portal'
          ? location.pathname === '/portal'
          : location.pathname.startsWith(tab.to),
      )?.to ?? false;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 20 }}>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <Logo to="/portal" subtitle={t('groups.portal')} />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ marginInlineStart: 'auto' }}>
            <LanguageToggle />
            <ThemeToggle />
            <UserMenu
              name={session?.user.displayName ?? ''}
              onLogout={() => void logout()}
              onProfile={() => navigate('/portal/profile')}
              onSwitchClinic={() => navigate('/portal/family')}
            />
          </Stack>
        </Toolbar>
        {!online && <OfflineNotice />}
      </AppBar>
      <Container maxWidth="sm" component="main" id="main" sx={{ py: 6 }}>
        <ErrorBoundary key={location.pathname} name="portal">
          <Outlet />
        </ErrorBoundary>
      </Container>
      <Paper
        sx={{
          position: 'fixed',
          bottom: 0,
          insetInline: 0,
          borderTop: 1,
          borderColor: 'divider',
          zIndex: 10,
        }}
        elevation={0}
      >
        <BottomNavigation
          showLabels
          value={current}
          onChange={(_e, v: string) => navigate(v)}
          sx={{ height: 68 }}
        >
          {TABS.map((tab) => (
            <BottomNavigationAction
              key={tab.key}
              value={tab.to}
              label={t(`portal.${tab.key}`)}
              icon={tab.icon}
              sx={{ minWidth: 0 }}
            />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}

export const PORTAL_EXTRA = [
  { key: 'family', to: '/portal/family', icon: <Users size={20} /> },
  { key: 'profile', to: '/portal/profile', icon: <User size={20} /> },
];
