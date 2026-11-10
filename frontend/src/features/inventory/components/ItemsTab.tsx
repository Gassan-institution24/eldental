import { Alert, Autocomplete, Box, Button, Chip, Grid, IconButton, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { suppliersApi } from '@/features/accounting/api';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { useCurrency } from '@/shared/components/MoneyText';
import { EmptyState } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { checkItemContainers, CONTAINER_POLICIES, ITEM_TYPES, stockQty, stockQtyOrZero } from '@/shared/generated/inventory';
import { dateOnly, entityName, enumOf, freeText, money, objectId, optional, requiredText } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { fmtQty, itemsApi, locationsApi, newIdempotencyKey, numeric, usePosting, type InventoryItem } from '../api';

/* ---------- catalog ---------- */

export default function ItemsTab() {
  const { t } = useTranslation('inventory');
  const { can } = usePermission();
  const [low, setLow] = useState(false);
  const [type, setType] = useState('');
  const list = itemsApi.useAll({ low: low ? 'true' : undefined, type: type || undefined });
  const [editing, setEditing] = useState<InventoryItem | 'new' | null>(null);
  const [opening, setOpening] = useState(false);
  const manage = can('inventory.item.manage');
  return (
    <Box>
      <DataTable<InventoryItem>
        clientSide
        searchable
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => manage && setEditing(r)}
        toolbar={
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <TextField select size="small" label={t('item.type')} value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 160 }}>
              <MenuItem value="">{t('all')}</MenuItem>
              {ITEM_TYPES.map((x) => (
                <MenuItem key={x} value={x}>
                  {t(`itemTypes.${x}`)}
                </MenuItem>
              ))}
            </TextField>
            <Button size="small" variant={low ? 'contained' : 'outlined'} color="warning" onClick={() => setLow(!low)}>
              {t('item.lowOnly')}
            </Button>
            {manage && (
              <Button size="small" variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
                {t('item.add')}
              </Button>
            )}
            {can('inventory.stock.adjust') && (
              <Button size="small" startIcon={<PackagePlus size={16} />} onClick={() => setOpening(true)}>
                {t('opening.title')}
              </Button>
            )}
          </Stack>
        }
        empty={<EmptyState title={t('item.empty')} description={manage ? t('item.emptyHint') : undefined} />}
        columns={[
          {
            field: 'name',
            headerName: t('item.name'),
            flex: 1,
            minWidth: 200,
            renderCell: ({ row }) => (
              <Box>
                <Typography variant="body2">{row.name}</Typography>
                {row.sku && (
                  <Typography variant="caption" color="text.secondary" dir="ltr">
                    {row.sku}
                  </Typography>
                )}
              </Box>
            ),
          },
          { field: 'type', headerName: t('item.type'), width: 130, valueGetter: (_v, row) => t(`itemTypes.${row.type}`) },
          { field: 'category', headerName: t('item.category'), width: 140 },
          {
            field: 'quantityOnHand',
            headerName: t('item.onHand'),
            width: 150,
            renderCell: ({ row }) => <Chip size="small" color={row.reorderLevel > 0 && row.quantityOnHand <= row.reorderLevel ? 'warning' : 'default'} label={fmtQty(row.quantityOnHand, row.unit)} />,
          },
          { field: 'reorderLevel', headerName: t('item.reorderLevel'), width: 130, valueGetter: (_v, row) => fmtQty(row.reorderLevel, row.unit) },
          {
            field: 'containerPolicy',
            headerName: t('item.containers'),
            width: 150,
            renderCell: ({ row }) => (row.trackContainers ? <Chip size="small" variant="outlined" label={t(`policies.${row.containerPolicy}`)} /> : '—'),
          },
        ]}
      />
      {editing && <ItemDrawer item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {opening && <OpeningStockDrawer onClose={() => setOpening(false)} />}
    </Box>
  );
}

/* ---------- item form ---------- */

const itemForm = z
  .object({
    name: entityName({ max: 120 }),
    sku: optional(freeText(30)),
    category: optional(freeText(60)),
    type: enumOf([...ITEM_TYPES]),
    unit: requiredText(20),
    purchaseUnit: optional(freeText(20)),
    unitsPerPack: numeric(stockQty()),
    reorderLevel: numeric(stockQtyOrZero()),
    trackContainers: z.boolean(),
    containerPolicy: enumOf([...CONTAINER_POLICIES]),
    containerCapacity: numeric(stockQty().optional()),
    supplierId: optional(objectId()),
    notes: optional(freeText(500)),
    isActive: z.boolean(),
  })
  .superRefine(checkItemContainers);
type ItemValues = z.input<typeof itemForm>;

function ContainerFields({ locked }: { locked: boolean }) {
  const { t } = useTranslation('inventory');
  const { getValues, setValue } = useFormContext<ItemValues>();
  const [track, unit] = useWatch<ItemValues, ['trackContainers', 'unit']>({ name: ['trackContainers', 'unit'] });
  // The switch and the policy always agree: on → a real policy, off → none.
  useEffect(() => {
    const policy = getValues('containerPolicy');
    if (track && policy === 'none') setValue('containerPolicy', 'general');
    if (!track && policy !== 'none') setValue('containerPolicy', 'none');
  }, [track, getValues, setValue]);
  return (
    <Stack spacing={3}>
      <RHFCheckbox name="trackContainers" label={t('item.trackContainers')} asSwitch disabled={locked} helperText={t('item.trackContainersHint')} />
      {track && (
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <RHFSelect
              name="containerPolicy"
              label={t('item.policy')}
              required
              disabled={locked}
              options={CONTAINER_POLICIES.filter((p) => p !== 'none').map((p) => ({ value: p, label: t(`policies.${p}`) }))}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField name="containerCapacity" label={t('item.capacity', { unit: unit || '…' })} disabled={locked} inputProps={{ dir: 'ltr', inputMode: 'decimal' }} helperText={t('item.capacityHint')} />
          </Grid>
          <Grid item xs={12}>
            <PolicyHint />
          </Grid>
        </Grid>
      )}
    </Stack>
  );
}

function PolicyHint() {
  const { t } = useTranslation('inventory');
  const policy = useWatch<ItemValues, 'containerPolicy'>({ name: 'containerPolicy' });
  return policy && policy !== 'none' ? <Alert severity={policy === 'general' ? 'info' : 'warning'}>{t(`policyHints.${policy}`)}</Alert> : null;
}

function ItemDrawer({ item, onClose }: { item: InventoryItem | null; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const create = itemsApi.useCreate();
  const update = itemsApi.useUpdate();
  const suppliers = suppliersApi.useList({ limit: 100 });
  // Units and container rules are fixed once the item has stock (the API enforces it too).
  const locked = Boolean(item && item.quantityOnHand > 0);
  const form = useAppForm<ItemValues>({
    schema: itemForm,
    defaultValues: {
      name: item?.name ?? '',
      sku: item?.sku ?? '',
      category: item?.category ?? '',
      type: item?.type ?? 'consumable',
      unit: item?.unit ?? '',
      purchaseUnit: item?.purchaseUnit ?? '',
      unitsPerPack: item ? String(item.unitsPerPack) : '1',
      reorderLevel: item ? String(item.reorderLevel) : '0',
      trackContainers: item?.trackContainers ?? false,
      containerPolicy: item?.containerPolicy ?? 'none',
      containerCapacity: item?.containerCapacity !== undefined ? String(item.containerCapacity) : '',
      supplierId: item?.supplierId ?? '',
      notes: item?.notes ?? '',
      isActive: item?.isActive ?? true,
    } as unknown as ItemValues,
  });
  return (
    <FormDrawer open onClose={onClose} title={item ? t('item.edit') : t('item.add')} formId="inv-item-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} width={620}>
      <Form
        form={form}
        name="inventory.item"
        id="inv-item-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof itemForm>;
          const payload = {
            ...v,
            sku: v.sku || undefined,
            supplierId: v.supplierId || undefined,
            containerCapacity: v.trackContainers ? (v.containerCapacity ?? v.unitsPerPack) : undefined,
          };
          if (locked) for (const f of ['unit', 'unitsPerPack', 'trackContainers', 'containerPolicy', 'containerCapacity'] as const) delete (payload as Record<string, unknown>)[f];
          if (item) await update.mutateAsync({ id: item.id, version: item.version, ...(payload as Partial<InventoryItem>) });
          else await create.mutateAsync(payload as Partial<InventoryItem>);
          notify.success(t('item.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={8}>
              <RHFTextField name="name" label={t('item.name')} required maxLength={120} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <RHFTextField name="sku" label={t('item.sku')} maxLength={30} inputProps={{ dir: 'ltr' }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect name="type" label={t('item.type')} required options={ITEM_TYPES.map((x) => ({ value: x, label: t(`itemTypes.${x}`) }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFTextField name="category" label={t('item.category')} maxLength={60} />
            </Grid>
          </Grid>
          {locked && <Alert severity="info">{t('item.lockedHint')}</Alert>}
          <Grid container spacing={3}>
            <Grid item xs={12} sm={4}>
              <RHFTextField name="unit" label={t('item.unit')} required maxLength={20} disabled={locked} helperText={t('item.unitHint')} />
            </Grid>
            <Grid item xs={6} sm={4}>
              <RHFTextField name="purchaseUnit" label={t('item.purchaseUnit')} maxLength={20} helperText={t('item.purchaseUnitHint')} />
            </Grid>
            <Grid item xs={6} sm={4}>
              <RHFTextField name="unitsPerPack" label={t('item.unitsPerPack')} required disabled={locked} inputProps={{ dir: 'ltr', inputMode: 'decimal' }} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFTextField name="reorderLevel" label={t('item.reorderLevel')} inputProps={{ dir: 'ltr', inputMode: 'decimal' }} helperText={t('item.reorderHint')} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect name="supplierId" label={t('item.supplier')} clearable options={(suppliers.data?.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            </Grid>
          </Grid>
          <ContainerFields locked={locked} />
          <RHFTextField name="notes" label={t('item.notes')} maxLength={500} multiline minRows={2} />
          <RHFCheckbox name="isActive" label={t('item.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------- opening stock ---------- */

const openingForm = z.object({
  locationId: objectId(),
  lines: z
    .array(
      z.object({
        itemId: objectId(),
        quantity: numeric(stockQty()),
        unitCost: money(),
        lotNumber: optional(freeText(40)),
        expiresAt: optional(dateOnly()),
      }),
    )
    .min(1, { message: 'too_few' })
    .max(200, { message: 'too_many' }),
});
type OpeningValues = z.input<typeof openingForm>;

export function ItemPicker({ name, items, label }: { name: string; items: InventoryItem[]; label: string }) {
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return (
    <Controller
      name={name}
      render={({ field, fieldState }) => (
        <Autocomplete
          size="small"
          options={items}
          value={byId.get(field.value as string) ?? null}
          onChange={(_e, v) => field.onChange(v?.id ?? '')}
          getOptionLabel={(o) => (o.sku ? `${o.name} · ${o.sku}` : o.name)}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(p) => <TextField {...p} name={field.name} label={`${label} *`} error={Boolean(fieldState.error)} />}
        />
      )}
    />
  );
}

function OpeningStockDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const currency = useCurrency();
  const items = itemsApi.useAll();
  const locations = locationsApi.useAll();
  const post = usePosting('/inventory/opening-stock');
  const key = useRef(newIdempotencyKey());
  const store = (locations.data ?? []).find((l) => l.isDefault);
  const form = useAppForm<OpeningValues>({
    schema: openingForm,
    defaultValues: { locationId: store?.id ?? '', lines: [{ itemId: '', quantity: '', unitCost: 0, lotNumber: '', expiresAt: '' }] } as unknown as OpeningValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  return (
    <FormDrawer open onClose={onClose} title={t('opening.title')} subtitle={t('opening.hint')} formId="inv-opening-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} submitLabel={t('opening.submit')} width={860}>
      <Form
        form={form}
        name="inventory.opening"
        id="inv-opening-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof openingForm>;
          const r = await post.mutateAsync({ idempotencyKey: key.current, locationId: v.locationId, lines: v.lines.map((l) => ({ ...l, lotNumber: l.lotNumber || undefined, expiresAt: l.expiresAt || undefined })) });
          notify.success(t('opening.saved', { number: r.number }));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFSelect name="locationId" label={t('location')} required options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
          {fields.map((f, i) => (
            <Box key={f.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Grid container spacing={2} alignItems="flex-start">
                <Grid item xs={12} md={4}>
                  <ItemPicker name={`lines.${i}.itemId`} items={items.data ?? []} label={t('item.name')} />
                </Grid>
                <Grid item xs={6} md={2}>
                  <RHFTextField name={`lines.${i}.quantity`} label={t('quantity')} required inputProps={{ dir: 'ltr', inputMode: 'decimal' }} />
                </Grid>
                <Grid item xs={6} md={2}>
                  <RHFMoney name={`lines.${i}.unitCost`} label={t('opening.unitCost')} currency={currency} required />
                </Grid>
                <Grid item xs={6} md={2}>
                  <RHFTextField name={`lines.${i}.lotNumber`} label={t('lot')} maxLength={40} />
                </Grid>
                <Grid item xs={5} md={1.5}>
                  <RHFDate name={`lines.${i}.expiresAt`} label={t('expiresAt')} />
                </Grid>
                <Grid item xs={1} md={0.5}>
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
          ))}
          <Button startIcon={<Plus size={16} />} onClick={() => append({ itemId: '', quantity: '', unitCost: 0, lotNumber: '', expiresAt: '' } as unknown as OpeningValues['lines'][number])} sx={{ alignSelf: 'flex-start' }}>
            {t('addLine')}
          </Button>
        </Stack>
      </Form>
    </FormDrawer>
  );
}
