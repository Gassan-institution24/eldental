import {
  AppBar,
  Box,
  Collapse,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { ChevronsLeft, ChevronsRight, Menu as MenuIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Logo, LogoMark } from '@/shared/components/Brand';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { OfflineNotice } from '@/shared/components/States';
import { useOnline } from '@/shared/hooks/useOnline';
import { useUiStore } from '@/stores/uiStore';
import { brand } from '@/theme/tokens';

export type NavItem = { key: string; to: string; label: string; icon: ReactNode; end?: boolean };
export type NavGroup = { key: string; label: string; items: NavItem[] };

const WIDTH = 272;
const COLLAPSED = 80;

type Props = {
  nav: NavGroup[];
  brand: ReactNode;
  topbar: ReactNode;
  banner?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
};

function NavList({
  nav,
  collapsed,
  onNavigate,
}: {
  nav: NavGroup[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const location = useLocation();
  return (
    <Box
      component="nav"
      sx={{
        overflowY: 'auto',
        flex: 1,
        py: 3,
        px: collapsed ? 2 : 3,
        '&::-webkit-scrollbar-thumb': { background: 'rgba(255,255,255,.12)' },
      }}
    >
      {nav
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <Box key={g.key} sx={{ mb: 4 }}>
            {collapsed ? (
              <Box sx={{ height: 1, bgcolor: 'rgba(255,255,255,.08)', mx: 2, mb: 2 }} />
            ) : (
              <Typography
                sx={{
                  px: 3,
                  mb: 1.5,
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: 'rgba(226,232,255,.45)',
                }}
              >
                {g.label}
              </Typography>
            )}
            <List dense disablePadding>
              {g.items.map((item) => {
                const active = item.end
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to);
                const button = (
                  <ListItemButton
                    key={item.key}
                    component={NavLink}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    sx={{
                      position: 'relative',
                      mb: 0.5,
                      borderRadius: '12px',
                      minHeight: 44,
                      px: collapsed ? 0 : 3,
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      color: active ? '#fff' : 'rgba(226,232,255,.72)',
                      background: active
                        ? 'linear-gradient(135deg, rgba(79,70,229,.95), rgba(124,58,237,.85))'
                        : 'transparent',
                      boxShadow: active ? `0 10px 24px -12px ${alpha(brand.violet, 0.9)}` : 'none',
                      transition: 'background .18s ease, color .18s ease',
                      '&:hover': {
                        background: active ? undefined : 'rgba(255,255,255,.06)',
                        color: '#fff',
                      },
                    }}
                  >
                    <ListItemIcon
                      sx={{
                        minWidth: collapsed ? 0 : 38,
                        color: 'inherit',
                        justifyContent: 'center',
                      }}
                    >
                      {item.icon}
                    </ListItemIcon>
                    {!collapsed && (
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                          fontWeight: active ? 650 : 500,
                          fontSize: 14,
                          noWrap: true,
                        }}
                      />
                    )}
                  </ListItemButton>
                );
                return collapsed ? (
                  <Tooltip key={item.key} title={item.label} placement="right">
                    {button}
                  </Tooltip>
                ) : (
                  button
                );
              })}
            </List>
          </Box>
        ))}
    </Box>
  );
}

/** Shared chrome for the clinic and admin apps: dark gradient side nav + frosted top bar (16 §3). */
export function AppShell({ nav, brand: brandSlot, topbar, banner, footer, children }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const collapsed = useUiStore((s) => s.navCollapsed) && !mobile;
  const toggleNav = useUiStore((s) => s.toggleNav);
  const [mobileOpen, setMobileOpen] = useState(false);
  const online = useOnline();
  const location = useLocation();
  const width = collapsed ? COLLAPSED : WIDTH;
  // MUI flips the anchor itself in RTL, so 'left' means "start".
  const anchor = 'left';

  const drawerContent = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: brand.sidebar,
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: 260,
          height: 260,
          borderRadius: '50%',
          top: -120,
          insetInlineStart: -80,
          background: brand.violet,
          opacity: 0.35,
          filter: 'blur(90px)',
        }}
      />
      <Toolbar
        sx={{
          gap: 2,
          px: collapsed ? 0 : 5,
          justifyContent: collapsed ? 'center' : 'flex-start',
          minHeight: 72,
          position: 'relative',
        }}
      >
        {collapsed ? <LogoMark size={38} /> : brandSlot}
      </Toolbar>
      <NavList
        nav={nav}
        collapsed={collapsed}
        onNavigate={mobile ? () => setMobileOpen(false) : undefined}
      />
      {footer && !collapsed && <Box sx={{ p: 3, position: 'relative' }}>{footer}</Box>}
      {!mobile && (
        <Box
          sx={{
            p: 3,
            display: 'flex',
            justifyContent: collapsed ? 'center' : 'flex-end',
            borderTop: '1px solid rgba(255,255,255,.06)',
          }}
        >
          <Tooltip title={collapsed ? t('layout.expandMenu') : t('layout.collapseMenu')}>
            <IconButton
              onClick={toggleNav}
              aria-label={collapsed ? t('layout.expandMenu') : t('layout.collapseMenu')}
              size="small"
              sx={{
                color: 'rgba(226,232,255,.7)',
                '&:hover': { color: '#fff', bgcolor: 'rgba(255,255,255,.06)' },
              }}
            >
              {(collapsed ? theme.direction === 'ltr' : theme.direction === 'rtl') ? (
                <ChevronsRight size={18} />
              ) : (
                <ChevronsLeft size={18} />
              )}
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{
          position: 'absolute',
          insetInlineStart: -9999,
          '&:focus': {
            insetInlineStart: 16,
            top: 16,
            zIndex: 2000,
            bgcolor: 'background.paper',
            p: 2,
          },
        }}
      >
        {t('layout.skipToContent')}
      </Box>
      {mobile ? (
        <Drawer
          anchor={anchor}
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{ sx: { width: WIDTH, border: 0 } }}
        >
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          anchor={anchor}
          PaperProps={{
            sx: {
              width,
              transition: theme.transitions.create('width'),
              overflowX: 'hidden',
              border: 0,
            },
          }}
          sx={{ width, flexShrink: 0, transition: theme.transitions.create('width') }}
        >
          {drawerContent}
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="sticky"
          color="inherit"
          elevation={0}
          sx={{
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.default, 0.72),
            backdropFilter: 'saturate(180%) blur(14px)',
          }}
        >
          <Toolbar sx={{ gap: 2, px: { xs: 3, md: 8 }, minHeight: 72 }}>
            {mobile && (
              <IconButton
                onClick={() => setMobileOpen(true)}
                aria-label={t('layout.openMenu')}
                edge="start"
              >
                <MenuIcon size={22} />
              </IconButton>
            )}
            {topbar}
          </Toolbar>
          <Collapse in={!online}>
            <OfflineNotice />
          </Collapse>
          {banner}
        </AppBar>
        <Box
          component="main"
          id="main"
          tabIndex={-1}
          sx={{
            flex: 1,
            p: { xs: 4, md: 8 },
            outline: 'none',
            maxWidth: 1600,
            width: '100%',
            mx: 'auto',
          }}
        >
          <ErrorBoundary key={location.pathname} name="page">
            {children ?? <Outlet />}
          </ErrorBoundary>
        </Box>
      </Box>
    </Box>
  );
}

/** Logo for the dark sidebar (word mark hidden when collapsed is handled by the caller). */
export function Brand({ subtitle }: { subtitle?: string }) {
  return <Logo subtitle={subtitle} size={38} light />;
}
