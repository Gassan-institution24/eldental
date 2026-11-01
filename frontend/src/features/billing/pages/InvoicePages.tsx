import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
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
import { Ban, CreditCard, FileMinus, FileText, Pencil, Printer, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { formatDate } from '@/lib/dates';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  useBillingDentists,
  useInvoice,
  useInvoiceMutations,
  useInvoices,
  type Invoice,
} from '../api';
import { InvoiceDoctorCell, useOwnInvoiceScope } from '../components/InvoiceDoctors';
import { InvoiceEditor } from '../components/InvoiceEditor';
import { PaymentDialog } from '../components/PaymentDialog';
import { InvoicePrintDialog } from '../components/PrintDialogs';

const TABS = ['all', 'draft', 'open', 'paid', 'void', 'credit_note'] as const;

export function useInvoiceColumns(withPatient = true): Column<Invoice>[] {
  const { t, i18n } = useTranslation('billing');
  return [
    {
      field: 'number',
      headerName: t('invoices.number'),
      width: 160,
      renderCell: ({ row }) => <span dir="ltr">{row.number ?? t('invoices.draftNo')}</span>,
    },
    ...(withPatient
      ? [
          {
            field: 'patient',
            headerName: t('invoices.patient'),
            flex: 1.3,
            minWidth: 180,
            sortable: false,
            valueGetter: (_v: unknown, row: Invoice) => row.patient?.fullName ?? '',
            fieldKey: 'patient',
          } as Column<Invoice>,
        ]
      : []),
    {
      field: 'dentist',
      headerName: t('invoices.doctor'),
      flex: 1.2,
      minWidth: 200,
      sortable: false,
      valueGetter: (_v, row) => row.dentist?.name ?? '',
      renderCell: ({ row }) => <InvoiceDoctorCell invoice={row} />,
      fieldKey: 'dentist',
    },
    {
      field: 'issueDate',
      headerName: t('invoices.issueDate'),
      width: 130,
      valueGetter: (_v, row) =>
        row.issueDate ? formatDate(row.issueDate, i18n.language, 'll') : '—',
    },
    {
      field: 'total',
      headerName: t('invoices.total'),
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => (
        <MoneyText value={row.type === 'credit_note' ? -row.total : row.total} />
      ),
      fieldKey: 'totals',
    },
    {
      field: 'balanceDue',
      headerName: t('invoices.balance'),
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) =>
        row.type === 'invoice' && row.status !== 'void' ? (
          <MoneyText value={row.balanceDue} />
        ) : (
          '—'
        ),
      fieldKey: 'balanceDue',
    },
    {
      field: 'status',
      headerName: t('invoices.status'),
      width: 140,
      renderCell: ({ row }) => (
        <StatusChip
          status={row.type === 'credit_note' ? 'reversed' : row.status}
          label={row.type === 'credit_note' ? t('invoices.creditNote') : undefined}
        />
      ),
    },
  ];
}

export function InvoicesPage() {
  const { t } = useTranslation('billing');
  const navigate = useNavigate();
  const lp = useListParams();
  const { can } = usePermission();
  const tab = (lp.filter('tab') || 'all') as (typeof TABS)[number];
  // Own-scope doctors only ever see their own invoices, so the doctor filter is hidden for them.
  const ownOnly = useOwnInvoiceScope();
  const dentists = useBillingDentists(!ownOnly);
  const dentistId = ownOnly ? '' : lp.filter('dentistId');
  const list = useInvoices({
    ...lp.params,
    ...(dentistId ? { dentistId } : {}),
    ...(tab === 'credit_note'
      ? { type: 'credit_note' }
      : tab !== 'all'
        ? { status: tab, type: 'invoice' }
        : {}),
  });
  const [creating, setCreating] = useState(false);
  const columns = useInvoiceColumns();
  return (
    <Box>
      <PageHeader
        title={t('invoices.title')}
        subtitle={t('invoices.subtitle')}
        primary={
          can('billing.invoice.create') && (
            <Button
              variant="contained"
              startIcon={<FileText size={18} />}
              onClick={() => setCreating(true)}
            >
              {t('invoices.new')}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(_e, v: string) => lp.set({ tab: v === 'all' ? undefined : v, page: 1 })}
        variant="scrollable"
        sx={{ mb: 3 }}
      >
        {TABS.map((x) => (
          <Tab key={x} value={x} label={t(`invoices.tabs.${x}`)} />
        ))}
      </Tabs>
      <DataTable<Invoice>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => navigate(`/clinic/billing/invoices/${r.id}`)}
        columns={columns}
        toolbar={
          !ownOnly && (
            <TextField
              select
              size="small"
              label={t('invoices.doctor')}
              value={dentists.data?.some((d) => d.id === dentistId) ? dentistId : ''}
              onChange={(e) => lp.set({ dentistId: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 200 }}
              inputProps={{ 'data-testid': 'doctor-filter' }}
            >
              <MenuItem value="">{t('invoices.allDoctors')}</MenuItem>
              {(dentists.data ?? []).map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name}
                </MenuItem>
              ))}
            </TextField>
          )
        }
        empty={
          <EmptyState
            title={t('invoices.empty')}
            description={dentistId ? t('invoices.emptyDoctorHint') : t('invoices.emptyHint')}
          />
        }
      />
      {creating && <InvoiceEditor onClose={() => setCreating(false)} />}
    </Box>
  );
}

export function InvoiceDetailPage() {
  const { t, i18n } = useTranslation('billing');
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const confirm = useConfirm();
  const { can } = usePermission();
  const q = useInvoice(id);
  const muts = useInvoiceMutations();
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [printing, setPrinting] = useState(false);
  if (q.isLoading) return <PageSkeleton rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const inv = q.data;
  const lang = i18n.language;
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const isDraft = inv.status === 'draft';
  const open = ['issued', 'partially_paid'].includes(inv.status);

  return (
    <Box>
      <PageHeader
        title={
          inv.type === 'credit_note'
            ? `${t('invoices.creditNote')} ${inv.number ?? ''}`
            : inv.number
              ? `${t('invoices.invoice')} ${inv.number}`
              : t('invoices.draftTitle')
        }
        subtitle={
          <span>
            <RouterLink to={`/clinic/patients/${inv.patientId}/billing`}>
              {inv.patient?.fullName}
            </RouterLink>{' '}
            · {inv.patient?.fileNumber}
            {inv.issueDate ? ` · ${formatDate(inv.issueDate, lang)}` : ''}
          </span>
        }
        breadcrumbs={[
          { label: t('invoices.title'), to: '/clinic/billing/invoices' },
          { label: inv.number ?? t('invoices.draftNo') },
        ]}
        actions={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <StatusChip
              status={inv.type === 'credit_note' ? 'reversed' : inv.status}
              sx={{ alignSelf: 'center' }}
            />
            <Button startIcon={<Printer size={16} />} onClick={() => setPrinting(true)}>
              {t('invoices.print')}
            </Button>
            {isDraft && can('billing.invoice.update') && (
              <Button startIcon={<Pencil size={16} />} onClick={() => setEditing(true)}>
                {t('invoices.edit')}
              </Button>
            )}
            {isDraft && can('billing.invoice.update') && (
              <Button
                color="error"
                startIcon={<Trash2 size={16} />}
                onClick={async () => {
                  const r = await confirm({ title: t('invoices.deleteTitle'), destructive: true });
                  if (r.confirmed)
                    await muts.remove
                      .mutateAsync(inv.id)
                      .then(
                        () => (
                          notify.success(t('invoices.deleted')),
                          navigate('/clinic/billing/invoices')
                        ),
                        notify.error,
                      );
                }}
              >
                {t('invoices.delete')}
              </Button>
            )}
            {isDraft && can('billing.invoice.issue') && (
              <Button
                variant="contained"
                startIcon={<Send size={16} />}
                disabled={!inv.lines.length || muts.issue.isPending}
                onClick={async () => {
                  const r = await confirm({
                    title: t('invoices.issueTitle'),
                    body: t('invoices.issueBody'),
                  });
                  if (r.confirmed)
                    run(muts.issue.mutateAsync({ id: inv.id }), t('invoices.issued'));
                }}
              >
                {t('invoices.issue')}
              </Button>
            )}
            {open && inv.patientDue > 0 && can('billing.payment.create') && (
              <Button
                variant="contained"
                startIcon={<CreditCard size={16} />}
                onClick={() => setPaying(true)}
              >
                {t('invoices.recordPayment')}
              </Button>
            )}
            {inv.type === 'invoice' &&
              ['issued', 'partially_paid', 'paid'].includes(inv.status) &&
              can('billing.invoice.void') && (
                <Button
                  startIcon={<FileMinus size={16} />}
                  onClick={async () => {
                    const r = await confirm({
                      title: t('invoices.creditTitle', { number: inv.number }),
                      body: t('invoices.creditBody'),
                      reason: { label: t('invoices.reason'), required: true, max: 300 },
                    });
                    if (r.confirmed)
                      run(
                        muts.credit.mutateAsync({ id: inv.id, reason: r.reason ?? '' }),
                        t('invoices.credited'),
                      );
                  }}
                >
                  {t('invoices.creditNoteAction')}
                </Button>
              )}
            {inv.status === 'issued' &&
              inv.amountPaid + inv.insurancePaid === 0 &&
              can('billing.invoice.void') && (
                <Button
                  color="error"
                  startIcon={<Ban size={16} />}
                  onClick={async () => {
                    const r = await confirm({
                      title: t('invoices.voidTitle', { number: inv.number }),
                      body: t('invoices.voidBody'),
                      reason: { label: t('invoices.reason'), required: true, max: 300 },
                      destructive: true,
                    });
                    if (r.confirmed)
                      run(
                        muts.void.mutateAsync({ id: inv.id, reason: r.reason ?? '' }),
                        t('invoices.voided'),
                      );
                  }}
                >
                  {t('invoices.void')}
                </Button>
              )}
          </Stack>
        }
      />
      {inv.status === 'void' && (
        <Alert severity="warning" sx={{ mb: 4 }}>
          {t('invoices.voidedNote', { reason: inv.voidReason ?? '' })}
        </Alert>
      )}
      {isDraft && (
        <Alert severity="info" sx={{ mb: 4 }}>
          {t('invoices.draftNote')}
        </Alert>
      )}
      {isDraft && !inv.dentistId && (
        <Alert severity="warning" sx={{ mb: 4 }}>
          {t('invoices.doctorMissingNote')}
        </Alert>
      )}
      {inv.multipleDoctors && (
        <Alert severity="info" variant="outlined" sx={{ mb: 4 }} data-testid="shared-invoice">
          {t('invoices.sharedNote', { names: (inv.doctors ?? []).map((d) => d.name).join(' · ') })}
        </Alert>
      )}
      <Grid container spacing={4}>
        <Grid item xs={12} lg={8}>
          <Card variant="outlined">
            <CardContent sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('invoices.description')}</TableCell>
                    <TableCell>{t('invoices.lineDoctor')}</TableCell>
                    <TableCell align="right">{t('invoices.qty')}</TableCell>
                    <TableCell align="right">{t('invoices.unitPrice')}</TableCell>
                    <TableCell align="right">{t('invoices.discount')}</TableCell>
                    <TableCell align="right">{t('invoices.tax')}</TableCell>
                    {inv.insuranceTotal > 0 && (
                      <TableCell align="right">{t('invoices.insurance')}</TableCell>
                    )}
                    <TableCell align="right">{t('invoices.lineTotal')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {inv.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell dir="auto">
                        {l.description}
                        {l.toothNumbers.length ? (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={l.toothNumbers.join(', ')}
                            sx={{ mx: 1 }}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell dir="auto">
                        {l.dentistName ?? (l.dentistId ? '' : (inv.dentist?.name ?? '—'))}
                      </TableCell>
                      <TableCell align="right">{l.quantity}</TableCell>
                      <TableCell align="right">
                        <MoneyText value={l.unitPrice} />
                      </TableCell>
                      <TableCell align="right">
                        <MoneyText value={l.discount} />
                      </TableCell>
                      <TableCell align="right">
                        <MoneyText value={l.taxAmount} />
                      </TableCell>
                      {inv.insuranceTotal > 0 && (
                        <TableCell align="right">
                          <MoneyText value={l.insuranceShare} />
                        </TableCell>
                      )}
                      <TableCell align="right">
                        <MoneyText value={l.lineTotal} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {inv.notes && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }} dir="auto">
                  {inv.notes}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Card variant="outlined">
            <CardContent>
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{ pb: 1.5, borderBottom: 1, borderColor: 'divider' }}
                >
                  <Typography variant="body2" color="text.secondary">
                    {t('invoices.responsibleDoctor')}
                  </Typography>
                  <Typography variant="body2" fontWeight={700} dir="auto">
                    {inv.dentist?.name ?? t('invoices.noDoctor')}
                  </Typography>
                </Stack>
                {(
                  [
                    ['subtotal', inv.subtotal],
                    ['discount', -inv.discountTotal],
                    ['tax', inv.taxTotal],
                    ['total', inv.total],
                    ...(inv.insuranceTotal
                      ? ([
                          ['insuranceShare', inv.insuranceTotal],
                          ['patientShare', inv.patientTotal],
                        ] as const)
                      : []),
                    ['paidByPatient', inv.amountPaid],
                    ...(inv.insurancePaid
                      ? ([['paidByInsurance', inv.insurancePaid]] as const)
                      : []),
                    ...(inv.creditedTotal ? ([['credited', -inv.creditedTotal]] as const) : []),
                    ...(inv.writtenOff ? ([['writtenOff', -inv.writtenOff]] as const) : []),
                  ] as [string, number][]
                ).map(([k, v]) => (
                  <Stack key={k} direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">
                      {t(`invoices.totals.${k}`)}
                    </Typography>
                    <MoneyText value={v} />
                  </Stack>
                ))}
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}
                >
                  <Typography variant="subtitle1" fontWeight={800}>
                    {t('invoices.totals.balance')}
                  </Typography>
                  <Typography variant="subtitle1" fontWeight={800}>
                    <MoneyText value={inv.balanceDue} />
                  </Typography>
                </Stack>
                {inv.insuranceDue > 0 && (
                  <Typography variant="caption" color="text.secondary">
                    {t('invoices.insuranceDueNote')} <MoneyText value={inv.insuranceDue} />
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
          {(inv.payments?.length ?? 0) > 0 && (
            <Card variant="outlined" sx={{ mt: 4 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  {t('invoices.payments')}
                </Typography>
                {inv.payments!.map((p) => (
                  <Stack key={p.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                    <Typography variant="body2">
                      <span dir="ltr">{p.receiptNumber ?? p.number}</span> ·{' '}
                      {t(`methods.${p.method}`)} · {formatDate(p.date, lang, 'll')}
                    </Typography>
                    <MoneyText value={p.amount} />
                  </Stack>
                ))}
              </CardContent>
            </Card>
          )}
          {(inv.creditNotes?.length ?? 0) > 0 && (
            <Card variant="outlined" sx={{ mt: 4 }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2 }}>
                  {t('invoices.creditNotes')}
                </Typography>
                {inv.creditNotes!.map((c) => (
                  <Stack key={c.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                    <Typography
                      variant="body2"
                      component={RouterLink}
                      to={`/clinic/billing/invoices/${c.id}`}
                      dir="ltr"
                    >
                      {c.number}
                    </Typography>
                    <MoneyText value={-c.total} />
                  </Stack>
                ))}
              </CardContent>
            </Card>
          )}
          {inv.einvoice && inv.einvoice.status !== 'not_sent' && (
            <Alert
              severity={
                inv.einvoice.status === 'accepted'
                  ? 'success'
                  : inv.einvoice.status === 'rejected'
                    ? 'error'
                    : 'info'
              }
              sx={{ mt: 4 }}
            >
              {t(`einvoice.status.${inv.einvoice.status}`)}
            </Alert>
          )}
        </Grid>
      </Grid>
      {editing && <InvoiceEditor invoice={inv} onClose={() => setEditing(false)} />}
      {paying && (
        <PaymentDialog
          patient={{ id: inv.patientId, fullName: inv.patient?.fullName ?? '' }}
          invoiceId={inv.id}
          onClose={() => setPaying(false)}
        />
      )}
      {printing && <InvoicePrintDialog id={inv.id} onClose={() => setPrinting(false)} />}
    </Box>
  );
}
