import {
  AppBar,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Toolbar,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
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

const NAV = [
  { key: 'home', to: '/portal', icon: Home, mobile: true },
  { key: 'book', to: '/portal/book', icon: CalendarPlus, mobile: true },
  { key: 'appointments', to: '/portal/appointments', icon: CalendarCheck, mobile: true },
  { key: 'plans', to: '/portal/plans', icon: ClipboardList, mobile: true },
  { key: 'invoices', to: '/portal/invoices', icon: ReceiptText, mobile: true },
  { key: 'family', to: '/portal/family', icon: Users, mobile: false },
  { key: 'profile', to: '/portal/profile', icon: User, mobile: false },
] as const;

const SIDE = 264;
const TOOLBAR = 64;

/**
 * Patient portal shell (10 §8): full width. Tablets and desktops get a side menu; phones get a
 * bottom tab bar with large tap targets (family and profile live in the user menu there).
 */
export function PortalLayout() {
  const { t } = useTranslation('nav');
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const session = useSessionData();
  const logout = useLogout('/portal/login');
  const location = useLocation();
  const navigate = useNavigate();
  const online = useOnline();
  const isActive = (to: string) =>
    to === '/portal' ? location.pathname === '/portal' : location.pathname.startsWith(to);
  const current = NAV.find((n) => n.mobile && isActive(n.to))?.to ?? false;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: { xs: 22, md: 0 } }}>
      <AppBar
        position="sticky"
        color="inherit"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
      >
        <Toolbar sx={{ gap: 2, minHeight: TOOLBAR, px: { xs: 3, md: 6 } }}>
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

      <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
        {wide && (
          <Box
            component="nav"
            aria-label={t('groups.portal')}
            sx={{
              width: SIDE,
              flexShrink: 0,
              position: 'sticky',
              top: TOOLBAR,
              height: `calc(100vh - ${TOOLBAR}px)`,
              borderInlineEnd: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              overflowY: 'auto',
              p: 3,
            }}
          >
            <List disablePadding>
              {NAV.map(({ key, to, icon: Icon }) => {
                const active = isActive(to);
                return (
                  <ListItemButton
                    key={key}
                    selected={active}
                    onClick={() => navigate(to)}
                    aria-current={active ? 'page' : undefined}
                    sx={{
                      borderRadius: '12px',
                      mb: 1,
                      py: 1.5,
                      '&.Mui-selected': {
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                        color: 'primary.main',
                        '& .MuiListItemIcon-root': { color: 'primary.main' },
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 40 }}>
                      <Icon size={20} />
                    </ListItemIcon>
                    <ListItemText
                      primary={t(`portal.${key}`)}
                      primaryTypographyProps={{ fontWeight: active ? 700 : 500 }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )}
        <Box
          component="main"
          id="main"
          sx={{ flex: 1, minWidth: 0, width: '100%', px: { xs: 4, sm: 6, lg: 10 }, py: 6 }}
        >
          <ErrorBoundary key={location.pathname} name="portal">
            <Outlet />
          </ErrorBoundary>
        </Box>
      </Box>

      {!wide && (
        <Paper
          sx={{
            position: 'fixed',
            bottom: 0,
            insetInline: 0,
            borderTop: 1,
            borderColor: 'divider',
            zIndex: 10,
            pb: 'env(safe-area-inset-bottom)',
          }}
          elevation={0}
        >
          <BottomNavigation
            showLabels
            value={current}
            onChange={(_e, v: string) => navigate(v)}
            sx={{ height: 68 }}
          >
            {NAV.filter((n) => n.mobile).map(({ key, to, icon: Icon }) => (
              <BottomNavigationAction
                key={key}
                value={to}
                label={t(`portal.${key}`)}
                icon={<Icon size={22} />}
                sx={{
                  minWidth: 0,
                  px: 0.5,
                  '& .MuiBottomNavigationAction-label': { fontSize: 11 },
                }}
              />
            ))}
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
}
