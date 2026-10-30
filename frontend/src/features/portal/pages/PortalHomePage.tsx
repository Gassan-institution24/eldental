import { Box, Button, Card, Grid, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Lightbulb,
  Link2,
  ReceiptText,
  User,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useSessionData } from '@/features/auth/api/session';
import { inClinicTz } from '@/lib/dates';
import { patientGradient } from '@/theme/tokens';
import { patientCta } from './PatientAuthPages';

const TILES: { key: string; to: string; icon: ReactNode; color: string }[] = [
  { key: 'book', to: '/portal/book', icon: <CalendarPlus size={22} />, color: '#06B6D4' },
  {
    key: 'appointments',
    to: '/portal/appointments',
    icon: <CalendarCheck size={22} />,
    color: '#4F46E5',
  },
  { key: 'plans', to: '/portal/plans', icon: <ClipboardList size={22} />, color: '#7C3AED' },
  { key: 'invoices', to: '/portal/invoices', icon: <ReceiptText size={22} />, color: '#10B981' },
  { key: 'family', to: '/portal/family', icon: <Users size={22} />, color: '#F59E0B' },
  { key: 'profile', to: '/portal/profile', icon: <User size={22} />, color: '#0EA5E9' },
];

/** Patient home: greeting, next appointment, quick tiles, link-your-file and a care tip. */
export function PortalHomePage() {
  const { t } = useTranslation('patient');
  const session = useSessionData();
  const hour = inClinicTz(new Date()).hour();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = (session?.user.displayName ?? '').split(' ')[0] ?? '';

  return (
    <Stack spacing={6}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '24px',
          p: 6,
          color: '#fff',
          background: patientGradient,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 220,
            height: 220,
            borderRadius: '50%',
            top: -110,
            insetInlineEnd: -60,
            bgcolor: 'rgba(255,255,255,.15)',
          }}
        />
        <Typography
          variant="h3"
          component="h1"
          sx={{ color: '#fff', position: 'relative' }}
          dir="auto"
        >
          {t(`home.${part}`, { name: firstName })}
        </Typography>
        <Typography sx={{ mt: 1, color: 'rgba(255,255,255,.85)', position: 'relative' }}>
          {t('home.subtitle')}
        </Typography>
      </Box>

      <Card sx={{ p: 5 }}>
        <Typography variant="overline" color="text.secondary">
          {t('home.next')}
        </Typography>
        <Stack alignItems="center" textAlign="center" spacing={2} sx={{ py: 6 }}>
          <Box
            sx={(theme) => ({
              width: 64,
              height: 64,
              borderRadius: '20px',
              display: 'grid',
              placeItems: 'center',
              color: '#0891B2',
              bgcolor: alpha('#06B6D4', theme.palette.mode === 'dark' ? 0.18 : 0.1),
            })}
          >
            <CalendarCheck size={30} />
          </Box>
          <Typography variant="h5">{t('home.noUpcoming')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('home.noUpcomingHint')}
          </Typography>
          <Button
            component={RouterLink}
            to="/portal/book"
            variant="contained"
            size="large"
            sx={{ ...patientCta, mt: 3 }}
            startIcon={<CalendarPlus size={18} />}
          >
            {t('home.book')}
          </Button>
        </Stack>
      </Card>

      <Box>
        <Typography variant="h5" sx={{ mb: 3 }}>
          {t('home.quick')}
        </Typography>
        <Grid container spacing={3}>
          {TILES.map((tile) => (
            <Grid item xs={6} sm={4} key={tile.key}>
              <Card
                component={RouterLink}
                to={tile.to}
                sx={(theme) => ({
                  p: 4,
                  minHeight: 120,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'transform .2s ease, box-shadow .2s ease',
                  '&:hover, &:focus-visible': {
                    transform: 'translateY(-3px)',
                    boxShadow: theme.brand.elevated,
                  },
                })}
              >
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: '14px',
                    display: 'grid',
                    placeItems: 'center',
                    color: tile.color,
                    bgcolor: alpha(tile.color, 0.12),
                  }}
                >
                  {tile.icon}
                </Box>
                <Typography fontWeight={700} sx={{ mt: 3 }}>
                  {t(`home.tiles.${tile.key}`)}
                </Typography>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>

      <Card
        sx={(theme) => ({
          p: 5,
          borderColor: alpha('#06B6D4', 0.4),
          bgcolor: alpha('#06B6D4', theme.palette.mode === 'dark' ? 0.08 : 0.04),
        })}
      >
        <Stack direction="row" spacing={4} alignItems="flex-start">
          <Box sx={{ color: '#0891B2', mt: 0.5 }}>
            <Link2 size={24} />
          </Box>
          <Box>
            <Typography variant="h5">{t('home.linkTitle')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {t('home.linkBody')}
            </Typography>
            <Button component={RouterLink} to="/portal/family" variant="outlined" sx={{ mt: 4 }}>
              {t('home.linkCta')}
            </Button>
          </Box>
        </Stack>
      </Card>

      <Card sx={{ p: 5 }}>
        <Stack direction="row" spacing={4} alignItems="flex-start">
          <Box sx={{ color: 'warning.main', mt: 0.5 }}>
            <Lightbulb size={24} />
          </Box>
          <Box>
            <Typography variant="h6">{t('home.tipTitle')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('home.tip')}
            </Typography>
          </Box>
        </Stack>
      </Card>
    </Stack>
  );
}
