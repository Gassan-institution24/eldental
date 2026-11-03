import { Box, Card, CardContent, Grid, Stack, Typography } from '@mui/material';
import { AlertTriangle, Building2, CreditCard, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { formatDate } from '@/lib/dates';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { format } from '@/shared/generated/money';
import { usePlatformStats } from '../api';

function Kpi({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ color: 'text.secondary', mb: 1 }}
        >
          {icon}
          <Typography variant="body2">{label}</Typography>
        </Stack>
        <Typography variant="h4" fontWeight={800}>
          {value}
        </Typography>
        {hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/** Platform dashboard (13 Phase 2): clinics, subscriptions, users, health, recurring revenue. */
export function AdminDashboardPage() {
  const { t, i18n } = useTranslation('admin');
  const q = usePlatformStats();
  if (q.isLoading) return <PageSkeleton rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const mrr = Object.entries(s.mrr);
  return (
    <Box>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} lg={3}>
          <Kpi
            icon={<Building2 size={18} />}
            label={t('dashboard.clinics')}
            value={s.clinics.total}
            hint={t('dashboard.newClinics', { count: s.clinics.newLast30d })}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Kpi
            icon={<CreditCard size={18} />}
            label={t('dashboard.mrr')}
            value={
              mrr.length ? mrr.map(([cur, v]) => format(v, cur, i18n.language)).join(' · ') : '—'
            }
            hint={t('dashboard.mrrHint')}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Kpi
            icon={<Users size={18} />}
            label={t('dashboard.activeUsers')}
            value={s.users.activeLast7d}
            hint={t('dashboard.usersByKind', {
              staff: s.users.byKind.staff ?? 0,
              patients: s.users.byKind.patient ?? 0,
            })}
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <Kpi
            icon={<AlertTriangle size={18} />}
            label={t('dashboard.health')}
            value={s.health.openSystemErrors}
            hint={t('dashboard.healthHint', { issues: s.health.newClientIssues })}
          />
        </Grid>
      </Grid>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <SectionCard title={t('dashboard.bySubscription')}>
            <Stack spacing={1.5}>
              {Object.entries(s.clinics.bySubscription).map(([k, n]) => (
                <Stack key={k} direction="row" justifyContent="space-between" alignItems="center">
                  <StatusChip
                    status={k}
                    label={t(`subscriptionStatus.${k}`, { defaultValue: k })}
                  />
                  <Typography fontWeight={700}>{n}</Typography>
                </Stack>
              ))}
              {Object.entries(s.clinics.byStatus).map(([k, n]) => (
                <Stack
                  key={`s-${k}`}
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Typography variant="body2" color="text.secondary">
                    {t(`clinicStatus.${k}`, { defaultValue: k })}
                  </Typography>
                  <Typography fontWeight={700}>{n}</Typography>
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard title={t('dashboard.trialsEnding')}>
            {s.trialsEnding.length === 0 ? (
              <EmptyState compact title={t('dashboard.noTrialsEnding')} />
            ) : (
              <Stack spacing={1.5}>
                {s.trialsEnding.map((c) => (
                  <Stack key={c.id} direction="row" justifyContent="space-between">
                    <Typography
                      component={RouterLink}
                      to={`/admin/clinics/${c.id}`}
                      variant="body2"
                      dir="auto"
                      sx={{ color: 'primary.main', textDecoration: 'none' }}
                    >
                      {c.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(c.trialEndsAt, i18n.language, 'll')}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
