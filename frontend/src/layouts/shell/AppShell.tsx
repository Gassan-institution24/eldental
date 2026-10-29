import {
  AppBar,
  Box,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Menu as MenuIcon, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { OfflineNotice } from '@/shared/components/States';
import { useOnline } from '@/shared/hooks/useOnline';
import { useUiStore } from '@/stores/uiStore';

export type NavItem = { key: string; to: string; label: string; icon: ReactNode; end?: boolean };
export type NavGroup = { key: string; label: string; items: NavItem[] };

const WIDTH = 264;
const COLLAPSED = 72;

type Props = {
  nav: NavGroup[];
  brand: ReactNode;
  topbar: ReactNode;
  banner?: ReactNode;
  children?: ReactNode;
};

function NavList({ nav, collapsed, onNavigate }: { nav: NavGroup[]; collapsed: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  return (
    <Box component="nav" sx={{ overflowY: 'auto', flex: 1, py: 2 }}>
      {nav
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <List
            key={g.key}
            dense
            subheader={
              collapsed ? (
                <Divider sx={{ my: 2 }} />
              ) : (
                <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>
                  {g.label}
                </ListSubheader>
              )
            }
          >
            {g.items.map((item) => {
              const active = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
              const button = (
                <ListItemButton
                  key={item.key}
                  component={NavLink}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  selected={active}
                  aria-current={active ? 'page' : undefined}
                  sx={(theme) => ({
                    mx: 2,
                    borderRadius: '8px',
                    minHeight: 44,
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    '&.Mui-selected': { bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' },
                    '&.Mui-selected .MuiListItemIcon-root': { color: 'primary.main' },
                  })}
                >
                  <ListItemIcon sx={{ minWidth: collapsed ? 0 : 36, justifyContent: 'center' }}>{item.icon}</ListItemIcon>
                  {!collapsed && <ListItemText primary={item.label} primaryTypographyProps={{ fontWeight: active ? 600 : 500, noWrap: true }} />}
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
        ))}
    </Box>
  );
}

/** Shared chrome for the clinic and admin apps: collapsible side nav + top bar (16 §3). */
export function AppShell({ nav, brand, topbar, banner, children }: Props) {
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar sx={{ gap: 2, px: collapsed ? 2 : 4, justifyContent: collapsed ? 'center' : 'space-between' }}>
        {!collapsed && brand}
        {!mobile && (
          <Tooltip title={collapsed ? t('layout.expandMenu') : t('layout.collapseMenu')}>
            <IconButton onClick={toggleNav} aria-label={collapsed ? t('layout.expandMenu') : t('layout.collapseMenu')} size="small">
              {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            </IconButton>
          </Tooltip>
        )}
      </Toolbar>
      <Divider />
      <NavList nav={nav} collapsed={collapsed} onNavigate={mobile ? () => setMobileOpen(false) : undefined} />
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box
        component="a"
        href="#main"
        sx={{ position: 'absolute', insetInlineStart: -9999, '&:focus': { insetInlineStart: 16, top: 16, zIndex: 2000, bgcolor: 'background.paper', p: 2 } }}
      >
        {t('layout.skipToContent')}
      </Box>
      {mobile ? (
        <Drawer anchor={anchor} open={mobileOpen} onClose={() => setMobileOpen(false)} ModalProps={{ keepMounted: true }} PaperProps={{ sx: { width: WIDTH } }}>
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer
          variant="permanent"
          anchor={anchor}
          PaperProps={{ sx: { width, transition: theme.transitions.create('width'), overflowX: 'hidden', bgcolor: 'background.paper' } }}
          sx={{ width, flexShrink: 0, transition: theme.transitions.create('width') }}
        >
          {drawerContent}
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Toolbar sx={{ gap: 2, px: { xs: 2, md: 6 } }}>
            {mobile && (
              <IconButton onClick={() => setMobileOpen(true)} aria-label={t('layout.openMenu')} edge="start">
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
        <Box component="main" id="main" tabIndex={-1} sx={{ flex: 1, p: { xs: 4, md: 6 }, outline: 'none', maxWidth: '100%' }}>
          <ErrorBoundary key={location.pathname} name="page">
            {children ?? <Outlet />}
          </ErrorBoundary>
        </Box>
      </Box>
    </Box>
  );
}

export function Brand({ subtitle }: { subtitle?: string }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
      <Box
        aria-hidden
        sx={(theme) => ({ width: 32, height: 32, borderRadius: '8px', bgcolor: 'primary.main', color: theme.palette.primary.contrastText, display: 'grid', placeItems: 'center', fontWeight: 800 })}
      >
        E
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography fontWeight={800} lineHeight={1.1} noWrap>
          {t('appName')}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" noWrap display="block" dir="auto">
            {subtitle}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
