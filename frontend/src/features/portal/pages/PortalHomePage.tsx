import { Box, Button, Card, Grid, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CalendarCheck,
  CalendarPlus,
  ClipboardList,
  Clock,
  Lightbulb,
  MapPin,
  ReceiptText,
  User,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useSessionData } from '@/features/auth/api/session';
import { formatDate, formatTime, inClinicTz } from '@/lib/dates';
import { MoneyText } from '@/shared/components/MoneyText';
import { patientGradient } from '@/theme/tokens';
import { usePortalAppointments, usePortalBilling, usePortalMe, usePortalPlans } from '../api';
import { DateBlock, LinkFilePrompt, useSeedLabel } from '../components';
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

function NextAppointment() {
  const { t, i18n } = useTranslation('patient');
  const lang = i18n.language;
  const q = usePortalAppointments();
  const label = useSeedLabel('appointmentType');
  const next = (q.data ?? [])
    .filter((a) => a.upcoming)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  return (
    <Card sx={{ p: { xs: 5, md: 6 }, height: '100%' }}>
      <Typography variant="overline" color="text.secondary">
        {t('home.next')}
      </Typography>
      {q.isLoading ? (
        <Skeleton variant="rounded" height={110} sx={{ mt: 2 }} />
      ) : next ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={4}
          sx={{ mt: 2 }}
          alignItems={{ sm: 'center' }}
        >
          <DateBlock value={next.start} lang={lang} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h5">
              {label(next.appointmentType) || t('portal.appointments.visit')}
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 1, color: 'text.secondary' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Clock size={14} />
                <Typography variant="body2">
                  {formatDate(next.start, lang, 'dddd')} ·{' '}
                  <span dir="ltr">{formatTime(next.start, lang)}</span> ·{' '}
                  <span dir="auto">{next.dentist.name}</span>
                </Typography>
              </Stack>
              {next.clinic && (
                <Stack direction="row" spacing={1} alignItems="center">
                  <MapPin size={14} />
                  <Typography variant="body2" dir="auto">
                    {next.clinic.name}
                  </Typography>
                </Stack>
              )}
            </Stack>
          </Box>
          <Button component={RouterLink} to="/portal/appointments" variant="outlined">
            {t('portal.home.manage')}
          </Button>
        </Stack>
      ) : (
        <Stack alignItems="center" textAlign="center" spacing={2} sx={{ py: 4 }}>
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
            sx={{ ...patientCta, mt: 2 }}
            startIcon={<CalendarPlus size={18} />}
          >
            {t('home.book')}
          </Button>
        </Stack>
      )}
    </Card>
  );
}

function Glance() {
  const { t } = useTranslation('patient');
  const plans = usePortalPlans();
  const billing = usePortalBilling();
  const waiting = (plans.data ?? []).filter((p) => p.canAccept).length;
  const due = (billing.data?.balances ?? []).reduce((s, b) => s + Math.max(0, b.balance), 0);
  return (
    <Stack spacing={4} sx={{ height: '100%' }}>
      <Card
        component={RouterLink}
        to="/portal/plans"
        sx={{ p: 5, flex: 1, textDecoration: 'none', color: 'inherit' }}
      >
        <Typography variant="overline" color="text.secondary">
          {t('portal.home.plansWaiting')}
        </Typography>
        <Typography variant="h3" component="div" color={waiting ? 'warning.main' : 'text.primary'}>
          {plans.isLoading ? <Skeleton width={40} /> : waiting}
        </Typography>
      </Card>
      <Card
        component={RouterLink}
        to="/portal/invoices"
        sx={{ p: 5, flex: 1, textDecoration: 'none', color: 'inherit' }}
      >
        <Typography variant="overline" color="text.secondary">
          {t('portal.billing.owes')}
        </Typography>
        <Box>
          {billing.isLoading ? (
            <Skeleton width={100} />
          ) : (
            <MoneyText
              value={due}
              sx={{ fontSize: 28, fontWeight: 800, color: due > 0 ? 'error.main' : 'success.main' }}
            />
          )}
        </Box>
      </Card>
    </Stack>
  );
}

/** Patient home: greeting, next appointment, what needs attention, quick tiles and a care tip. */
export function PortalHomePage() {
  const { t } = useTranslation('patient');
  const session = useSessionData();
  const me = usePortalMe();
  const hour = inClinicTz(new Date()).hour();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const firstName = (session?.user.displayName ?? '').split(' ')[0] ?? '';
  const hasFiles = Boolean(me.data?.patients.length);

  return (
    <Stack spacing={6}>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '24px',
          p: { xs: 6, md: 8 },
          color: '#fff',
          background: patientGradient,
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
            insetInlineEnd: -60,
            bgcolor: 'rgba(255,255,255,.15)',
          }}
        />
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={4}
          justifyContent="space-between"
          alignItems={{ md: 'center' }}
          sx={{ position: 'relative' }}
        >
          <Box>
            <Typography variant="h3" component="h1" sx={{ color: '#fff' }} dir="auto">
              {t(`home.${part}`, { name: firstName })}
            </Typography>
            <Typography sx={{ mt: 1, color: 'rgba(255,255,255,.85)' }}>
              {t('home.subtitle')}
            </Typography>
          </Box>
          <Button
            component={RouterLink}
            to="/portal/book"
            variant="contained"
            size="large"
            startIcon={<CalendarPlus size={18} />}
            sx={{
              bgcolor: '#fff',
              color: '#0E7490',
              '&:hover': { bgcolor: 'rgba(255,255,255,.9)' },
            }}
          >
            {t('home.book')}
          </Button>
        </Stack>
      </Box>

      {!me.isLoading && !hasFiles && <LinkFilePrompt />}

      <Grid container spacing={4}>
        <Grid item xs={12} lg={hasFiles ? 8 : 12}>
          <NextAppointment />
        </Grid>
        {hasFiles && (
          <Grid item xs={12} lg={4}>
            <Glance />
          </Grid>
        )}
      </Grid>

      <Box>
        <Typography variant="h5" sx={{ mb: 3 }}>
          {t('home.quick')}
        </Typography>
        <Grid container spacing={3}>
          {TILES.map((tile) => (
            <Grid item xs={6} sm={4} lg={2} key={tile.key}>
              <Card
                component={RouterLink}
                to={tile.to}
                sx={(theme) => ({
                  p: 4,
                  minHeight: 120,
                  height: '100%',
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
