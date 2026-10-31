import { Box, Button, Card, Grid, LinearProgress, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarPlus,
  CheckCircle2,
  Circle,
  CreditCard,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { useSessionData } from '@/features/auth/api/session';
import { AttendanceWidget } from '@/features/hr/pages/HrPages';
import { useQuickBook } from '@/features/scheduling/components/quickBookStore';
import { getPaged } from '@/lib/api/axios';
import { inClinicTz } from '@/lib/dates';
import { ForwardArrow } from '@/features/site/components/Sections';
import { usePermission } from '@/shared/rbac/usePermission';
import { brand } from '@/theme/tokens';

function Kpi({
  icon,
  label,
  value,
  loading,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  loading?: boolean;
}) {
  return (
    <Card sx={{ p: 5, height: '100%' }}>
      <Stack direction="row" spacing={3} alignItems="center">
        <Box
          sx={(theme) => ({
            width: 44,
            height: 44,
            borderRadius: '12px',
            display: 'grid',
            placeItems: 'center',
            color: 'primary.main',
            bgcolor: alpha(theme.palette.primary.main, 0.1),
          })}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography
            fontSize={26}
            fontWeight={800}
            lineHeight={1.2}
            dir="ltr"
            sx={{ textAlign: 'start' }}
          >
            {loading ? '—' : value}
          </Typography>
        </Box>
      </Stack>
    </Card>
  );
}

function QuickAction({
  icon,
  title,
  hint,
  onClick,
  to,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  onClick?: () => void;
  to?: string;
}) {
  const linkProps = to ? { component: RouterLink, to } : { onClick };
  return (
    <Card
      {...linkProps}
      sx={(theme) => ({
        p: 5,
        height: '100%',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        cursor: 'pointer',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'transform .2s ease, box-shadow .2s ease, border-color .2s ease',
        '&:hover': {
          transform: 'translateY(-3px)',
          boxShadow: theme.brand.elevated,
          borderColor: alpha(theme.palette.primary.main, 0.4),
        },
      })}
    >
      <Box
        sx={{
          width: 48,
          height: 48,
          borderRadius: '14px',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          backgroundImage: brand.gradient,
          flexShrink: 0,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography fontWeight={700}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      </Box>
      <Box sx={{ color: 'text.secondary' }}>
        <ForwardArrow size={18} />
      </Box>
    </Card>
  );
}

/** Clinic home: greeting, KPIs, quick actions and the setup checklist. */
export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const session = useSessionData();
  const { can } = usePermission();
  const openQuickBook = useQuickBook((s) => s.open);
  const staff = useQuery({
    queryKey: ['staff', 'count'],
    enabled: can('staff.member.read', 'all'),
    queryFn: () => getPaged<unknown>('/staff', { limit: 1, status: 'active' }),
  });

  const hour = inClinicTz(new Date()).hour();
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const name = session?.staff?.name ?? session?.user.displayName ?? '';
  const done = {
    profile: Boolean(session?.clinic?.onboardingCompleted),
    chairs: false,
    team: (staff.data?.meta.total ?? 0) > 1,
    procedures: false,
  };
  const steps = (['profile', 'chairs', 'team', 'procedures'] as const).map((k) => ({
    k,
    done: done[k],
  }));
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Box>
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: '24px',
          p: { xs: 6, md: 10 },
          mb: 8,
          color: '#fff',
          background: brand.sidebar,
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 380,
            height: 380,
            borderRadius: '50%',
            top: -160,
            insetInlineEnd: -80,
            background: brand.violet,
            opacity: 0.45,
            filter: 'blur(90px)',
          }}
        />
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            width: 300,
            height: 300,
            borderRadius: '50%',
            bottom: -170,
            insetInlineStart: '20%',
            background: brand.cyan,
            opacity: 0.3,
            filter: 'blur(90px)',
          }}
        />
        <Box sx={{ position: 'relative' }}>
          <Typography variant="h2" component="h1" sx={{ color: '#fff' }} dir="auto">
            {t(`greeting.${part}`, { name })}
          </Typography>
          <Typography sx={{ mt: 2, color: 'rgba(226,232,255,.75)' }} dir="auto">
            {t('subtitle', { clinic: session?.clinic?.name ?? '' })}
          </Typography>
          {can('scheduling.appointment.book') && (
            <Button
              variant="contained"
              size="large"
              sx={{ mt: 7 }}
              startIcon={<CalendarPlus size={18} />}
              onClick={() => openQuickBook({})}
            >
              {t('quick.book')}
            </Button>
          )}
        </Box>
      </Box>

      <Box sx={{ mb: 6 }}>
        <AttendanceWidget />
      </Box>
      <Grid container spacing={5} sx={{ mb: 8 }}>
        <Grid item xs={6} lg={3}>
          <Kpi icon={<CalendarPlus size={20} />} label={t('kpi.appointments')} value="0" />
        </Grid>
        <Grid item xs={6} lg={3}>
          <Kpi icon={<Users size={20} />} label={t('kpi.patients')} value="0" />
        </Grid>
        <Grid item xs={6} lg={3}>
          <Kpi
            icon={<CreditCard size={20} />}
            label={t('kpi.collected')}
            value={`0.000 ${session?.clinic?.currency ?? 'JOD'}`}
          />
        </Grid>
        <Grid item xs={6} lg={3}>
          <Kpi
            icon={<Users size={20} />}
            label={t('kpi.team')}
            value={String(staff.data?.meta.total ?? '—')}
            loading={staff.isLoading && staff.fetchStatus !== 'idle'}
          />
        </Grid>
      </Grid>

      <Grid container spacing={8}>
        <Grid item xs={12} lg={7}>
          <Typography variant="h4" sx={{ mb: 4 }}>
            {t('quick.title')}
          </Typography>
          <Grid container spacing={4}>
            {can('scheduling.appointment.book') && (
              <Grid item xs={12} sm={6}>
                <QuickAction
                  icon={<CalendarPlus size={22} />}
                  title={t('quick.book')}
                  hint={t('quick.bookHint')}
                  onClick={() => openQuickBook({})}
                />
              </Grid>
            )}
            {can('patients.patient.create') && (
              <Grid item xs={12} sm={6}>
                <QuickAction
                  icon={<UserPlus size={22} />}
                  title={t('quick.patient')}
                  hint={t('quick.patientHint')}
                  to="/clinic/patients/new"
                />
              </Grid>
            )}
            {can('billing.payment.create') && (
              <Grid item xs={12} sm={6}>
                <QuickAction
                  icon={<CreditCard size={22} />}
                  title={t('quick.payment')}
                  hint={t('quick.paymentHint')}
                  to="/clinic/billing/payments?new=1"
                />
              </Grid>
            )}
            {can('staff.member.read', 'all') && (
              <Grid item xs={12} sm={6}>
                <QuickAction
                  icon={<Settings2 size={22} />}
                  title={t('quick.team')}
                  hint={t('quick.teamHint')}
                  to="/clinic/hr/staff"
                />
              </Grid>
            )}
          </Grid>
        </Grid>
        {can('clinic.settings.update') && (
          <Grid item xs={12} lg={5}>
            <Card sx={{ p: 6 }}>
              <Typography variant="h4">{t('setup.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('setup.subtitle')}
              </Typography>
              <Stack direction="row" justifyContent="space-between" sx={{ mt: 5, mb: 2 }}>
                <Typography variant="caption" fontWeight={700}>
                  {t('setup.progress', { done: doneCount, total: steps.length })}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={(doneCount / steps.length) * 100}
                sx={{ height: 8, '& .MuiLinearProgress-bar': { backgroundImage: brand.gradient } }}
              />
              <Stack spacing={1} sx={{ mt: 5 }}>
                {steps.map((s) => (
                  <Stack key={s.k} direction="row" spacing={3} alignItems="center" sx={{ py: 2 }}>
                    <Box sx={{ color: s.done ? 'success.main' : 'text.disabled', display: 'flex' }}>
                      {s.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
                    </Box>
                    <Typography
                      sx={{
                        flex: 1,
                        textDecoration: s.done ? 'line-through' : 'none',
                        color: s.done ? 'text.secondary' : 'text.primary',
                      }}
                    >
                      {t(`setup.${s.k}`)}
                    </Typography>
                    {!s.done && (
                      <Button size="small" component={RouterLink} to="/clinic/settings">
                        {t('setup.go')}
                      </Button>
                    )}
                  </Stack>
                ))}
              </Stack>
            </Card>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
