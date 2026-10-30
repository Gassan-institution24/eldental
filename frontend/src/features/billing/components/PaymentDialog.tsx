import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PatientPicker } from '@/features/patients/components/PatientPicker';
import { formatDate, todayLocal } from '@/lib/dates';
import { dateOnly, freeText, objectId, optional } from '@/shared/generated/validation/fields';
import { MoneyInput } from '@/shared/form/MoneyInput';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { Form } from '@/shared/form/Form';
import { RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import {
  PAYMENT_METHODS,
  useBillingSummary,
  useCashSession,
  usePaymentMutations,
  type Payment,
} from '../api';

const schema = z
  .object({
    patient: z
      .object({ id: objectId(), fullName: z.string() })
      .nullable()
      .refine((v) => v !== null, { message: 'required' }),
    method: z.enum(PAYMENT_METHODS),
    amount: z
      .number({ invalid_type_error: 'invalid_amount' })
      .int({ message: 'too_many_decimals' })
      .min(1, { message: 'must_be_positive' }),
    date: dateOnly(),
    reference: optional(freeText(80)),
    chequeNumber: optional(freeText(40)),
    chequeBank: optional(freeText(80)),
    chequeDue: optional(dateOnly()),
    notes: optional(freeText(500)),
  })
  .superRefine((v, ctx) => {
    if (v.method === 'cheque' && !v.chequeNumber)
      ctx.addIssue({ code: 'custom', path: ['chequeNumber'], message: 'required' });
  });
type Values = z.input<typeof schema>;

/** Record a patient payment and choose which invoices it settles (09 §3.2). */
export function PaymentDialog({
  patient,
  invoiceId,
  onClose,
  onDone,
}: {
  patient?: { id: string; fullName: string };
  invoiceId?: string;
  onClose: () => void;
  onDone?: (p: Payment) => void;
}) {
  const { t } = useTranslation('billing');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const currency = useCurrency();
  const muts = usePaymentMutations();
  const cash = useCashSession();
  // One key per dialog: retries after a network error never double-charge.
  const key = useRef(crypto.randomUUID());
  const form = useAppForm<Values>({
    schema,
    defaultValues: {
      patient: patient ?? null,
      method: 'cash',
      amount: 0,
      date: todayLocal(),
      reference: '',
      chequeNumber: '',
      chequeBank: '',
      chequeDue: '',
      notes: '',
    },
  });
  const chosen = useWatch({ control: form.control, name: 'patient' });
  const method = useWatch({ control: form.control, name: 'method' });
  const amount = Number(useWatch({ control: form.control, name: 'amount' })) || 0;
  const summary = useBillingSummary(chosen?.id);
  const open = useMemo(
    () => summary.data?.openInvoices.filter((i) => i.patientDue > 0) ?? [],
    [summary.data],
  );
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState(false);

  // Pre-fill: the invoice we came from (its patient share), else oldest first.
  useEffect(() => {
    if (!open.length) return;
    const target = invoiceId ? open.find((i) => i.id === invoiceId) : undefined;
    if (target && !form.getValues('amount')) form.setValue('amount', target.patientDue);
  }, [open, invoiceId, form]);
  useEffect(() => {
    if (touched) return;
    let left = amount;
    const next: Record<string, number> = {};
    const ordered = invoiceId ? [...open].sort((a) => (a.id === invoiceId ? -1 : 1)) : open;
    for (const i of ordered) {
      const take = Math.min(left, i.patientDue);
      if (take > 0) next[i.id] = take;
      left -= take;
    }
    setAlloc(next);
  }, [amount, open, invoiceId, touched]);
  const allocated = Object.values(alloc).reduce((s, n) => s + n, 0);
  const overAllocated = allocated > amount || open.some((i) => (alloc[i.id] ?? 0) > i.patientDue);
  const needsDrawer = method === 'cash' && !cash.isLoading && !cash.data;

  const onSubmit = async (raw: Values) => {
    const v = raw as z.output<typeof schema>;
    const p = await muts.create.mutateAsync({
      idempotencyKey: key.current,
      payerType: 'patient',
      patientId: v.patient!.id,
      method: v.method,
      amount: v.amount,
      date: v.date,
      ...(v.reference ? { reference: v.reference } : {}),
      ...(v.method === 'cheque'
        ? {
            cheque: {
              number: v.chequeNumber,
              ...(v.chequeBank ? { bank: v.chequeBank } : {}),
              ...(v.chequeDue ? { dueDate: v.chequeDue } : {}),
            },
          }
        : {}),
      allocations: Object.entries(alloc)
        .filter(([, a]) => a > 0)
        .map(([invoiceId, a]) => ({ invoiceId, amount: a })),
      ...(v.notes ? { notes: v.notes } : {}),
    });
    notify.success(t('payments.recorded', { number: p.receiptNumber }));
    onDone?.(p);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('payments.new')}</DialogTitle>
      <DialogContent>
        <Form form={form} name="billing.payment" id="payment-form" onSubmit={onSubmit}>
          <Stack spacing={4} sx={{ pt: 1 }}>
            <Grid container spacing={3}>
              <Grid item xs={12} md={6}>
                <Controller
                  name="patient"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Box data-field="patient">
                      <PatientPicker
                        name="patient"
                        value={field.value ?? null}
                        onChange={(v) => {
                          setTouched(false);
                          field.onChange(v);
                        }}
                        required
                        error={Boolean(fieldState.error)}
                        helperText={fieldState.error ? t('invoices.patientRequired') : undefined}
                      />
                    </Box>
                  )}
                />
              </Grid>
              <Grid item xs={6} md={3}>
                <RHFSelect
                  name="method"
                  label={t('payments.method')}
                  required
                  options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
                />
              </Grid>
              <Grid item xs={6} md={3}>
                <RHFDate name="date" label={t('payments.date')} required />
              </Grid>
              <Grid item xs={12} md={6}>
                <RHFMoney currency={currency} name="amount" label={t('payments.amount')} required />
              </Grid>
              <Grid item xs={12} md={6}>
                <RHFTextField name="reference" label={t('payments.reference')} maxLength={80} />
              </Grid>
              {method === 'cheque' && (
                <>
                  <Grid item xs={12} md={4}>
                    <RHFTextField
                      name="chequeNumber"
                      label={t('payments.chequeNumber')}
                      required
                      maxLength={40}
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <RHFTextField
                      name="chequeBank"
                      label={t('payments.chequeBank')}
                      maxLength={80}
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <RHFDate name="chequeDue" label={t('payments.chequeDue')} />
                  </Grid>
                </>
              )}
            </Grid>
            {needsDrawer && <Alert severity="warning">{t('payments.openDrawerFirst')}</Alert>}
            {summary.data && (
              <Box>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">{t('payments.allocate')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('payments.balance')}: <MoneyText value={summary.data.balance} />
                  </Typography>
                </Stack>
                {open.length === 0 ? (
                  <Alert severity="info">{t('payments.noOpenInvoices')}</Alert>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('invoices.number')}</TableCell>
                        <TableCell>{t('invoices.issueDate')}</TableCell>
                        <TableCell align="right">{t('invoices.patientDue')}</TableCell>
                        <TableCell align="right" sx={{ width: 180 }}>
                          {t('payments.apply')}
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {open.map((i) => (
                        <TableRow key={i.id} selected={i.id === invoiceId}>
                          <TableCell dir="ltr">{i.number}</TableCell>
                          <TableCell>{formatDate(i.issueDate, 'en', 'DD/MM/YYYY')}</TableCell>
                          <TableCell align="right">
                            <MoneyText value={i.patientDue} />
                          </TableCell>
                          <TableCell align="right">
                            <MoneyInput
                              size="small"
                              value={alloc[i.id] ?? 0}
                              currency={currency}
                              onChange={(v) => {
                                setTouched(true);
                                setAlloc({ ...alloc, [i.id]: typeof v === 'number' ? v : 0 });
                              }}
                              error={(alloc[i.id] ?? 0) > i.patientDue}
                              inputProps={{
                                'aria-label': t('payments.applyTo', { number: i.number }),
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <Stack direction="row" spacing={3} justifyContent="flex-end" sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    {t('payments.allocated')}: <MoneyText value={allocated} />
                  </Typography>
                  <Typography
                    variant="body2"
                    color={amount - allocated > 0 ? 'info.main' : 'text.secondary'}
                  >
                    {t('payments.toCredit')}: <MoneyText value={Math.max(0, amount - allocated)} />
                  </Typography>
                </Stack>
                {overAllocated && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {t('payments.overAllocated')}
                  </Alert>
                )}
              </Box>
            )}
            <RHFTextField name="notes" label={t('payments.notes')} maxLength={500} />
          </Stack>
        </Form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          type="submit"
          form="payment-form"
          variant="contained"
          disabled={overAllocated || needsDrawer || muts.create.isPending}
        >
          {t('payments.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
