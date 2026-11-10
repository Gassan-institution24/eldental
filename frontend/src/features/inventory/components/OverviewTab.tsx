import { Alert, Box, Chip, Grid, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { AlertTriangle, Boxes, FlaskConical, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/dates';
import { MoneyText } from '@/shared/components/MoneyText';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { fmtQty, useOverview } from '../api';

function Kpi({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: 'warning' | 'error' }) {
  return (
    <Box sx={{ p: 3, border: 1, borderColor: tone ? `${tone}.main` : 'divider', borderRadius: 2, height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ color: tone ? `${tone}.main` : 'text.secondary' }}>
        {icon}
        <Typography variant="body2">{label}</Typography>
      </Stack>
      <Typography variant="h5" sx={{ mt: 1 }}>
        {value}
      </Typography>
    </Box>
  );
}

/** What needs attention today: low stock, lots close to expiry, opened containers near their limit. */
export default function OverviewTab() {
  const { t, i18n } = useTranslation('inventory');
  const q = useOverview();
  if (q.isLoading) return <PageSkeleton rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const o = q.data;
  const lang = i18n.language;
  return (
    <Stack spacing={4}>
      <Grid container spacing={3}>
        <Grid item xs={6} md={3}>
          <Kpi icon={<Boxes size={18} />} label={t('overview.items')} value={o.items} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi icon={<AlertTriangle size={18} />} label={t('overview.low')} value={o.lowStock.length} tone={o.lowStock.length ? 'warning' : undefined} />
        </Grid>
        <Grid item xs={6} md={3}>
          <Kpi icon={<FlaskConical size={18} />} label={t('overview.openContainers')} value={o.openContainers} />
        </Grid>
        {o.stockValue !== undefined && (
          <Grid item xs={6} md={3}>
            <Kpi icon={<Wallet size={18} />} label={t('overview.value')} value={<MoneyText value={o.stockValue} />} />
          </Grid>
        )}
      </Grid>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <SectionCard title={t('overview.lowTitle')} subtitle={t('overview.lowHint')}>
            {o.lowStock.length === 0 ? (
              <EmptyState title={t('overview.lowEmpty')} />
            ) : (
              <List dense disablePadding>
                {o.lowStock.map((i) => (
                  <ListItem key={i.id} disableGutters secondaryAction={<Chip size="small" color="warning" label={fmtQty(i.quantityOnHand, i.unit)} />}>
                    <ListItemText primary={i.name} secondary={t('overview.reorderAt', { qty: fmtQty(i.reorderLevel, i.unit) })} />
                  </ListItem>
                ))}
              </List>
            )}
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={4}>
          <SectionCard title={t('overview.expiringTitle')} subtitle={t('overview.expiringHint')}>
            {o.expiring.length === 0 ? (
              <EmptyState title={t('overview.expiringEmpty')} />
            ) : (
              <List dense disablePadding>
                {o.expiring.map((b) => (
                  <ListItem key={b.batchId} disableGutters secondaryAction={<Chip size="small" color={b.expired ? 'error' : 'warning'} label={b.expired ? t('expired') : formatDate(b.expiresAt, lang)} />}>
                    <ListItemText primary={b.itemName} secondary={`${t('lot')} ${b.lotNumber || '—'} · ${fmtQty(b.quantity, b.unit)}`} />
                  </ListItem>
                ))}
              </List>
            )}
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={4}>
          <SectionCard title={t('overview.budTitle')} subtitle={t('overview.budHint')}>
            {o.containersNearBeyondUse.length === 0 ? (
              <EmptyState title={t('overview.budEmpty')} />
            ) : (
              <List dense disablePadding>
                {o.containersNearBeyondUse.map((c) => (
                  <ListItem key={c.id} disableGutters secondaryAction={<Chip size="small" color={c.expired ? 'error' : 'warning'} label={formatDate(c.beyondUseDate, lang)} />}>
                    <ListItemText primary={c.itemName} secondary={<span dir="ltr">{c.code}</span>} />
                  </ListItem>
                ))}
              </List>
            )}
          </SectionCard>
        </Grid>
      </Grid>
      <Alert severity="info">{t('overview.flow')}</Alert>
    </Stack>
  );
}
