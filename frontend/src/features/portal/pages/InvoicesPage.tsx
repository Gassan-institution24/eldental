import { Box, Button, Card, Grid, Stack, Tab, Tabs, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Printer, ReceiptText, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InvoicePrintDialog, ReceiptPrintDialog } from '@/features/billing/components/PrintDialogs';
import { formatDate } from '@/lib/dates';
import { MoneyText } from '@/shared/components/MoneyText';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import {
  fetchPortalInvoicePrint,
  fetchPortalReceipt,
  usePortalBilling,
  usePortalMe,
  type PortalBilling,
} from '../api';
import { LinkFilePrompt, PortalHeader } from '../components';

function BalanceCard({ b }: { b: PortalBilling['balances'][number] }) {
  const { t } = useTranslation('patient');
  const owes = b.balance > 0;
  return (
    <Card
      sx={(th) => ({
        p: 5,
        height: '100%',
        borderColor: owes ? alpha(th.palette.error.main, 0.4) : 'divider',
      })}
    >
      <Typography variant="body2" color="text.secondary" dir="auto" noWrap>
        {b.patient.fullName} · {b.clinic?.name}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {owes
          ? t('portal.billing.owes')
          : b.balance < 0
            ? t('portal.billing.credit')
            : t('portal.billing.settled')}
      </Typography>
      <Box sx={{ mt: 1 }}>
        <MoneyText
          value={Math.abs(b.balance)}
          sx={{ fontSize: 28, fontWeight: 800, color: owes ? 'error.main' : 'success.main' }}
        />
      </Box>
    </Card>
  );
}

function Row({
  title,
  status,
  lines,
  amount,
  sub,
  onPrint,
  printLabel,
}: {
  title: string;
  status: string;
  lines: string[];
  amount: number;
  sub?: React.ReactNode;
  onPrint: () => void;
  printLabel: string;
}) {
  return (
    <Card sx={{ p: { xs: 4, md: 5 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            <Typography fontWeight={800} dir="ltr">
              {title}
            </Typography>
            <StatusChip status={status} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} dir="auto">
            {lines.filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Box sx={{ textAlign: { sm: 'end' } }}>
          <MoneyText value={amount} sx={{ fontWeight: 800, fontSize: 18 }} />
          {sub}
        </Box>
        <Button variant="outlined" size="small" startIcon={<Printer size={16} />} onClick={onPrint}>
          {printLabel}
        </Button>
      </Stack>
    </Card>
  );
}

/** Invoices, receipts and balances across the account's files (01 §4.10). */
export function InvoicesPage() {
  const { t, i18n } = useTranslation('patient');
  const lang = i18n.language;
  const me = usePortalMe();
  const q = usePortalBilling();
  const [tab, setTab] = useState<'invoices' | 'payments'>('invoices');
  const [printing, setPrinting] = useState<{ kind: 'invoice' | 'receipt'; id: string } | null>(
    null,
  );
  const d = q.data;

  return (
    <>
      <PortalHeader title={t('portal.billing.title')} subtitle={t('portal.billing.subtitle')} />
      {q.isLoading || me.isLoading ? (
        <PageSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !me.data?.patients.length || !d ? (
        <LinkFilePrompt />
      ) : (
        <>
          <Grid container spacing={4} sx={{ mb: 6 }}>
            {d.balances.map((b) => (
              <Grid item xs={12} sm={6} lg={4} xl={3} key={b.patient.id}>
                <BalanceCard b={b} />
              </Grid>
            ))}
          </Grid>
          <Tabs
            value={tab}
            onChange={(_e, v: 'invoices' | 'payments') => setTab(v)}
            sx={{ mb: 4, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab
              value="invoices"
              label={`${t('portal.billing.invoices')} (${d.invoices.length})`}
            />
            <Tab
              value="payments"
              label={`${t('portal.billing.payments')} (${d.payments.length})`}
            />
          </Tabs>
          {tab === 'invoices' ? (
            d.invoices.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<ReceiptText size={30} />}
                  title={t('portal.billing.emptyInvoices')}
                />
              </Card>
            ) : (
              <Stack spacing={3}>
                {d.invoices.map((i) => (
                  <Row
                    key={i.id}
                    title={i.number}
                    status={i.status}
                    lines={[
                      i.type === 'credit_note' ? t('portal.billing.creditNote') : '',
                      i.issueDate ? formatDate(i.issueDate, lang) : '',
                      i.patient.fullName,
                      i.clinic?.name ?? '',
                    ]}
                    amount={i.patientTotal}
                    sub={
                      i.patientDue > 0 ? (
                        <Typography variant="caption" color="error.main" display="block">
                          {t('portal.billing.due')}: <MoneyText value={i.patientDue} />
                        </Typography>
                      ) : null
                    }
                    onPrint={() => setPrinting({ kind: 'invoice', id: i.id })}
                    printLabel={t('portal.billing.print')}
                  />
                ))}
              </Stack>
            )
          ) : d.payments.length === 0 ? (
            <Card>
              <EmptyState icon={<Wallet size={30} />} title={t('portal.billing.emptyPayments')} />
            </Card>
          ) : (
            <Stack spacing={3}>
              {d.payments.map((p) => (
                <Row
                  key={p.id}
                  title={p.receiptNumber ?? p.number}
                  status={p.status}
                  lines={[
                    formatDate(p.date, lang),
                    t(`billing:methods.${p.method}`, { defaultValue: p.method }),
                    p.patient?.fullName ?? '',
                    p.clinic?.name ?? '',
                  ]}
                  amount={p.amount}
                  onPrint={() => setPrinting({ kind: 'receipt', id: p.id })}
                  printLabel={t('portal.billing.receipt')}
                />
              ))}
            </Stack>
          )}
        </>
      )}
      {printing?.kind === 'invoice' && (
        <InvoicePrintDialog
          id={printing.id}
          onClose={() => setPrinting(null)}
          fetcher={fetchPortalInvoicePrint}
        />
      )}
      {printing?.kind === 'receipt' && (
        <ReceiptPrintDialog
          id={printing.id}
          onClose={() => setPrinting(null)}
          fetcher={fetchPortalReceipt}
        />
      )}
    </>
  );
}
