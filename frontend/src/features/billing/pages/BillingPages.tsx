import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Banknote, CreditCard, MoreVertical, Plus, Printer, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { insuranceCompaniesApi, type InsuranceCompany } from '@/features/patients/api/patients';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { formatDate, formatDateTime } from '@/lib/dates';
import { entityName, freeText, optional, percent } from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency, useFormatMoney } from '@/shared/components/MoneyText';
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
import {
  PAYMENT_METHODS,
  useBillingSummary,
  useCashHistory,
  useCashMutations,
  useCashSession,
  useClaimMutations,
  useClaims,
  useInvoices,
  usePaymentMutations,
  usePayments,
  type Claim,
  type Payment,
} from '../api';
import { InvoiceEditor } from '../components/InvoiceEditor';
import { PaymentDialog } from '../components/PaymentDialog';
import { ReceiptPrintDialog } from '../components/PrintDialogs';
import { useInvoiceColumns } from './InvoicePages';

/* ---------------- payments ---------------- */

function PaymentRowMenu({ p, onReceipt }: { p: Payment; onReceipt: () => void }) {
  const { t } = useTranslation('billing');
  const notify = useNotify();
  const confirm = useConfirm();
  const { can } = usePermission();
  const muts = usePaymentMutations();
  const summary = useBillingSummary(p.unallocated > 0 ? p.patientId : undefined);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const run = (x: Promise<unknown>, msg: string) =>
    void x.then(() => notify.success(msg), notify.error);
  const refundable = p.amount - p.refunded;
  const firstOpen = summary.data?.openInvoices.find((i) => i.patientDue > 0);
  return (
    <>
      <IconButton
        size="small"
        aria-label={t('payments.actions')}
        onClick={(e) => (e.stopPropagation(), setAnchor(e.currentTarget))}
      >
        <MoreVertical size={16} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={() => (setAnchor(null), onReceipt())}>
          <Printer size={14} style={{ marginInlineEnd: 8 }} />
          {t('payments.receipt')}
        </MenuItem>
        {p.unallocated > 0 && firstOpen && can('billing.payment.create') && (
          <MenuItem
            onClick={() => (
              setAnchor(null),
              run(
                muts.allocate.mutateAsync({
                  id: p.id,
                  invoiceId: firstOpen.id,
                  amount: Math.min(p.unallocated, firstOpen.patientDue),
                }),
                t('payments.applied'),
              )
            )}
          >
            {t('payments.applyCredit', { number: firstOpen.number })}
          </MenuItem>
        )}
        {p.cheque?.status === 'under_collection' &&
          can('billing.payment.create') && [
            <MenuItem
              key="c"
              onClick={() => (
                setAnchor(null),
                run(
                  muts.cheque.mutateAsync({ id: p.id, to: 'cleared' }),
                  t('payments.chequeCleared'),
                )
              )}
            >
              {t('payments.markCleared')}
            </MenuItem>,
            <MenuItem
              key="b"
              sx={{ color: 'error.main' }}
              onClick={() => (
                setAnchor(null),
                run(
                  muts.cheque.mutateAsync({ id: p.id, to: 'bounced' }),
                  t('payments.chequeBounced'),
                )
              )}
            >
              {t('payments.markBounced')}
            </MenuItem>,
          ]}
        {refundable > 0 && p.status !== 'void' && can('billing.payment.refund') && (
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={async () => {
              setAnchor(null);
              const r = await confirm({
                title: t('payments.refundTitle', { amount: '' }),
                body: t('payments.refundBody'),
                reason: { label: t('payments.refundReason'), required: true, max: 300 },
                destructive: true,
              });
              if (r.confirmed)
                run(
                  muts.refund.mutateAsync({
                    id: p.id,
                    amount: p.unallocated > 0 ? p.unallocated : refundable,
                    reason: r.reason ?? '',
                  }),
                  t('payments.refunded'),
                );
            }}
          >
            {p.unallocated > 0 ? t('payments.refundCredit') : t('payments.refundAll')}
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

export function usePaymentColumns(onReceipt: (id: string) => void): Column<Payment>[] {
  const { t, i18n } = useTranslation('billing');
  return [
    {
      field: 'receiptNumber',
      headerName: t('payments.receiptNo'),
      width: 170,
      renderCell: ({ row }) => <span dir="ltr">{row.receiptNumber}</span>,
    },
    {
      field: 'patient',
      headerName: t('payments.payer'),
      flex: 1.2,
      minWidth: 160,
      sortable: false,
      valueGetter: (_v, row) => row.patient?.fullName ?? t('payments.insurer'),
      fieldKey: 'patient',
    },
    {
      field: 'date',
      headerName: t('payments.date'),
      width: 120,
      valueGetter: (_v, row) => formatDate(row.date, i18n.language, 'll'),
    },
    {
      field: 'method',
      headerName: t('payments.method'),
      width: 130,
      valueGetter: (_v, row) => t(`methods.${row.method}`),
      fieldKey: 'method',
    },
    {
      field: 'amount',
      headerName: t('payments.amount'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => <MoneyText value={row.amount} />,
      fieldKey: 'amount',
    },
    {
      field: 'unallocated',
      headerName: t('payments.credit'),
      width: 110,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => (row.unallocated ? <MoneyText value={row.unallocated} /> : '—'),
      fieldKey: 'amount',
    },
    {
      field: 'status',
      headerName: t('payments.status'),
      width: 150,
      renderCell: ({ row }) => (
        <StatusChip
          status={
            row.cheque?.status === 'under_collection'
              ? 'pending'
              : row.status === 'posted'
                ? 'paid'
                : row.status
          }
          label={t(
            `payments.statuses.${row.cheque?.status === 'under_collection' ? 'cheque' : row.status}`,
          )}
        />
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 60,
      sortable: false,
      renderCell: ({ row }) => <PaymentRowMenu p={row} onReceipt={() => onReceipt(row.id)} />,
    },
  ];
}

export function PaymentsPage() {
  const { t } = useTranslation('billing');
  const lp = useListParams();
  const [sp, setSp] = useSearchParams();
  const { can } = usePermission();
  const list = usePayments({
    ...lp.params,
    method: lp.filter('method') || undefined,
    hasCredit: lp.filter('credit') ? 'true' : undefined,
  });
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  useEffect(() => {
    if (sp.get('new') === '1') {
      setAdding(true);
      sp.delete('new');
      setSp(sp, { replace: true });
    }
  }, [sp, setSp]);
  const columns = usePaymentColumns(setReceipt);
  return (
    <Box>
      <PageHeader
        title={t('payments.title')}
        subtitle={t('payments.subtitle')}
        primary={
          can('billing.payment.create') && (
            <Button
              variant="contained"
              startIcon={<CreditCard size={18} />}
              onClick={() => setAdding(true)}
            >
              {t('payments.new')}
            </Button>
          )
        }
      />
      <DataTable<Payment>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setReceipt(r.id)}
        columns={columns}
        toolbar={
          <Stack direction="row" spacing={2}>
            <TextField
              select
              size="small"
              label={t('payments.method')}
              value={lp.filter('method')}
              onChange={(e) => lp.set({ method: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">{t('payments.allMethods')}</MenuItem>
              {PAYMENT_METHODS.map((m) => (
                <MenuItem key={m} value={m}>
                  {t(`methods.${m}`)}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant={lp.filter('credit') ? 'contained' : 'outlined'}
              size="small"
              onClick={() => lp.set({ credit: lp.filter('credit') ? undefined : '1', page: 1 })}
            >
              {t('payments.withCredit')}
            </Button>
          </Stack>
        }
        empty={<EmptyState title={t('payments.empty')} />}
      />
      {adding && (
        <PaymentDialog onClose={() => setAdding(false)} onDone={(p) => setReceipt(p.id)} />
      )}
      {receipt && <ReceiptPrintDialog id={receipt} onClose={() => setReceipt(null)} />}
    </Box>
  );
}

/* ---------------- cash drawer (09 §3.3) ---------------- */

export function CashPage() {
  const { t, i18n } = useTranslation('billing');
  const notify = useNotify();
  const currency = useCurrency();
  const fmt = useFormatMoney();
  const current = useCashSession();
  const history = useCashHistory();
  const muts = useCashMutations();
  const [float, setFloat] = useState<number>(0);
  const [counted, setCounted] = useState<number | null>(null);
  const [result, setResult] = useState<{
    expected: number;
    counted: number;
    difference: number;
  } | null>(null);
  if (current.isLoading) return <PageSkeleton rows={5} />;
  if (current.error)
    return <ErrorState error={current.error} onRetry={() => void current.refetch()} />;
  const s = current.data;
  return (
    <Box>
      <PageHeader title={t('cash.title')} subtitle={t('cash.subtitle')} />
      <Grid container spacing={4}>
        <Grid item xs={12} md={6}>
          <Card variant="outlined">
            <CardContent>
              {!s ? (
                <Stack spacing={3}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Wallet size={22} />
                    <Typography variant="h5">{t('cash.closedNow')}</Typography>
                  </Stack>
                  <MoneyInput
                    label={t('cash.openingFloat')}
                    value={float}
                    currency={currency}
                    onChange={(v) => setFloat(typeof v === 'number' ? v : 0)}
                  />
                  <Button
                    variant="contained"
                    onClick={() =>
                      void muts.open
                        .mutateAsync(float)
                        .then(() => notify.success(t('cash.opened')), notify.error)
                    }
                    disabled={muts.open.isPending}
                  >
                    {t('cash.open')}
                  </Button>
                  {result && (
                    <Alert severity={result.difference === 0 ? 'success' : 'warning'}>
                      {t('cash.closedResult', {
                        expected: fmt(result.expected),
                        counted: fmt(result.counted),
                        difference: fmt(result.difference),
                      })}
                    </Alert>
                  )}
                </Stack>
              ) : (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2} alignItems="center">
                    <Banknote size={22} />
                    <Typography variant="h5">
                      {t('cash.openSince', { time: formatDateTime(s.openedAt, i18n.language) })}
                    </Typography>
                  </Stack>
                  {(
                    [
                      ['openingFloat', s.openingFloat],
                      ['received', s.received],
                      ['refunds', -s.refunds],
                    ] as [string, number][]
                  ).map(([k, v]) => (
                    <Stack key={k} direction="row" justifyContent="space-between">
                      <Typography color="text.secondary">{t(`cash.${k}`)}</Typography>
                      <MoneyText value={v} />
                    </Stack>
                  ))}
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}
                  >
                    <Typography fontWeight={800}>{t('cash.expected')}</Typography>
                    <Typography fontWeight={800}>
                      <MoneyText value={s.expected} />
                    </Typography>
                  </Stack>
                  {s.byMethod.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {t('cash.otherMethods')}:{' '}
                      {s.byMethod
                        .map((m) => `${t(`methods.${m.method}`)} ${fmt(m.total)} (${m.count})`)
                        .join(' · ')}
                    </Typography>
                  )}
                  <MoneyInput
                    label={t('cash.counted')}
                    value={counted}
                    currency={currency}
                    onChange={(v) => setCounted(typeof v === 'number' ? v : null)}
                    required
                  />
                  {counted !== null && counted !== s.expected && (
                    <Alert severity="warning">
                      {t('cash.difference', { amount: fmt(counted - s.expected) })}
                    </Alert>
                  )}
                  <Button
                    variant="contained"
                    color="secondary"
                    disabled={counted === null || muts.close.isPending}
                    onClick={() =>
                      void muts.close.mutateAsync({ countedAmount: counted ?? 0 }).then((r) => {
                        setResult(r);
                        setCounted(null);
                        notify.success(t('cash.closed'));
                      }, notify.error)
                    }
                  >
                    {t('cash.close')}
                  </Button>
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard title={t('cash.history')}>
            {(history.data ?? []).length === 0 ? (
              <EmptyState compact title={t('cash.noHistory')} />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('cash.closedAt')}</TableCell>
                    <TableCell align="right">{t('cash.expected')}</TableCell>
                    <TableCell align="right">{t('cash.counted')}</TableCell>
                    <TableCell align="right">{t('cash.diff')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(history.data ?? []).map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{formatDateTime(h.closedAt, i18n.language)}</TableCell>
                      <TableCell align="right">{fmt(h.expected)}</TableCell>
                      <TableCell align="right">{fmt(h.counted)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ color: h.difference ? 'warning.main' : undefined }}
                      >
                        {fmt(h.difference)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}

/* ---------------- insurance companies ---------------- */

const companySchema = z.object({
  name: entityName({ max: 120 }),
  code: optional(freeText(20)),
  defaultCoveragePercent: percent(),
  isActive: z.boolean(),
});
type CompanyValues = z.input<typeof companySchema>;

export function InsuranceCompaniesPage() {
  const { t } = useTranslation('billing');
  const list = insuranceCompaniesApi.useAll({ includeInactive: 'true' });
  const [editing, setEditing] = useState<InsuranceCompany | 'new' | null>(null);
  return (
    <Box>
      <PageHeader
        title={t('insurance.title')}
        subtitle={t('insurance.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setEditing('new')}
          >
            {t('insurance.add')}
          </Button>
        }
      />
      <DataTable<InsuranceCompany>
        clientSide
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title={t('insurance.empty')} />}
        columns={[
          { field: 'name', headerName: t('insurance.name'), flex: 1, minWidth: 200 },
          { field: 'code', headerName: t('insurance.code'), width: 120 },
          {
            field: 'defaultCoveragePercent',
            headerName: t('insurance.coverage'),
            width: 140,
            valueGetter: (_v, row) => `${row.defaultCoveragePercent}%`,
          },
          {
            field: 'isActive',
            headerName: t('insurance.status'),
            width: 120,
            renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} />,
          },
        ]}
      />
      {editing && (
        <CompanyDrawer
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Box>
  );
}

function CompanyDrawer({
  company,
  onClose,
}: {
  company: InsuranceCompany | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const notify = useNotify();
  const create = insuranceCompaniesApi.useCreate();
  const update = insuranceCompaniesApi.useUpdate();
  const form = useAppForm<CompanyValues>({
    schema: companySchema,
    defaultValues: {
      name: company?.name ?? '',
      code: company?.code ?? '',
      defaultCoveragePercent: company?.defaultCoveragePercent ?? 80,
      isActive: company?.isActive ?? true,
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={company ? t('insurance.edit') : t('insurance.add')}
      formId="company-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="billing.insuranceCompany"
        id="company-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof companySchema>;
          if (company)
            await update.mutateAsync({
              id: company.id,
              version: company.version,
              ...(v as Partial<InsuranceCompany>),
            });
          else await create.mutateAsync(v as Partial<InsuranceCompany>);
          notify.success(t('insurance.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFTextField name="name" label={t('insurance.name')} required maxLength={120} />
          <RHFTextField name="code" label={t('insurance.code')} maxLength={20} />
          <RHFTextField
            name="defaultCoveragePercent"
            label={t('insurance.coverage')}
            type="number"
            inputProps={{ dir: 'ltr', min: 0, max: 100 }}
          />
          <RHFCheckbox name="isActive" label={t('insurance.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- claims (09 §3.4) ---------------- */

export function ClaimsPage() {
  const { t, i18n } = useTranslation('billing');
  const notify = useNotify();
  const confirm = useConfirm();
  const claims = useClaims({});
  const muts = useClaimMutations();
  const [creating, setCreating] = useState(false);
  const [responding, setResponding] = useState<Claim | null>(null);
  const [paying, setPaying] = useState<Claim | null>(null);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const columns: Column<Claim>[] = [
    {
      field: 'number',
      headerName: t('claims.number'),
      width: 150,
      renderCell: ({ row }) => <span dir="ltr">{row.number}</span>,
    },
    { field: 'insuranceCompanyName', headerName: t('claims.insurer'), flex: 1, minWidth: 160 },
    {
      field: 'patient',
      headerName: t('claims.patient'),
      flex: 1,
      minWidth: 160,
      valueGetter: (_v, row) => row.patient?.fullName ?? '',
    },
    {
      field: 'claimedAmount',
      headerName: t('claims.claimed'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => <MoneyText value={row.claimedAmount} />,
    },
    {
      field: 'approvedAmount',
      headerName: t('claims.approved'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => (row.responseAt ? <MoneyText value={row.approvedAmount} /> : '—'),
    },
    {
      field: 'paidAmount',
      headerName: t('claims.paid'),
      width: 110,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => <MoneyText value={row.paidAmount} />,
    },
    {
      field: 'status',
      headerName: t('claims.status'),
      width: 150,
      renderCell: ({ row }) => (
        <StatusChip
          status={row.status === 'draft' ? 'draft' : row.status}
          label={t(`claims.statuses.${row.status}`)}
        />
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 220,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1} onClick={(e) => e.stopPropagation()}>
          {row.status === 'draft' && (
            <Button
              size="small"
              onClick={() =>
                run(muts.status.mutateAsync({ id: row.id, to: 'submitted' }), t('claims.submitted'))
              }
            >
              {t('claims.submit')}
            </Button>
          )}
          {row.status === 'submitted' && (
            <>
              <Button size="small" onClick={() => setResponding(row)}>
                {t('claims.respond')}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={async () => {
                  const r = await confirm({
                    title: t('claims.rejectTitle'),
                    reason: { label: t('claims.reason'), required: true, max: 300 },
                    destructive: true,
                  });
                  if (r.confirmed)
                    run(
                      muts.status.mutateAsync({
                        id: row.id,
                        to: 'rejected',
                        shortfallMode: 'rebill',
                        reason: r.reason,
                      }),
                      t('claims.rejected'),
                    );
                }}
              >
                {t('claims.reject')}
              </Button>
            </>
          )}
          {['approved', 'partially_approved'].includes(row.status) &&
            row.paidAmount < row.approvedAmount && (
              <Button size="small" variant="outlined" onClick={() => setPaying(row)}>
                {t('claims.recordPayment')}
              </Button>
            )}
        </Stack>
      ),
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('claims.title')}
        subtitle={t('claims.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setCreating(true)}
          >
            {t('claims.new')}
          </Button>
        }
      />
      <DataTable<Claim>
        clientSide
        rows={claims.data ?? []}
        loading={claims.isLoading}
        error={claims.error}
        onRetry={() => void claims.refetch()}
        columns={columns}
        empty={<EmptyState title={t('claims.empty')} description={t('claims.emptyHint')} />}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
        {formatDate(new Date(), i18n.language)}
      </Typography>
      {creating && <NewClaimDialog onClose={() => setCreating(false)} />}
      {responding && <RespondDialog claim={responding} onClose={() => setResponding(null)} />}
      {paying && <InsurerPaymentDialog claim={paying} onClose={() => setPaying(null)} />}
    </Box>
  );
}

function NewClaimDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('billing');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const invoices = useInvoices({ status: 'open', unclaimed: 'true', limit: 100 });
  const muts = useClaimMutations();
  const [chosen, setChosen] = useState<string[]>([]);
  const rows = invoices.data?.data ?? [];
  const first = rows.find((r) => r.id === chosen[0]);
  const compatible = (r: (typeof rows)[number]) =>
    !first ||
    (r.patientId === first.patientId && r.insuranceCompanyId === first.insuranceCompanyId);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('claims.new')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('claims.newHint')}
        </Typography>
        {invoices.isLoading ? (
          <PageSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState compact title={t('claims.nothingToClaim')} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>{t('invoices.number')}</TableCell>
                <TableCell>{t('invoices.patient')}</TableCell>
                <TableCell align="right">{t('invoices.insuranceDue')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} sx={{ opacity: compatible(r) ? 1 : 0.4 }}>
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={chosen.includes(r.id)}
                      disabled={!compatible(r)}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked ? [...chosen, r.id] : chosen.filter((x) => x !== r.id),
                        )
                      }
                      inputProps={{ 'aria-label': r.number }}
                    />
                  </TableCell>
                  <TableCell dir="ltr">{r.number}</TableCell>
                  <TableCell>{r.patient?.fullName}</TableCell>
                  <TableCell align="right">
                    <MoneyText value={r.insuranceDue} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!chosen.length || muts.create.isPending}
          onClick={() =>
            void muts.create
              .mutateAsync({ invoiceIds: chosen })
              .then(() => (notify.success(t('claims.created')), onClose()), notify.error)
          }
        >
          {t('claims.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RespondDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { t } = useTranslation('billing');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const currency = useCurrency();
  const muts = useClaimMutations();
  const [approved, setApproved] = useState<number>(claim.claimedAmount);
  const [mode, setMode] = useState<'write_off' | 'rebill'>('rebill');
  const short = claim.claimedAmount - approved;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('claims.respondTitle', { number: claim.number })}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <MoneyInput
            label={t('claims.approvedAmount')}
            value={approved}
            currency={currency}
            onChange={(v) => setApproved(typeof v === 'number' ? v : 0)}
            error={approved > claim.claimedAmount}
            helperText={approved > claim.claimedAmount ? t('claims.tooHigh') : undefined}
          />
          {short > 0 && (
            <TextField
              select
              label={t('claims.shortfall', { amount: '' })}
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              <MenuItem value="rebill">{t('claims.rebill')}</MenuItem>
              <MenuItem value="write_off">{t('claims.writeOff')}</MenuItem>
            </TextField>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={approved > claim.claimedAmount || muts.status.isPending}
          onClick={() =>
            void muts.status
              .mutateAsync({
                id: claim.id,
                to: 'approved',
                approvedAmount: approved,
                ...(short > 0 ? { shortfallMode: mode } : {}),
              })
              .then(() => (notify.success(t('claims.recorded')), onClose()), notify.error)
          }
        >
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function InsurerPaymentDialog({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { t } = useTranslation('billing');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const currency = useCurrency();
  const muts = usePaymentMutations();
  const [amount, setAmount] = useState(claim.approvedAmount - claim.paidAmount);
  const [method, setMethod] = useState<string>('bank_transfer');
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('claims.recordPayment')}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <MoneyInput
            label={t('payments.amount')}
            value={amount}
            currency={currency}
            onChange={(v) => setAmount(typeof v === 'number' ? v : 0)}
          />
          <TextField
            select
            label={t('payments.method')}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {['bank_transfer', 'cheque', 'other'].map((m) => (
              <MenuItem key={m} value={m}>
                {t(`methods.${m}`)}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={amount <= 0 || muts.create.isPending}
          onClick={() =>
            void muts.create
              .mutateAsync({
                idempotencyKey: key,
                payerType: 'insurance',
                insuranceCompanyId: claim.insuranceCompanyId,
                claimId: claim.id,
                method,
                amount,
                ...(method === 'cheque' ? { cheque: { number: claim.number } } : {}),
              })
              .then(() => (notify.success(t('claims.paidDone')), onClose()), notify.error)
          }
        >
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- patient workspace → Billing ---------------- */

export function PatientBillingTab() {
  const { t } = useTranslation('billing');
  const { patient } = usePatientContext();
  const navigate = useNavigate();
  const { can } = usePermission();
  const summary = useBillingSummary(patient.id);
  const invoices = useInvoices({ patientId: patient.id, limit: 50 });
  const payments = usePayments({ patientId: patient.id, limit: 50 });
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const invoiceColumns = useInvoiceColumns(false);
  const paymentColumns = usePaymentColumns(setReceipt);
  return (
    <Stack spacing={4}>
      <Grid container spacing={3}>
        {(
          [
            ['balance', summary.data?.balance ?? 0],
            ['receivable', summary.data?.receivable ?? 0],
            ['credit', summary.data?.credit ?? 0],
          ] as [string, number][]
        ).map(([k, v]) => (
          <Grid item xs={12} sm={4} key={k}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {t(`patientTab.${k}`)}
                </Typography>
                <Typography
                  variant="h4"
                  color={k === 'balance' && v > 0 ? 'error.main' : undefined}
                >
                  <MoneyText value={v} />
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      <Stack direction="row" spacing={2} justifyContent="flex-end">
        {can('billing.invoice.create') && (
          <Button variant="outlined" onClick={() => setCreating(true)}>
            {t('invoices.new')}
          </Button>
        )}
        {can('billing.payment.create') && (
          <Button variant="contained" onClick={() => setPaying(true)}>
            {t('payments.new')}
          </Button>
        )}
      </Stack>
      <SectionCard title={t('invoices.title')} noPadding>
        <DataTable
          rows={invoices.data?.data ?? []}
          total={invoices.data?.meta.total}
          loading={invoices.isLoading}
          error={invoices.error}
          clientSide
          columns={invoiceColumns}
          onRowClick={(r) => navigate(`/clinic/billing/invoices/${r.id}`)}
          empty={<EmptyState compact title={t('invoices.empty')} />}
        />
      </SectionCard>
      <SectionCard title={t('payments.title')} noPadding>
        <DataTable
          rows={payments.data?.data ?? []}
          loading={payments.isLoading}
          error={payments.error}
          clientSide
          columns={paymentColumns}
          onRowClick={(r) => setReceipt(r.id)}
          empty={<EmptyState compact title={t('payments.empty')} />}
        />
      </SectionCard>
      {creating && (
        <InvoiceEditor
          patient={{ id: patient.id, fullName: patient.fullName }}
          onClose={() => setCreating(false)}
        />
      )}
      {paying && (
        <PaymentDialog
          patient={{ id: patient.id, fullName: patient.fullName }}
          onClose={() => setPaying(false)}
          onDone={(p) => setReceipt(p.id)}
        />
      )}
      {receipt && <ReceiptPrintDialog id={receipt} onClose={() => setReceipt(null)} />}
    </Stack>
  );
}
