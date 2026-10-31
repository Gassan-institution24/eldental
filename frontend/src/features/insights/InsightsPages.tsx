import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  FileWarning,
  FlaskConical,
  PackageMinus,
  Plus,
  Printer,
  Stethoscope,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { useAccountLookup } from '@/features/accounting/api';
import { getData, postData } from '@/lib/api/axios';
import { formatDateTime, todayLocal } from '@/lib/dates';
import { resourceHooks, type Entity } from '@/shared/api/resource';
import { entityName, freeText, optional } from '@/shared/generated/validation/fields';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { MoneyInput } from '@/shared/form/MoneyInput';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';

/* ---------------- dashboard KPIs ---------------- */

type Dash = {
  today?: {
    total: number;
    waiting: number;
    inChair: number;
    completed: number;
    upcoming: number;
    noShowRate30d: number;
  };
  recallsDue?: number;
  production?: { today: number; month: number };
  collections?: { today: number; month: number };
  receivables?: { patients: number; insurance: number; overdue: number };
  newPatients?: { month: number };
  planConversion?: { presented: number; accepted: number; percent: number };
  todo: Record<string, number>;
};

function Kpi({
  icon,
  label,
  value,
  hint,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
}) {
  const card = (
    <Card
      sx={{
        p: 4,
        height: '100%',
        ...(to ? { cursor: 'pointer', '&:hover': { boxShadow: 4 } } : {}),
      }}
    >
      <Stack direction="row" spacing={3} alignItems="center">
        <Box
          sx={(th) => ({
            width: 44,
            height: 44,
            borderRadius: '12px',
            display: 'grid',
            placeItems: 'center',
            color: 'primary.main',
            bgcolor: alpha(th.palette.primary.main, 0.1),
            flexShrink: 0,
          })}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography fontSize={24} fontWeight={800} lineHeight={1.2}>
            {value}
          </Typography>
          {hint && (
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          )}
        </Box>
      </Stack>
    </Card>
  );
  return to ? (
    <Box
      component={RouterLink}
      to={to}
      sx={{ textDecoration: 'none', display: 'block', height: '100%' }}
    >
      {card}
    </Box>
  ) : (
    card
  );
}

/** Live KPIs for the clinic home, per the user's permissions (Phase 10). */
export function DashboardKpis() {
  const { t } = useTranslation('dashboard');
  const q = useQuery({
    queryKey: ['dashboard'],
    refetchInterval: 120_000,
    queryFn: () => getData<Dash>('/dashboard'),
  });
  if (q.isLoading) return <PageSkeleton rows={2} />;
  if (q.error || !q.data)
    return <ErrorState error={q.error} compact onRetry={() => void q.refetch()} />;
  const d = q.data;
  const cards: ReactNode[] = [];
  if (d.today)
    cards.push(
      <Kpi
        key="today"
        icon={<CalendarCheck size={20} />}
        label={t('kpis.today')}
        value={d.today.total}
        hint={t('kpis.todayHint', {
          waiting: d.today.waiting,
          inChair: d.today.inChair,
          done: d.today.completed,
        })}
        to="/clinic/today"
      />,
    );
  if (d.production)
    cards.push(
      <Kpi
        key="prod"
        icon={<Stethoscope size={20} />}
        label={t('kpis.production')}
        value={<MoneyText value={d.production.today} />}
        hint={
          <>
            {t('kpis.thisMonth')} <MoneyText value={d.production.month} />
          </>
        }
      />,
    );
  if (d.collections)
    cards.push(
      <Kpi
        key="coll"
        icon={<Wallet size={20} />}
        label={t('kpis.collections')}
        value={<MoneyText value={d.collections.today} />}
        hint={
          <>
            {t('kpis.thisMonth')} <MoneyText value={d.collections.month} />
          </>
        }
        to="/clinic/billing/payments"
      />,
    );
  if (d.receivables)
    cards.push(
      <Kpi
        key="ar"
        icon={<CreditCard size={20} />}
        label={t('kpis.receivables')}
        value={<MoneyText value={d.receivables.patients} />}
        hint={
          <>
            {t('kpis.insurance')} <MoneyText value={d.receivables.insurance} />
          </>
        }
        to="/clinic/billing/invoices?tab=open"
      />,
    );
  if (d.newPatients)
    cards.push(
      <Kpi
        key="np"
        icon={<Users size={20} />}
        label={t('kpis.newPatients')}
        value={d.newPatients.month}
        hint={t('kpis.thisMonthShort')}
        to="/clinic/patients"
      />,
    );
  if (d.today)
    cards.push(
      <Kpi
        key="ns"
        icon={<AlertTriangle size={20} />}
        label={t('kpis.noShow')}
        value={`${d.today.noShowRate30d}%`}
        hint={t('kpis.last30')}
      />,
    );
  if (d.planConversion)
    cards.push(
      <Kpi
        key="pc"
        icon={<TrendingUp size={20} />}
        label={t('kpis.conversion')}
        value={`${d.planConversion.percent}%`}
        hint={t('kpis.last90')}
      />,
    );
  if (d.recallsDue !== undefined)
    cards.push(
      <Kpi
        key="rc"
        icon={<ClipboardList size={20} />}
        label={t('kpis.recalls')}
        value={d.recallsDue}
        hint={t('kpis.next14')}
        to="/clinic/recalls"
      />,
    );
  const todo = [
    { k: 'unsignedNotes', icon: <FileWarning size={14} />, to: undefined },
    { k: 'pendingLeave', icon: <CalendarCheck size={14} />, to: '/clinic/hr/leave' },
    { k: 'labDueSoon', icon: <FlaskConical size={14} />, to: '/clinic/lab-orders' },
    { k: 'lowStock', icon: <PackageMinus size={14} />, to: '/clinic/inventory' },
    {
      k: 'draftInvoices',
      icon: <CreditCard size={14} />,
      to: '/clinic/billing/invoices?tab=draft',
    },
  ].filter((x) => (d.todo[x.k] ?? 0) > 0);
  return (
    <Stack spacing={4}>
      <Grid container spacing={4}>
        {cards.map((c, i) => (
          <Grid item xs={12} sm={6} lg={3} key={i}>
            {c}
          </Grid>
        ))}
      </Grid>
      {todo.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {todo.map((x) => (
            <Chip
              key={x.k}
              icon={x.icon}
              color="warning"
              variant="outlined"
              label={t(`todo.${x.k}`, { count: d.todo[x.k] })}
              {...(x.to ? { component: RouterLink, to: x.to, clickable: true } : {})}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/* ---------------- operational report ---------------- */

type Op = {
  total: number;
  statuses: Record<string, number>;
  sources: Record<string, number>;
  newPatients: number;
  noShowRate: number;
  dentists: {
    dentistId: string;
    name: string;
    total: number;
    completed: number;
    noShow: number;
    cancelled: number;
    bookedMinutes: number;
  }[];
};

export function OperationalReportPage() {
  const { t } = useTranslation('insights');
  const { t: ts } = useTranslation('scheduling');
  const [from, setFrom] = useState(`${todayLocal().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayLocal());
  const q = useQuery({
    queryKey: ['reports', 'operational', from, to],
    queryFn: () => getData<Op>('/reports/operational', { params: { from, to } }),
  });
  return (
    <Box>
      <PageHeader title={t('ops.title')} subtitle={t('ops.subtitle')} />
      <Stack direction="row" spacing={2} sx={{ mb: 4 }}>
        <TextField
          type="date"
          size="small"
          label={t('ops.from')}
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ dir: 'ltr' }}
        />
        <TextField
          type="date"
          size="small"
          label={t('ops.to')}
          value={to}
          onChange={(e) => e.target.value && setTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ dir: 'ltr' }}
        />
        <Button size="small" startIcon={<Printer size={16} />} onClick={() => window.print()}>
          {t('ops.print')}
        </Button>
      </Stack>
      {q.isLoading ? (
        <PageSkeleton rows={6} />
      ) : q.error || !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Stack spacing={4}>
          <Grid container spacing={3}>
            {(
              [
                ['appointments', q.data.total],
                ['completed', q.data.statuses.completed ?? 0],
                ['noShowRate', `${q.data.noShowRate}%`],
                ['newPatients', q.data.newPatients],
              ] as [string, ReactNode][]
            ).map(([k, v]) => (
              <Grid item xs={6} md={3} key={k}>
                <Card variant="outlined" sx={{ p: 3 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t(`ops.${k}`)}
                  </Typography>
                  <Typography variant="h4">{v}</Typography>
                </Card>
              </Grid>
            ))}
          </Grid>
          <SectionCard title={t('ops.byStatus')}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {Object.entries(q.data.statuses).map(([s, n]) => (
                <StatusChip
                  key={s}
                  status={s}
                  label={`${ts(`status.${s}`, { ns: 'common', defaultValue: s })}: ${n}`}
                />
              ))}
              {Object.entries(q.data.sources).map(([s, n]) => (
                <Chip key={s} variant="outlined" label={`${ts(`source.${s}`)}: ${n}`} />
              ))}
            </Stack>
          </SectionCard>
          <SectionCard title={t('ops.byDentist')} noPadding>
            {q.data.dentists.length === 0 ? (
              <EmptyState compact title={t('ops.empty')} />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('ops.dentist')}</TableCell>
                    <TableCell align="right">{t('ops.appointments')}</TableCell>
                    <TableCell align="right">{t('ops.completed')}</TableCell>
                    <TableCell align="right">{t('ops.noShow')}</TableCell>
                    <TableCell align="right">{t('ops.cancelled')}</TableCell>
                    <TableCell align="right">{t('ops.bookedHours')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {q.data.dentists.map((d) => (
                    <TableRow key={d.dentistId}>
                      <TableCell>{d.name}</TableCell>
                      <TableCell align="right">{d.total}</TableCell>
                      <TableCell align="right">{d.completed}</TableCell>
                      <TableCell align="right">{d.noShow}</TableCell>
                      <TableCell align="right">{d.cancelled}</TableCell>
                      <TableCell align="right">
                        {Math.round((d.bookedMinutes / 60) * 10) / 10}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
          <Typography variant="caption" color="text.secondary">
            {t('ops.financialHint')}{' '}
            <RouterLink to="/clinic/accounting/reports">{t('ops.financialLink')}</RouterLink>
          </Typography>
        </Stack>
      )}
    </Box>
  );
}

/* ---------------- inventory ---------------- */

type Item = Entity & {
  sku: string;
  name: string;
  unit: string;
  category: string;
  reorderLevel: number;
  quantityOnHand: number;
  averageCost: number;
  isActive: boolean;
};
const itemsApi = resourceHooks<Item>('/inventory-items');
const itemSchema = z.object({
  name: entityName({ max: 120 }),
  sku: optional(freeText(40)),
  unit: optional(freeText(20)),
  category: optional(freeText(60)),
  reorderLevel: z.coerce.number().min(0, { message: 'too_small' }).max(1_000_000),
  isActive: z.boolean(),
});
type ItemValues = z.input<typeof itemSchema>;

export function InventoryPage() {
  const { t } = useTranslation('insights');
  const { can } = usePermission();
  const [low, setLow] = useState(false);
  const list = itemsApi.useAll({ low: low ? 'true' : undefined });
  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [moving, setMoving] = useState<Item | null>(null);
  return (
    <Box>
      <PageHeader
        title={t('inventory.title')}
        subtitle={t('inventory.subtitle')}
        primary={
          can('inventory.item.manage') && (
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() => setEditing('new')}
            >
              {t('inventory.add')}
            </Button>
          )
        }
      />
      <DataTable<Item>
        clientSide
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => can('inventory.item.manage') && setEditing(r)}
        toolbar={
          <Button
            size="small"
            variant={low ? 'contained' : 'outlined'}
            color="warning"
            onClick={() => setLow(!low)}
          >
            {t('inventory.lowOnly')}
          </Button>
        }
        empty={<EmptyState title={t('inventory.empty')} />}
        columns={[
          { field: 'name', headerName: t('inventory.name'), flex: 1, minWidth: 180 },
          { field: 'sku', headerName: t('inventory.sku'), width: 120 },
          {
            field: 'quantityOnHand',
            headerName: t('inventory.onHand'),
            width: 130,
            renderCell: ({ row }) => (
              <Chip
                size="small"
                color={row.quantityOnHand <= row.reorderLevel ? 'warning' : 'default'}
                label={`${row.quantityOnHand} ${row.unit}`}
              />
            ),
          },
          { field: 'reorderLevel', headerName: t('inventory.reorder'), width: 120 },
          {
            field: 'averageCost',
            headerName: t('inventory.avgCost'),
            width: 130,
            align: 'right',
            headerAlign: 'right',
            renderCell: ({ row }) => <MoneyText value={row.averageCost} />,
          },
          {
            field: 'actions',
            headerName: '',
            width: 140,
            sortable: false,
            renderCell: ({ row }) =>
              can('inventory.stock.adjust') ? (
                <Button size="small" onClick={(e) => (e.stopPropagation(), setMoving(row))}>
                  {t('inventory.move')}
                </Button>
              ) : null,
          },
        ]}
      />
      {editing && (
        <ItemDrawer item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {moving && <MovementDialog item={moving} onClose={() => setMoving(null)} />}
    </Box>
  );
}

function ItemDrawer({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const { t } = useTranslation('insights');
  const notify = useNotify();
  const create = itemsApi.useCreate();
  const update = itemsApi.useUpdate();
  const form = useAppForm<ItemValues>({
    schema: itemSchema,
    defaultValues: {
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      unit: item?.unit ?? 'pcs',
      category: item?.category ?? '',
      reorderLevel: item?.reorderLevel ?? 0,
      isActive: item?.isActive ?? true,
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={item ? t('inventory.edit') : t('inventory.add')}
      formId="item-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="inventory.item"
        id="item-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof itemSchema>;
          if (item)
            await update.mutateAsync({
              id: item.id,
              version: item.version,
              ...(v as Partial<Item>),
            });
          else await create.mutateAsync(v as Partial<Item>);
          notify.success(t('inventory.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFTextField name="name" label={t('inventory.name')} required maxLength={120} />
          <RHFTextField name="sku" label={t('inventory.sku')} maxLength={40} />
          <RHFTextField name="unit" label={t('inventory.unit')} maxLength={20} />
          <RHFTextField name="category" label={t('inventory.category')} maxLength={60} />
          <RHFTextField
            name="reorderLevel"
            label={t('inventory.reorder')}
            type="number"
            inputProps={{ dir: 'ltr', min: 0 }}
          />
          <RHFCheckbox name="isActive" label={t('inventory.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

function MovementDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t } = useTranslation('insights');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const qc = useQueryClient();
  const currency = useCurrency();
  const accounts = useAccountLookup();
  const [type, setType] = useState<'purchase' | 'consumption' | 'adjustment' | 'return'>(
    'consumption',
  );
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState<number>(item.averageCost);
  const [from, setFrom] = useState(accounts.bySystem('CASH_DEFAULT')?.id ?? '');
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () =>
      postData('/stock-movements', {
        itemId: item.id,
        type,
        quantity: Number(qty),
        ...(type === 'purchase' ? { unitCost: cost, paidFromAccountId: from } : {}),
        ...(note ? { note } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/inventory-items'] });
      notify.success(t('inventory.moved'));
      onClose();
    },
    onError: notify.error,
  });
  const n = Number(qty);
  const valid =
    Number.isFinite(n) &&
    n !== 0 &&
    (type === 'adjustment' || n > 0) &&
    (type !== 'purchase' || (cost > 0 && from));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('inventory.moveTitle', { name: item.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <TextField
            select
            label={t('inventory.type')}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {(['consumption', 'purchase', 'adjustment', 'return'] as const).map((x) => (
              <MenuItem key={x} value={x}>
                {t(`inventory.types.${x}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('inventory.quantity')}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputProps={{ dir: 'ltr', inputMode: 'decimal' }}
            helperText={type === 'adjustment' ? t('inventory.adjustHint') : undefined}
            error={!valid && qty !== ''}
          />
          {type === 'purchase' && (
            <>
              <MoneyInput
                label={t('inventory.unitCost')}
                value={cost}
                currency={currency}
                onChange={(v) => setCost(typeof v === 'number' ? v : 0)}
              />
              <TextField
                select
                label={t('inventory.paidFrom')}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                {accounts.postable
                  .filter((a) => ['cash', 'bank'].includes(a.subtype))
                  .map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {accounts.label(a)}
                    </MenuItem>
                  ))}
              </TextField>
            </>
          )}
          <TextField
            label={t('inventory.note')}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 300))}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button variant="contained" disabled={!valid || m.isPending} onClick={() => m.mutate()}>
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- clinic logs (15) ---------------- */

type LogRow = {
  id: string;
  at?: string;
  lastAt?: string;
  actorName?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  reason?: string;
  type?: string;
  path?: string;
  kind?: string;
  message?: string;
  code?: string;
  count?: number;
  status?: string;
};

export function LogsPage() {
  const { t, i18n } = useTranslation('insights');
  const { can } = usePermission();
  const kinds = (['audit', 'activity', 'issues'] as const).filter((k) => can(`logs.${k}.read`));
  const [kind, setKind] = useState<(typeof kinds)[number]>(kinds[0] ?? 'activity');
  const q = useQuery({
    queryKey: ['logs', kind],
    queryFn: () => getData<LogRow[]>('/logs', { params: { kind, limit: 200 } }),
  });
  return (
    <SectionCard title={t('logs.title')} subtitle={t('logs.subtitle')} noPadding>
      <Tabs value={kind} onChange={(_e, v: typeof kind) => setKind(v)} sx={{ px: 3 }}>
        {kinds.map((k) => (
          <Tab key={k} value={k} label={t(`logs.kinds.${k}`)} />
        ))}
      </Tabs>
      {q.isLoading ? (
        <PageSkeleton rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} compact />
      ) : (q.data ?? []).length === 0 ? (
        <EmptyState compact title={t('logs.empty')} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('logs.when')}</TableCell>
                <TableCell>{kind === 'audit' ? t('logs.who') : t('logs.what')}</TableCell>
                <TableCell>{t('logs.detail')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(q.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(r.at ?? r.lastAt ?? '', i18n.language)}
                  </TableCell>
                  <TableCell dir="auto">
                    {kind === 'audit'
                      ? r.actorName
                      : kind === 'activity'
                        ? r.type
                        : `${r.kind ?? ''} ${r.code ?? ''}`}
                  </TableCell>
                  <TableCell dir="auto">
                    {kind === 'audit'
                      ? `${t(`logs.actions.${r.action}`, { defaultValue: r.action })} · ${r.entity}${r.summary ? ` · ${r.summary}` : ''}${r.reason ? ` · ${r.reason}` : ''}`
                      : kind === 'activity'
                        ? r.path
                        : `${r.message ?? ''}${r.count ? ` (×${r.count})` : ''}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </SectionCard>
  );
}
