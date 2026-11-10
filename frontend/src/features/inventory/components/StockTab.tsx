import { Button, Chip, Grid, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { ArrowLeftRight, Plus, Trash2, Trash } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { formatDate, formatDateTime } from '@/lib/dates';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText } from '@/shared/components/MoneyText';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { ADJUSTMENT_TYPES, stockQty } from '@/shared/generated/inventory';
import { enumOf, freeText, objectId, optional, requiredText } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { fmtQty, locationsApi, newIdempotencyKey, numeric, useBalances, useMovements, usePosting, type Balance, type Movement } from '../api';

export default function StockTab() {
  const { t, i18n } = useTranslation('inventory');
  const { can } = usePermission();
  const [locationId, setLocationId] = useState('');
  const locations = locationsApi.useAll();
  const balances = useBalances({ locationId: locationId || undefined });
  const movements = useMovements({ locationId: locationId || undefined });
  const [drawer, setDrawer] = useState<'transfer' | 'adjust' | null>(null);
  const lang = i18n.language;
  const showValue = (balances.data ?? []).some((b) => b.value !== undefined);
  return (
    <Stack spacing={4}>
      <DataTable<Balance>
        clientSide
        searchable
        rows={balances.data ?? []}
        loading={balances.isLoading}
        error={balances.error}
        onRetry={() => void balances.refetch()}
        toolbar={
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField select size="small" label={t('location')} value={locationId} onChange={(e) => setLocationId(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="">{t('allLocations')}</MenuItem>
              {(locations.data ?? []).map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
            {can('inventory.stock.adjust') && (
              <>
                <Button size="small" variant="contained" startIcon={<ArrowLeftRight size={16} />} onClick={() => setDrawer('transfer')}>
                  {t('transfer.title')}
                </Button>
                <Button size="small" color="warning" startIcon={<Trash size={16} />} onClick={() => setDrawer('adjust')}>
                  {t('adjust.title')}
                </Button>
              </>
            )}
          </Stack>
        }
        empty={<EmptyState title={t('stock.empty')} description={t('stock.emptyHint')} />}
        columns={[
          { field: 'itemName', headerName: t('item.name'), flex: 1, minWidth: 180 },
          { field: 'locationName', headerName: t('location'), width: 160 },
          { field: 'lotNumber', headerName: t('lot'), width: 120, renderCell: ({ row }) => <span dir="ltr">{row.lotNumber || '—'}</span> },
          {
            field: 'expiresAt',
            headerName: t('expiresAt'),
            width: 140,
            renderCell: ({ row }) => (row.expiresAt ? <Chip size="small" color={row.expired ? 'error' : 'default'} label={row.expired ? t('expired') : formatDate(row.expiresAt, lang)} /> : '—'),
          },
          { field: 'quantity', headerName: t('quantity'), width: 140, valueGetter: (_v, row) => fmtQty(row.quantity, row.unit) },
          ...(showValue ? [{ field: 'value', headerName: t('value'), width: 130, align: 'right' as const, headerAlign: 'right' as const, renderCell: ({ row }: { row: Balance }) => <MoneyText value={row.value ?? 0} /> }] : []),
        ]}
      />
      <SectionCard title={t('movements.title')} subtitle={t('movements.hint')} noPadding>
        <DataTable<Movement>
          clientSide
          dense
          rows={movements.data ?? []}
          loading={movements.isLoading}
          error={movements.error}
          onRetry={() => void movements.refetch()}
          empty={<EmptyState title={t('movements.empty')} compact />}
          columns={[
            { field: 'at', headerName: t('date'), width: 160, valueGetter: (_v, row) => formatDateTime(row.at, lang) },
            { field: 'type', headerName: t('movements.type'), width: 170, renderCell: ({ row }) => <Chip size="small" variant="outlined" label={t(`movementTypes.${row.type}`)} /> },
            { field: 'itemName', headerName: t('item.name'), flex: 1, minWidth: 160 },
            { field: 'quantity', headerName: t('quantity'), width: 120, valueGetter: (_v, row) => fmtQty(row.quantity, row.unit) },
            {
              field: 'route',
              headerName: t('movements.route'),
              width: 220,
              sortable: false,
              renderCell: ({ row }) => (
                <Typography variant="body2" color="text.secondary">
                  {[row.fromLocationName, row.toLocationName].filter(Boolean).join(' → ') || '—'}
                </Typography>
              ),
            },
            ...((movements.data ?? []).some((m) => m.cost !== undefined)
              ? [{ field: 'cost', headerName: t('cost'), width: 120, align: 'right' as const, headerAlign: 'right' as const, renderCell: ({ row }: { row: Movement }) => <MoneyText value={row.cost ?? 0} /> }]
              : []),
          ]}
        />
      </SectionCard>
      {drawer === 'transfer' && <TransferDrawer onClose={() => setDrawer(null)} />}
      {drawer === 'adjust' && <AdjustDrawer onClose={() => setDrawer(null)} />}
    </Stack>
  );
}

/* ---------- lines picked from the balances of one location ---------- */

const balanceLine = z.object({ balanceId: z.string().min(1, { message: 'required' }), quantity: numeric(stockQty()) });
type LineValues = { balanceId: string; quantity: string };

/** Each line is a lot at the source location; tracked containers move one by one elsewhere. */
function BalanceLines({ balances }: { balances: Balance[] }) {
  const { t } = useTranslation('inventory');
  const { fields, append, remove } = useFieldArray<{ lines: LineValues[] }>({ name: 'lines' });
  const lines = useWatch<{ lines: LineValues[] }, 'lines'>({ name: 'lines' });
  const byId = useMemo(() => new Map(balances.map((b) => [b.id, b])), [balances]);
  const options = balances.filter((b) => !b.trackContainers);
  return (
    <Stack spacing={3}>
      {fields.map((f, i) => {
        const b = byId.get(lines?.[i]?.balanceId ?? '');
        return (
          <Grid container spacing={2} key={f.id} alignItems="flex-start">
            <Grid item xs={12} sm={7}>
              <Controller
                name={`lines.${i}.balanceId`}
                render={({ field, fieldState }) => (
                  <TextField select fullWidth size="small" {...field} label={`${t('transfer.lot')} *`} error={Boolean(fieldState.error)} helperText={b ? t('transfer.available', { qty: fmtQty(b.quantity, b.unit) }) : undefined}>
                    {options.map((o) => (
                      <MenuItem key={o.id} value={o.id}>
                        {`${o.itemName} · ${t('lot')} ${o.lotNumber || '—'}${o.expired ? ` · ${t('expired')}` : ''}`}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Grid>
            <Grid item xs={9} sm={4}>
              <RHFTextField name={`lines.${i}.quantity`} label={b ? `${t('quantity')} (${b.unit})` : t('quantity')} required size="small" inputProps={{ dir: 'ltr', inputMode: 'decimal' }} />
            </Grid>
            <Grid item xs={3} sm={1}>
              <Tooltip title={t('removeLine')}>
                <span>
                  <IconButton aria-label={t('removeLine')} onClick={() => remove(i)} disabled={fields.length === 1}>
                    <Trash2 size={16} />
                  </IconButton>
                </span>
              </Tooltip>
            </Grid>
          </Grid>
        );
      })}
      {options.length === 0 && <EmptyState compact title={t('transfer.noStock')} />}
      <Button startIcon={<Plus size={16} />} onClick={() => append({ balanceId: '', quantity: '' })} sx={{ alignSelf: 'flex-start' }}>
        {t('addLine')}
      </Button>
      {balances.some((x) => x.trackContainers) && (
        <Typography variant="caption" color="text.secondary">
          {t('transfer.containersElsewhere')}
        </Typography>
      )}
    </Stack>
  );
}

const toLines = (lines: { balanceId: string; quantity: number }[], byId: Map<string, Balance>) =>
  lines.map((l) => {
    const b = byId.get(l.balanceId)!;
    return { itemId: b.itemId, batchId: b.batchId, quantity: l.quantity };
  });

const transferForm = z
  .object({ fromLocationId: objectId(), toLocationId: objectId(), notes: optional(freeText(500)), lines: z.array(balanceLine).min(1, { message: 'too_few' }).max(100) })
  .superRefine((v, ctx) => {
    if (v.fromLocationId && v.fromLocationId === v.toLocationId) ctx.addIssue({ code: 'custom', path: ['toLocationId'], message: 'same_location' });
  });
type TransferValues = z.input<typeof transferForm>;

function TransferDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const locations = locationsApi.useAll();
  const post = usePosting('/inventory/transfers');
  const key = useRef(newIdempotencyKey());
  const form = useAppForm<TransferValues>({ schema: transferForm, defaultValues: { fromLocationId: '', toLocationId: '', notes: '', lines: [{ balanceId: '', quantity: '' }] } as unknown as TransferValues });
  const from = useWatch({ control: form.control, name: 'fromLocationId' });
  const balances = useBalances({ locationId: from }, Boolean(from));
  const byId = useMemo(() => new Map((balances.data ?? []).map((b) => [b.id, b])), [balances.data]);
  const locOptions = (locations.data ?? []).map((l) => ({ value: l.id, label: l.name }));
  return (
    <FormDrawer open onClose={onClose} title={t('transfer.title')} subtitle={t('transfer.hint')} formId="inv-transfer-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} submitLabel={t('transfer.submit')} width={680}>
      <Form
        form={form}
        name="inventory.transfer"
        id="inv-transfer-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof transferForm>;
          const r = await post.mutateAsync({ idempotencyKey: key.current, fromLocationId: v.fromLocationId, toLocationId: v.toLocationId, notes: v.notes || undefined, lines: toLines(v.lines, byId) });
          notify.success(t('transfer.saved', { number: r.number }));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <RHFSelect name="fromLocationId" label={t('transfer.from')} required options={locOptions} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect name="toLocationId" label={t('transfer.to')} required options={locOptions} />
            </Grid>
          </Grid>
          {from && <BalanceLines balances={balances.data ?? []} />}
          <RHFTextField name="notes" label={t('notes')} maxLength={500} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

const adjustForm = z.object({
  type: enumOf([...ADJUSTMENT_TYPES]),
  locationId: objectId(),
  reason: requiredText(500).refine((s) => s.length >= 5, { message: 'too_short' }),
  lines: z.array(balanceLine).min(1, { message: 'too_few' }).max(100),
});
type AdjustValues = z.input<typeof adjustForm>;

function AdjustDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const locations = locationsApi.useAll();
  const post = usePosting('/inventory/adjustments');
  const key = useRef(newIdempotencyKey());
  const form = useAppForm<AdjustValues>({ schema: adjustForm, defaultValues: { type: 'waste', locationId: '', reason: '', lines: [{ balanceId: '', quantity: '' }] } as unknown as AdjustValues });
  const loc = useWatch({ control: form.control, name: 'locationId' });
  const balances = useBalances({ locationId: loc }, Boolean(loc));
  const byId = useMemo(() => new Map((balances.data ?? []).map((b) => [b.id, b])), [balances.data]);
  return (
    <FormDrawer open onClose={onClose} title={t('adjust.title')} subtitle={t('adjust.hint')} formId="inv-adjust-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} submitLabel={t('adjust.submit')} width={680}>
      <Form
        form={form}
        name="inventory.adjustment"
        id="inv-adjust-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof adjustForm>;
          const r = await post.mutateAsync({ idempotencyKey: key.current, type: v.type, locationId: v.locationId, reason: v.reason, lines: toLines(v.lines, byId) });
          notify.success(t('adjust.saved', { number: r.number }));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <RHFSelect name="type" label={t('adjust.type')} required options={ADJUSTMENT_TYPES.map((x) => ({ value: x, label: t(`adjust.types.${x}`) }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect name="locationId" label={t('location')} required options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
            </Grid>
          </Grid>
          <RHFTextField name="reason" label={t('adjust.reason')} required maxLength={500} helperText={t('adjust.reasonHint')} />
          {loc && <BalanceLines balances={balances.data ?? []} />}
        </Stack>
      </Form>
    </FormDrawer>
  );
}
