import {
  AppBar,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  Grid,
  IconButton,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
  useScrollTrigger,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Mail, MapPin, Menu as MenuIcon, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Logo } from '@/shared/components/Brand';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { LanguageToggle, ThemeToggle } from './shell/ShellControls';

const LINKS = [
  { key: 'features', to: '/features' },
  { key: 'patients', to: '/patients' },
  { key: 'pricing', to: '/pricing' },
  { key: 'security', to: '/security' },
  { key: 'about', to: '/about' },
  { key: 'contact', to: '/contact' },
] as const;

function NavBar() {
  const { t } = useTranslation('site');
  const scrolled = useScrollTrigger({ disableHysteresis: true, threshold: 12 });
  const [open, setOpen] = useState(false);
  const signedIn = Boolean(useAuthStore((s) => s.accessToken));
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={(theme) => ({
        bgcolor: scrolled ? alpha(theme.palette.background.default, 0.78) : 'transparent',
        backdropFilter: scrolled ? 'saturate(180%) blur(16px)' : 'none',
        borderBottom: 1,
        borderColor: scrolled ? 'divider' : 'transparent',
        transition: 'all .25s ease',
      })}
    >
      <Container maxWidth="lg">
        <Toolbar disableGutters sx={{ minHeight: { xs: 64, md: 76 }, gap: 2 }}>
          <Logo to="/" size={36} />
          <Stack
            direction="row"
            spacing={1}
            sx={{ mx: 'auto', display: { xs: 'none', md: 'flex' } }}
            component="nav"
            aria-label={t('nav.menu')}
          >
            {LINKS.map((l) => (
              <Button
                key={l.key}
                component={NavLink}
                to={l.to}
                color="inherit"
                sx={{
                  fontWeight: 600,
                  color: 'text.secondary',
                  '&.active, &:hover': { color: 'text.primary', bgcolor: 'action.hover' },
                }}
              >
                {l.key === 'patients' ? t('patient:site.nav') : t(`nav.${l.key}`)}
              </Button>
            ))}
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ marginInlineStart: { xs: 'auto', md: 0 } }}
          >
            <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 1, alignItems: 'center' }}>
              <ThemeToggle />
              <LanguageToggle />
            </Box>
            {signedIn ? (
              <Button
                component={RouterLink}
                to="/app"
                variant="contained"
                sx={{ display: { xs: 'none', md: 'inline-flex' } }}
              >
                {t('nav.goToApp')}
              </Button>
            ) : (
              <>
                <Button
                  component={RouterLink}
                  to="/login"
                  color="inherit"
                  sx={{ display: { xs: 'none', md: 'inline-flex' }, fontWeight: 650 }}
                >
                  {t('nav.signIn')}
                </Button>
                <Button
                  component={RouterLink}
                  to="/contact"
                  variant="contained"
                  sx={{ display: { xs: 'none', md: 'inline-flex' } }}
                >
                  {t('nav.bookDemo')}
                </Button>
              </>
            )}
            <IconButton
              sx={{ display: { md: 'none' } }}
              onClick={() => setOpen(true)}
              aria-label={t('nav.menu')}
            >
              <MenuIcon size={22} />
            </IconButton>
          </Stack>
        </Toolbar>
      </Container>
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        PaperProps={{ sx: { width: 300, p: 4 } }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 4 }}>
          <Logo size={32} />
          <IconButton onClick={() => setOpen(false)} aria-label={t('common:actions.close')}>
            <X size={20} />
          </IconButton>
        </Stack>
        <List>
          {LINKS.map((l) => (
            <ListItemButton key={l.key} component={NavLink} to={l.to} sx={{ borderRadius: 2 }}>
              <ListItemText
                primary={l.key === 'patients' ? t('patient:site.nav') : t(`nav.${l.key}`)}
                primaryTypographyProps={{ fontWeight: 600 }}
              />
            </ListItemButton>
          ))}
        </List>
        <Divider sx={{ my: 3 }} />
        <Stack spacing={2}>
          <Button
            component={RouterLink}
            to={signedIn ? '/app' : '/login'}
            variant="outlined"
            fullWidth
          >
            {signedIn ? t('nav.goToApp') : t('nav.signIn')}
          </Button>
          <Button component={RouterLink} to="/contact" variant="contained" fullWidth>
            {t('nav.bookDemo')}
          </Button>
          <Stack direction="row" spacing={1} justifyContent="center">
            <ThemeToggle />
            <LanguageToggle />
          </Stack>
        </Stack>
      </Drawer>
    </AppBar>
  );
}

function Footer() {
  const { t } = useTranslation('site');
  const cols = [
    {
      title: t('footer.product'),
      links: [
        ['/features', t('nav.features')],
        ['/pricing', t('nav.pricing')],
        ['/security', t('nav.security')],
        ['/patients', t('patient:site.nav')],
        ['/portal/login', t('patient:site.signIn')],
        ['/login', t('nav.signIn')],
      ],
    },
    {
      title: t('footer.company'),
      links: [
        ['/about', t('nav.about')],
        ['/contact', t('nav.contact')],
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        ['/privacy', t('meta.privacy')],
        ['/terms', t('meta.terms')],
      ],
    },
  ];
  return (
    <Box
      component="footer"
      sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', mt: 'auto' }}
    >
      <Container maxWidth="lg" sx={{ py: { xs: 12, md: 16 } }}>
        <Grid container spacing={8}>
          <Grid item xs={12} md={4}>
            <Logo to="/" size={38} />
            <Typography color="text.secondary" sx={{ mt: 4, maxWidth: 320 }}>
              {t('footer.tagline')}
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 4, color: 'text.secondary' }}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Mail size={16} />
                <Typography variant="body2" dir="ltr">
                  hello@eldental.app
                </Typography>
              </Stack>
              <Stack direction="row" spacing={2} alignItems="center">
                <MapPin size={16} />
                <Typography variant="body2">{t('contact.address')}</Typography>
              </Stack>
            </Stack>
          </Grid>
          {cols.map((c) => (
            <Grid item xs={6} sm={4} md={2.66} key={c.title}>
              <Typography variant="overline" color="text.primary">
                {c.title}
              </Typography>
              <Stack spacing={2} sx={{ mt: 3 }}>
                {c.links.map(([to, label]) => (
                  <Link
                    key={to}
                    component={RouterLink}
                    to={to!}
                    color="text.secondary"
                    underline="hover"
                    variant="body2"
                  >
                    {label}
                  </Link>
                ))}
              </Stack>
            </Grid>
          ))}
        </Grid>
        <Divider sx={{ my: 10 }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
          <Typography variant="body2" color="text.secondary">
            © {new Date().getFullYear()} {t('common:appName')}. {t('footer.rights')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('footer.madeIn')}
          </Typography>
        </Stack>
      </Container>
    </Box>
  );
}

/** Marketing site shell: transparent → frosted navbar on scroll, footer, scroll-to-top on navigate. */
export function PublicLayout() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname]);
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <NavBar />
      <Box component="main" id="main" sx={{ flex: 1 }}>
        <ErrorBoundary key={location.pathname} name="site">
          <Outlet />
        </ErrorBoundary>
      </Box>
      <Footer />
    </Box>
  );
}
