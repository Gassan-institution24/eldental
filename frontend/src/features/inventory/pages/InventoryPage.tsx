import { Box, Tab, Tabs } from '@mui/material';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/shared/components/PageHeader';
import { NoPermission, PageSkeleton } from '@/shared/components/States';
import { usePermission } from '@/shared/rbac/usePermission';

const OverviewTab = lazy(() => import('../components/OverviewTab'));
const ItemsTab = lazy(() => import('../components/ItemsTab'));
const StockTab = lazy(() => import('../components/StockTab'));
const ContainersTab = lazy(() => import('../components/ContainersTab'));
const PurchasingTab = lazy(() => import('../components/PurchasingTab'));
const UsageTab = lazy(() => import('../components/UsageTab'));
const SetupTab = lazy(() => import('../components/SetupTab'));

type TabKey = 'overview' | 'items' | 'stock' | 'containers' | 'purchasing' | 'usage' | 'setup';

/** Inventory (08b): one page, a tab per job; each tab shows only with its permission. */
export function InventoryPage() {
  const { t } = useTranslation('inventory');
  const { can } = usePermission();
  const { tab } = useParams<{ tab?: TabKey }>();
  const navigate = useNavigate();

  const anyOf = (...perms: string[]) => perms.some((p) => can(p));
  const tabs: { key: TabKey; show: boolean }[] = [
    { key: 'overview', show: can('inventory.item.read') },
    { key: 'items', show: can('inventory.item.read') },
    { key: 'stock', show: can('inventory.item.read') },
    { key: 'containers', show: anyOf('inventory.item.read', 'inventory.usage.record') },
    { key: 'purchasing', show: anyOf('inventory.purchase.read', 'inventory.purchase.manage', 'inventory.purchase.receive', 'accounting.supplier.manage') },
    { key: 'usage', show: anyOf('inventory.usage.read', 'inventory.usage.record') },
    { key: 'setup', show: can('inventory.item.manage') },
  ];
  const allowed = tabs.filter((x) => x.show).map((x) => x.key);
  if (!allowed.length) return <NoPermission permission="inventory.item.read" />;
  if (!tab || !allowed.includes(tab)) return <Navigate to={`/clinic/inventory/${allowed[0]}`} replace />;

  return (
    <Box>
      <PageHeader title={t('title')} subtitle={t(`tabs.${tab}Hint`)} />
      <Tabs value={tab} onChange={(_e, v: TabKey) => navigate(`/clinic/inventory/${v}`)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 4 }}>
        {allowed.map((k) => (
          <Tab key={k} value={k} label={t(`tabs.${k}`)} />
        ))}
      </Tabs>
      <Suspense fallback={<PageSkeleton rows={6} />}>
        {tab === 'overview' && <OverviewTab />}
        {tab === 'items' && <ItemsTab />}
        {tab === 'stock' && <StockTab />}
        {tab === 'containers' && <ContainersTab />}
        {tab === 'purchasing' && <PurchasingTab />}
        {tab === 'usage' && <UsageTab />}
        {tab === 'setup' && <SetupTab />}
      </Suspense>
    </Box>
  );
}
