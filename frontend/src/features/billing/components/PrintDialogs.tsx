import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PrintArea } from '@/features/clinical/components/shared';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useFormatMoney } from '@/shared/components/MoneyText';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { fetchInvoicePrint, fetchReceipt, type InvoicePrint, type ReceiptPrint } from '../api';

export function PrintShell({
  title,
  onClose,
  ready,
  error,
  children,
}: {
  title?: string;
  onClose: () => void;
  ready: boolean;
  error?: unknown;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md" aria-label={title}>
      <DialogContent>
        {error ? (
          <ErrorState error={error} compact />
        ) : !ready ? (
          <PageSkeleton rows={5} />
        ) : (
          <PrintArea>{children}</PrintArea>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('actions.close')}</Button>
        <Button
          variant="contained"
          startIcon={<Printer size={16} />}
          onClick={() => window.print()}
          disabled={!ready}
        >
          {t('actions.print')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function Letterhead({
  clinic,
  title,
  number,
  date,
}: {
  clinic?: { name: string; phone?: string; addressLine1?: string; taxNumber?: string } | null;
  title: string;
  number?: string;
  date?: string;
}) {
  const { t, i18n } = useTranslation('billing');
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
      <Box>
        <Typography variant="h4">{clinic?.name}</Typography>
        <Typography variant="body2">
          {[clinic?.addressLine1, clinic?.phone].filter(Boolean).join(' · ')}
        </Typography>
        {clinic?.taxNumber && (
          <Typography variant="body2">{t('print.taxNumber', { n: clinic.taxNumber })}</Typography>
        )}
      </Box>
      <Box sx={{ textAlign: 'end' }}>
        <Typography variant="h5">{title}</Typography>
        <Typography variant="body2" dir="ltr">
          {number}
        </Typography>
        {date && <Typography variant="body2">{formatDate(date, i18n.language)}</Typography>}
      </Box>
    </Stack>
  );
}

/** `fetcher` lets the patient portal print through its own patient-scoped endpoint. */
export function InvoicePrintDialog({
  id,
  onClose,
  fetcher = fetchInvoicePrint,
}: {
  id: string;
  onClose: () => void;
  fetcher?: (id: string) => Promise<InvoicePrint>;
}) {
  const { t } = useTranslation('billing');
  const fmt = useFormatMoney();
  const q = useQuery({ queryKey: ['invoice-print', id], queryFn: () => fetcher(id) });
  const d = q.data;
  const inv = d?.invoice;
  return (
    <PrintShell onClose={onClose} ready={Boolean(d)} error={q.error}>
      {inv && (
        <>
          <Letterhead
            clinic={d.clinic}
            title={
              inv.type === 'credit_note'
                ? t('print.creditNote')
                : inv.status === 'draft'
                  ? t('print.proforma')
                  : t('print.invoice')
            }
            number={inv.number}
            date={inv.issueDate}
          />
          <Divider sx={{ my: 3 }} />
          <Typography variant="body1">
            <b>{t('print.billTo')}:</b> {d.patient?.fullName} · {d.patient?.fileNumber}{' '}
            {d.patient?.phone ? <span dir="ltr">· {d.patient.phone}</span> : null}
          </Typography>
          <Table size="small" sx={{ mt: 3 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('invoices.description')}</TableCell>
                <TableCell align="right">{t('invoices.qty')}</TableCell>
                <TableCell align="right">{t('invoices.unitPrice')}</TableCell>
                <TableCell align="right">{t('invoices.discount')}</TableCell>
                <TableCell align="right">{t('invoices.tax')}</TableCell>
                <TableCell align="right">{t('invoices.lineTotal')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {inv.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    {l.description}
                    {l.toothNumbers.length ? ` (${l.toothNumbers.join(', ')})` : ''}
                  </TableCell>
                  <TableCell align="right">{l.quantity}</TableCell>
                  <TableCell align="right">{fmt(l.unitPrice)}</TableCell>
                  <TableCell align="right">{fmt(l.discount)}</TableCell>
                  <TableCell align="right">{fmt(l.taxAmount)}</TableCell>
                  <TableCell align="right">{fmt(l.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Stack alignItems="flex-end" spacing={0.5} sx={{ mt: 3 }}>
            {[
              ['subtotal', inv.subtotal],
              ['discount', inv.discountTotal],
              ['tax', inv.taxTotal],
              ['total', inv.total],
              ...(inv.insuranceTotal
                ? [
                    ['insurance', inv.insuranceTotal],
                    ['patientShare', inv.patientTotal],
                  ]
                : []),
              ['paid', inv.amountPaid + inv.insurancePaid],
              ['balance', inv.balanceDue],
            ].map(([k, v]) => (
              <Typography
                key={k as string}
                variant={k === 'total' || k === 'balance' ? 'subtitle1' : 'body2'}
                fontWeight={k === 'total' || k === 'balance' ? 800 : 400}
              >
                {t(`print.${k as string}`)}: {fmt(v as number)}
              </Typography>
            ))}
          </Stack>
          {inv.einvoice?.qr && (
            <Box sx={{ mt: 3 }}>
              <img
                src={`data:image/png;base64,${inv.einvoice.qr}`}
                alt={t('print.einvoiceQr')}
                style={{ width: 120, height: 120 }}
              />
            </Box>
          )}
          {d.clinic?.settings?.invoiceFooter && (
            <Typography
              variant="caption"
              sx={{ display: 'block', mt: 4, whiteSpace: 'pre-wrap' }}
              dir="auto"
            >
              {d.clinic.settings.invoiceFooter}
            </Typography>
          )}
        </>
      )}
    </PrintShell>
  );
}

export function ReceiptPrintDialog({
  id,
  onClose,
  fetcher = fetchReceipt,
}: {
  id: string;
  onClose: () => void;
  fetcher?: (id: string) => Promise<ReceiptPrint>;
}) {
  const { t, i18n } = useTranslation('billing');
  const fmt = useFormatMoney();
  const q = useQuery({ queryKey: ['receipt-print', id], queryFn: () => fetcher(id) });
  const d = q.data;
  const p = d?.payment;
  return (
    <PrintShell onClose={onClose} ready={Boolean(d)} error={q.error}>
      {p && (
        <>
          <Letterhead
            clinic={d.clinic}
            title={t('print.receipt')}
            number={p.receiptNumber}
            date={p.date}
          />
          <Divider sx={{ my: 3 }} />
          <Stack spacing={1}>
            <Typography>
              <b>{t('print.receivedFrom')}:</b> {p.patient?.fullName} · {p.patient?.fileNumber}
            </Typography>
            <Typography>
              <b>{t('payments.amount')}:</b> {fmt(p.amount)} — {t(`methods.${p.method}`)}
              {p.cheque?.number ? ` (${t('payments.chequeNumber')} ${p.cheque.number})` : ''}
            </Typography>
            {p.allocations.length > 0 && (
              <Typography>
                <b>{t('print.forInvoices')}:</b>{' '}
                {p.allocations.map((a) => `${a.invoiceNumber ?? ''} (${fmt(a.amount)})`).join(', ')}
              </Typography>
            )}
            {p.unallocated > 0 && (
              <Typography>
                <b>{t('payments.toCredit')}:</b> {fmt(p.unallocated)}
              </Typography>
            )}
            {d.balanceAfter !== null && (
              <Typography>
                <b>{t('print.balanceNow')}:</b> {fmt(d.balanceAfter)}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              {formatDateTime(p.receivedAt, i18n.language)}
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ mt: 8 }}>
            {t('print.signature')}: ____________
          </Typography>
        </>
      )}
    </PrintShell>
  );
}
