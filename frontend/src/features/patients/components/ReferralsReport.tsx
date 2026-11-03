import { Chip, Grid, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { useReferralReport } from '../api/patients';

/** Referrals report (03 §4): new patients by referral type, top referrers, "how did you hear". */
export function ReferralsReport({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation('patients');
  const q = useReferralReport(from, to);
  if (q.isLoading) return <PageSkeleton rows={3} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <SectionCard title={t('referrals.reportTitle')} subtitle={t('referrals.reportHint', { count: d.newPatients })}>
      {d.newPatients === 0 ? (
        <EmptyState compact title={t('referrals.reportEmpty')} />
      ) : (
        <Grid container spacing={4}>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('referrals.byType')}
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
              {d.byType.map((r) => (
                <Chip key={r.type} variant="outlined" label={`${r.type === 'none' ? t('referrals.noReferral') : t(`referralTypes.${r.type}`)}: ${r.count}`} />
              ))}
            </Stack>
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('referrals.topReferrers')}
            </Typography>
            {d.topReferrers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            ) : (
              <Table size="small">
                <TableBody>
                  {d.topReferrers.map((r) => (
                    <TableRow key={r.patientId}>
                      <TableCell>
                        <Link component={RouterLink} to={`/clinic/patients/${r.patientId}`} dir="auto">
                          {r.fullName}
                        </Link>
                      </TableCell>
                      <TableCell align="right">{r.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Grid>
          <Grid item xs={12} md={4}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('fields.referralSource')}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('referrals.source')}</TableCell>
                  <TableCell align="right">{t('referrals.count')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {d.sources.map((s) => (
                  <TableRow key={s.source || '-'}>
                    <TableCell dir="auto">{s.source || t('referrals.unknownSource')}</TableCell>
                    <TableCell align="right">{s.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Grid>
        </Grid>
      )}
    </SectionCard>
  );
}
