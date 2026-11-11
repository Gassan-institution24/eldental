import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { FileText, PackageCheck, Plus, Trash2, XCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { suppliersApi } from '@/features/accounting/api';
import { formatDate } from '@/lib/dates';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { SectionCard } from '@/shared/components/SectionCard';
import { StatusChip } from '@/shared/components/StatusChip';
import { EmptyState } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { stockQty } from '@/shared/generated/inventory';
import { dateOnly, freeText, money, objectId, optional, requiredText } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { fmtQty, itemsApi, locationsApi, newIdempotencyKey, numeric, useCancelPo, usePosting, usePurchaseOrders, useReceipts, type GoodsReceipt, type PurchaseOrder } from '../api';
import { ItemPicker } from './ItemsTab';

const PO_TONE: Record<PurchaseOrder['status'], string> = { open: 'issued', partially_received: 'partially_paid', received: 'completed', cancelled: 'cancelled' };

export default function PurchasingTab() {
  const { t, i18n } = useTranslation('inventory');
  const { can } = usePermission();
  const notify = useNotify();
  const confirm = useConfirm();
  const canRead = ['inventory.purchase.read', 'inventory.purchase.manage', 'inventory.purchase.receive'].some((p) => can(p));
  const pos = usePurchaseOrders({}, canRead);
  const receipts = useReceipts({}, canRead || can('accounting.supplier.manage'));
  const cancel = useCancelPo();
  const [creating, setCreating] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [billing, setBilling] = useState<GoodsReceipt | null>(null);
  const lang = i18n.language;

  const doCancel = async (po: PurchaseOrder) => {
    const r = await confirm({ title: t('po.cancelTitle', { number: po.number }), destructive: true, confirmLabel: t('po.cancel'), reason: { label: t('po.cancelReason'), required: true, max: 300 } });
    if (r.confirmed) await cancel.mutateAsync({ id: po.id, reason: r.reason ?? '' }).then(() => notify.success(t('po.cancelled')), notify.error);
  };

  return (
    <Stack spacing={4}>
      <Alert severity="info">{t('po.flow')}</Alert>
      {canRead && (
        <SectionCard
          title={t('po.title')}
          noPadding
          actions={
            can('inventory.purchase.manage') && (
              <Button size="small" variant="contained" startIcon={<Plus size={16} />} onClick={() => setCreating(true)}>
                {t('po.add')}
              </Button>
            )
          }
        >
          <DataTable<PurchaseOrder>
            clientSide
            rows={pos.data ?? []}
            loading={pos.isLoading}
            error={pos.error}
            onRetry={() => void pos.refetch()}
            empty={<EmptyState title={t('po.empty')} compact />}
            columns={[
              { field: 'number', headerName: t('number'), width: 150, renderCell: ({ row }) => <span dir="ltr">{row.number}</span> },
              { field: 'supplierName', headerName: t('supplier'), flex: 1, minWidth: 160 },
              { field: 'date', headerName: t('date'), width: 130, valueGetter: (_v, row) => formatDate(row.date, lang) },
              {
                field: 'items',
                headerName: t('po.lines'),
                flex: 1,
                minWidth: 200,
                sortable: false,
                valueGetter: (_v, row) => row.lines.map((l) => `${l.itemName} ×${l.packs}`).join(', '),
              },
              { field: 'status', headerName: t('status'), width: 160, renderCell: ({ row }) => <StatusChip status={PO_TONE[row.status]} label={t(`poStatus.${row.status}`)} /> },
              { field: 'total', headerName: t('total'), width: 130, align: 'right', headerAlign: 'right', renderCell: ({ row }) => <MoneyText value={row.total} /> },
              {
                field: 'actions',
                headerName: '',
                width: 170,
                sortable: false,
                renderCell: ({ row }) => (
                  <Stack direction="row" spacing={0.5}>
                    {['open', 'partially_received'].includes(row.status) && can('inventory.purchase.receive') && (
                      <Button size="small" startIcon={<PackageCheck size={14} />} onClick={() => setReceiving(row)}>
                        {t('receipt.receive')}
                      </Button>
                    )}
                    {row.status === 'open' && can('inventory.purchase.manage') && (
                      <Tooltip title={t('po.cancel')}>
                        <IconButton size="small" aria-label={t('po.cancel')} onClick={() => void doCancel(row)}>
                          <XCircle size={14} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                ),
              },
            ]}
          />
        </SectionCard>
      )}
      <SectionCard title={t('receipt.title')} subtitle={t('receipt.hint')} noPadding>
        <DataTable<GoodsReceipt>
          clientSide
          rows={receipts.data ?? []}
          loading={receipts.isLoading}
          error={receipts.error}
          onRetry={() => void receipts.refetch()}
          empty={<EmptyState title={t('receipt.empty')} compact />}
          columns={[
            { field: 'number', headerName: t('number'), width: 170, renderCell: ({ row }) => <span dir="ltr">{row.number}</span> },
            { field: 'poNumber', headerName: t('po.number'), width: 150, renderCell: ({ row }) => <span dir="ltr">{row.poNumber}</span> },
            { field: 'supplierName', headerName: t('supplier'), flex: 1, minWidth: 150 },
            { field: 'locationName', headerName: t('location'), width: 140 },
            { field: 'date', headerName: t('date'), width: 120, valueGetter: (_v, row) => formatDate(row.date, lang) },
            { field: 'total', headerName: t('total'), width: 120, align: 'right', headerAlign: 'right', renderCell: ({ row }) => <MoneyText value={row.total} /> },
            {
              field: 'bill',
              headerName: t('receipt.bill'),
              width: 200,
              sortable: false,
              renderCell: ({ row }) =>
                row.bill ? (
                  <Typography variant="body2" dir="ltr">
                    {row.bill.number} · {row.bill.supplierRef}
                  </Typography>
                ) : can('accounting.supplier.manage') ? (
                  <Button size="small" startIcon={<FileText size={14} />} onClick={() => setBilling(row)}>
                    {t('receipt.enterBill')}
                  </Button>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    {t('receipt.notBilled')}
                  </Typography>
                ),
            },
          ]}
        />
      </SectionCard>
      {can('accounting.supplier.manage') && (
        <Typography variant="body2" color="text.secondary">
          {t('receipt.payHint')}{' '}
          <Button component={RouterLink} to="/clinic/accounting/bills" size="small">
            {t('receipt.payLink')}
          </Button>
        </Typography>
      )}
      {creating && <PoDrawer onClose={() => setCreating(false)} />}
      {receiving && <ReceiveDrawer po={receiving} onClose={() => setReceiving(null)} />}
      {billing && <BillDialog receipt={billing} onClose={() => setBilling(null)} />}
    </Stack>
  );
}

/* ---------- purchase order ---------- */

const poForm = z.object({
  supplierId: objectId(),
  expectedDate: optional(dateOnly()),
  notes: optional(freeText(1000)),
  lines: z
    .array(
      z.object({
        itemId: objectId(),
        packs: numeric(z.number({ invalid_type_error: 'invalid_quantity' }).int({ message: 'invalid_quantity' }).min(1, { message: 'invalid_quantity' }).max(10_000, { message: 'invalid_quantity' })),
        packPrice: money({ positive: true }),
      }),
    )
    .min(1, { message: 'too_few' })
    .max(100, { message: 'too_many' }),
});
type PoValues = z.input<typeof poForm>;

function PoDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const currency = useCurrency();
  const items = itemsApi.useAll();
  const suppliers = suppliersApi.useList({ limit: 100 });
  const post = usePosting<PurchaseOrder>('/purchase-orders');
  const form = useAppForm<PoValues>({ schema: poForm, defaultValues: { supplierId: '', expectedDate: '', notes: '', lines: [{ itemId: '', packs: '1', packPrice: 0 }] } as unknown as PoValues });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const byId = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const total = (lines ?? []).reduce((s, l) => s + (Number(l.packs) || 0) * (Number(l.packPrice) || 0), 0);
  return (
    <FormDrawer open onClose={onClose} title={t('po.add')} subtitle={t('po.addHint')} formId="inv-po-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} submitLabel={t('po.submit')} width={760}>
      <Form
        form={form}
        name="inventory.purchaseOrder"
        id="inv-po-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof poForm>;
          const r = await post.mutateAsync({ supplierId: v.supplierId, ...(v.expectedDate ? { expectedDate: v.expectedDate } : {}), ...(v.notes ? { notes: v.notes } : {}), lines: v.lines });
          notify.success(t('po.saved', { number: r.number }));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={7}>
              <RHFSelect name="supplierId" label={t('supplier')} required options={(suppliers.data?.data ?? []).filter((s) => s.isActive !== false).map((s) => ({ value: s.id, label: s.name }))} />
            </Grid>
            <Grid item xs={12} sm={5}>
              <RHFDate name="expectedDate" label={t('po.expected')} />
            </Grid>
          </Grid>
          {fields.map((f, i) => {
            const it = byId.get(lines?.[i]?.itemId ?? '');
            return (
              <Box key={f.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <Grid container spacing={2} alignItems="flex-start">
                  <Grid item xs={12} md={6}>
                    <ItemPicker name={`lines.${i}.itemId`} items={(items.data ?? []).filter((x) => x.isActive)} label={t('item.name')} />
                    {it && (
                      <Typography variant="caption" color="text.secondary">
                        {t('po.packOf', { pack: it.purchaseUnit || t('po.pack'), qty: fmtQty(it.unitsPerPack, it.unit) })}
                      </Typography>
                    )}
                  </Grid>
                  <Grid item xs={4} md={2}>
                    <RHFTextField name={`lines.${i}.packs`} label={t('po.packs')} required inputProps={{ dir: 'ltr', inputMode: 'numeric' }} />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <RHFMoney name={`lines.${i}.packPrice`} label={t('po.packPrice')} currency={currency} required />
                  </Grid>
                  <Grid item xs={2} md={1}>
                    <Tooltip title={t('removeLine')}>
                      <span>
                        <IconButton aria-label={t('removeLine')} onClick={() => remove(i)} disabled={fields.length === 1}>
                          <Trash2 size={16} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Grid>
                </Grid>
              </Box>
            );
          })}
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Button startIcon={<Plus size={16} />} onClick={() => append({ itemId: '', packs: '1', packPrice: 0 } as unknown as PoValues['lines'][number])}>
              {t('addLine')}
            </Button>
            <Typography variant="subtitle1">
              {t('total')}: <MoneyText value={total} />
            </Typography>
          </Stack>
          <RHFTextField name="notes" label={t('notes')} maxLength={1000} multiline minRows={2} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------- goods receipt ---------- */

const receiveForm = z.object({
  locationId: objectId(),
  lines: z
    .array(
      z
        .object({
          poLineId: objectId(),
          quantity: numeric(stockQty().optional()),
          lotNumber: optional(freeText(40)),
          expiresAt: optional(dateOnly()),
        })
        .superRefine((l, ctx) => {
          if (l.quantity && !l.lotNumber) ctx.addIssue({ code: 'custom', path: ['lotNumber'], message: 'required' });
        }),
    )
    .refine((ls) => ls.some((l) => l.quantity), { message: 'too_few' }),
});
type ReceiveValues = z.input<typeof receiveForm>;

function ReceiveDrawer({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const locations = locationsApi.useAll();
  const post = usePosting<GoodsReceipt>('/goods-receipts');
  const key = useRef(newIdempotencyKey());
  const open = po.lines.filter((l) => l.remainingQuantity > 0);
  const store = (locations.data ?? []).find((l) => l.isDefault);
  const form = useAppForm<ReceiveValues>({
    schema: receiveForm,
    defaultValues: { locationId: store?.id ?? '', lines: open.map((l) => ({ poLineId: l.id, quantity: String(l.remainingQuantity), lotNumber: '', expiresAt: '' })) } as unknown as ReceiveValues,
  });
  // The list usually arrives after the drawer opens: preselect the default warehouse then.
  useEffect(() => {
    if (store && !form.getValues('locationId')) form.setValue('locationId', store.id);
  }, [store, form]);
  return (
    <FormDrawer open onClose={onClose} title={t('receipt.receiveTitle', { number: po.number })} subtitle={t('receipt.receiveHint')} formId="inv-receive-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} submitLabel={t('receipt.submit')} width={760}>
      <Form
        form={form}
        name="inventory.receipt"
        id="inv-receive-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof receiveForm>;
          const r = await post.mutateAsync({
            idempotencyKey: key.current,
            poId: po.id,
            locationId: v.locationId,
            lines: v.lines.filter((l) => l.quantity).map((l) => ({ poLineId: l.poLineId, quantity: l.quantity, lotNumber: l.lotNumber, ...(l.expiresAt ? { expiresAt: l.expiresAt } : {}) })),
          });
          notify.success(t('receipt.saved', { number: r.number }));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFSelect name="locationId" label={t('receipt.location')} required options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          {open.map((l, i) => (
            <Box key={l.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Typography variant="subtitle2">{l.itemName}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('receipt.remaining', { qty: fmtQty(l.remainingQuantity, l.unit), ordered: fmtQty(l.orderedQuantity, l.unit) })}
                {l.trackContainers ? ` · ${t('receipt.containersHint')}` : ''}
              </Typography>
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid item xs={12} sm={4}>
                  <RHFTextField name={`lines.${i}.quantity`} label={`${t('quantity')} (${l.unit})`} inputProps={{ dir: 'ltr', inputMode: 'decimal' }} helperText={t('receipt.skipHint')} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <RHFTextField name={`lines.${i}.lotNumber`} label={t('lot')} maxLength={40} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <RHFDate name={`lines.${i}.expiresAt`} label={t('expiresAt')} />
                </Grid>
              </Grid>
            </Box>
          ))}
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------- supplier bill ---------- */

const billForm = z.object({ supplierRef: requiredText(60), billDate: optional(dateOnly()), dueDate: optional(dateOnly()) });

/** The supplier's invoice for a receipt clears GRNI (Dr GRNI / Cr AP); it never adds stock. */
function BillDialog({ receipt, onClose }: { receipt: GoodsReceipt; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const post = usePosting<{ number: string }>(() => `/goods-receipts/${receipt.id}/bill`);
  const form = useAppForm<z.input<typeof billForm>>({ schema: billForm, defaultValues: { supplierRef: '', billDate: '', dueDate: '' } });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('receipt.billTitle', { number: receipt.number })}</DialogTitle>
      <Form
        form={form}
        name="inventory.receiptBill"
        id="inv-bill-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof billForm>;
          const r = await post.mutateAsync({ supplierRef: v.supplierRef, ...(v.billDate ? { billDate: v.billDate } : {}), ...(v.dueDate ? { dueDate: v.dueDate } : {}) });
          notify.success(t('receipt.billed', { number: r.number }));
          onClose();
        }}
      >
        <DialogContent>
          <Stack spacing={3}>
            <Typography variant="body2">
              {t('receipt.billBody', { supplier: receipt.supplierName })} <MoneyText value={receipt.total} />
            </Typography>
            <RHFTextField name="supplierRef" label={t('receipt.supplierRef')} required maxLength={60} inputProps={{ dir: 'ltr' }} />
            <Grid container spacing={2}>
              <Grid item xs={6}>
                <RHFDate name="billDate" label={t('receipt.billDate')} />
              </Grid>
              <Grid item xs={6}>
                <RHFDate name="dueDate" label={t('receipt.dueDate')} />
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
            {t('receipt.postBill')}
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}
