import { Alert, Box, Button, Chip, Grid, IconButton, List, ListItemButton, ListItemText, MenuItem, Radio, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { ClipboardCheck, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PatientPicker } from '@/features/patients/components/PatientPicker';
import { formatDate } from '@/lib/dates';
import { DataTable } from '@/shared/components/DataTable';
import { MoneyText } from '@/shared/components/MoneyText';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { roundQty, stockQtyOrZero } from '@/shared/generated/inventory';
import { freeText, objectId, optional } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { usePermission } from '@/shared/rbac/usePermission';
import { fmtQty, itemsApi, locationsApi, newIdempotencyKey, numeric, useBalances, useContainers, usePosting, useSuggestions, useUsageCandidates, useUsages, type ClinicalUsage, type InventoryItem } from '../api';
import { ItemPicker } from './ItemsTab';

type Patient = { id: string; fullName: string } | null;

export default function UsageTab() {
  const { t, i18n } = useTranslation('inventory');
  const { can } = usePermission();
  const [patient, setPatient] = useState<Patient>(null);
  const usages = useUsages({ patientId: patient?.id }, can('inventory.usage.read'));
  const lang = i18n.language;
  return (
    <Stack spacing={4}>
      <Box sx={{ maxWidth: 520 }}>
        <PatientPicker value={patient} onChange={(v) => setPatient(v ? { id: v.id, fullName: v.fullName } : null)} label={t('usage.patient')} />
      </Box>
      {can('inventory.usage.record') && (patient ? <RecordUsage patientId={patient.id} /> : <EmptyState title={t('usage.pickPatient')} description={t('usage.pickPatientHint')} />)}
      {can('inventory.usage.read') && (
        <SectionCard title={t('usage.history')} noPadding>
          <DataTable<ClinicalUsage>
            clientSide
            dense
            rows={usages.data ?? []}
            loading={usages.isLoading}
            error={usages.error}
            onRetry={() => void usages.refetch()}
            empty={<EmptyState title={t('usage.empty')} compact />}
            columns={[
              { field: 'number', headerName: t('number'), width: 150, renderCell: ({ row }) => <span dir="ltr">{row.number}</span> },
              { field: 'date', headerName: t('date'), width: 120, valueGetter: (_v, row) => formatDate(row.date, lang) },
              { field: 'dentistName', headerName: t('usage.dentist'), width: 160 },
              {
                field: 'lines',
                headerName: t('usage.materials'),
                flex: 1,
                minWidth: 240,
                sortable: false,
                valueGetter: (_v, row) => row.lines.map((l) => `${l.itemName} ${fmtQty(l.quantityUsed, l.unit)}${l.quantityWasted + l.autoWasteQuantity > 0 ? ` (+${fmtQty(roundQty(l.quantityWasted + l.autoWasteQuantity))} ${t('usage.wastedShort')})` : ''}`).join(' · '),
              },
              { field: 'locationName', headerName: t('location'), width: 140 },
              ...((usages.data ?? []).some((u) => u.total !== undefined)
                ? [{ field: 'total', headerName: t('cost'), width: 110, align: 'right' as const, headerAlign: 'right' as const, renderCell: ({ row }: { row: ClinicalUsage }) => <MoneyText value={row.total ?? 0} /> }]
                : []),
            ]}
          />
        </SectionCard>
      )}
    </Stack>
  );
}

/* ---------- recording ---------- */

const usageForm = z.object({
  notes: optional(freeText(500)),
  lines: z
    .array(
      z
        .object({
          itemId: objectId(),
          batchId: z.string().optional(),
          containerId: z.string().optional(),
          quantityUsed: numeric(stockQtyOrZero()),
          quantityWasted: numeric(stockQtyOrZero()),
        })
        .superRefine((l, ctx) => {
          if (roundQty((l.quantityUsed ?? 0) + (l.quantityWasted ?? 0)) <= 0) ctx.addIssue({ code: 'custom', path: ['quantityUsed'], message: 'invalid_stock_quantity' });
        }),
    )
    .min(1, { message: 'too_few' })
    .max(50, { message: 'too_many' }),
});
type UsageValues = z.input<typeof usageForm>;
type LineValues = { itemId: string; batchId?: string; containerId?: string; quantityUsed: string; quantityWasted: string };

function RecordUsage({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('inventory');
  const procName = useSeedName('procedure');
  const candidates = useUsageCandidates(patientId);
  const locations = locationsApi.useAll();
  const [procedureId, setProcedureId] = useState('');
  const [locationId, setLocationId] = useState('');
  useEffect(() => setProcedureId(''), [patientId]);
  useEffect(() => {
    if (!locationId && locations.data?.length) setLocationId((locations.data.find((l) => l.type === 'chair') ?? locations.data[0])!.id);
  }, [locations.data, locationId]);

  if (candidates.isLoading) return <PageSkeleton rows={3} />;
  if (candidates.error) return <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />;
  const open = (candidates.data ?? []).filter((c) => !c.usageNumber);
  return (
    <SectionCard title={t('usage.record')} subtitle={t('usage.recordHint')}>
      <Stack spacing={4}>
        {(candidates.data ?? []).length === 0 ? (
          <EmptyState compact title={t('usage.noProcedures')} />
        ) : (
          <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}>
            {(candidates.data ?? []).map((c) => (
              <ListItemButton key={c.id} disabled={Boolean(c.usageNumber)} selected={procedureId === c.id} onClick={() => setProcedureId(c.id)}>
                <Radio size="small" checked={procedureId === c.id} tabIndex={-1} />
                <ListItemText
                  primary={`${c.code} · ${procName(c.procedure)}${c.toothNumbers.length ? ` · ${t('usage.teeth')} ${c.toothNumbers.join(', ')}` : ''}`}
                  secondary={`${formatDate(c.performedAt, i18n.language)} · ${c.dentistName}`}
                />
                {c.usageNumber && <Chip size="small" label={t('usage.recorded', { number: c.usageNumber })} />}
              </ListItemButton>
            ))}
          </List>
        )}
        {open.length === 0 && (candidates.data ?? []).length > 0 && <Alert severity="success">{t('usage.allRecorded')}</Alert>}
        {procedureId && (
          <>
            <TextField select size="small" label={t('usage.source')} value={locationId} onChange={(e) => setLocationId(e.target.value)} helperText={t('usage.sourceHint')} sx={{ maxWidth: 360 }}>
              {(locations.data ?? []).map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
            {locationId && <UsageForm key={`${procedureId}-${locationId}`} performedProcedureId={procedureId} locationId={locationId} onDone={() => setProcedureId('')} />}
          </>
        )}
      </Stack>
    </SectionCard>
  );
}

function UsageForm({ performedProcedureId, locationId, onDone }: { performedProcedureId: string; locationId: string; onDone: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const items = itemsApi.useAll();
  const suggestions = useSuggestions(performedProcedureId, locationId);
  const post = usePosting<ClinicalUsage>('/clinical-usages');
  const key = useRef(newIdempotencyKey());
  const form = useAppForm<UsageValues>({ schema: usageForm, defaultValues: { notes: '', lines: [] } as unknown as UsageValues });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const consumables = useMemo(() => (items.data ?? []).filter((x) => x.isActive && !['reusable', 'equipment'].includes(x.type)), [items.data]);

  // Start from the procedure's template; the user confirms the real quantities.
  useEffect(() => {
    if (!suggestions.data) return;
    form.reset({
      notes: '',
      lines: suggestions.data.map((s) => ({ itemId: s.itemId, batchId: s.batchId ?? '', containerId: s.containerId ?? '', quantityUsed: String(s.quantity), quantityWasted: '0' })),
    } as unknown as UsageValues);
  }, [suggestions.data, form]);

  if (suggestions.isLoading) return <PageSkeleton rows={3} />;
  return (
    <Form
      form={form}
      name="inventory.clinicalUsage"
      id="inv-usage-form"
      onSubmit={async (raw) => {
        const v = raw as z.output<typeof usageForm>;
        const r = await post.mutateAsync({
          idempotencyKey: key.current,
          performedProcedureId,
          locationId,
          ...(v.notes ? { notes: v.notes } : {}),
          lines: v.lines.map((l) => ({
            itemId: l.itemId,
            ...(l.containerId ? { containerId: l.containerId } : l.batchId ? { batchId: l.batchId } : {}),
            quantityUsed: l.quantityUsed,
            quantityWasted: l.quantityWasted,
          })),
        });
        notify.success(t('usage.saved', { number: r.number }));
        onDone();
      }}
    >
      <Stack spacing={3}>
        {(suggestions.data ?? []).length === 0 && <Alert severity="info">{t('usage.noTemplate')}</Alert>}
        {fields.map((f, i) => (
          <UsageLine key={f.id} index={i} form={form as unknown as UseFormReturn<{ lines: LineValues[] }>} items={consumables} locationId={locationId} onRemove={() => remove(i)} />
        ))}
        <Stack direction="row" spacing={2} justifyContent="space-between" flexWrap="wrap" useFlexGap>
          <Button startIcon={<Plus size={16} />} onClick={() => append({ itemId: '', batchId: '', containerId: '', quantityUsed: '', quantityWasted: '0' } as unknown as UsageValues['lines'][number])}>
            {t('addLine')}
          </Button>
          <Button type="submit" variant="contained" startIcon={<ClipboardCheck size={16} />} disabled={form.formState.isSubmitting || fields.length === 0}>
            {t('usage.submit')}
          </Button>
        </Stack>
        <RHFTextField name="notes" label={t('notes')} maxLength={500} />
        <Typography variant="caption" color="text.secondary">
          {t('usage.costNote')}
        </Typography>
      </Stack>
    </Form>
  );
}

/** One material: the lot (auto first-expiry when empty) or, for tracked items, the opened container. */
function UsageLine({ index, form, items, locationId, onRemove }: { index: number; form: UseFormReturn<{ lines: LineValues[] }>; items: InventoryItem[]; locationId: string; onRemove: () => void }) {
  const { t } = useTranslation('inventory');
  const itemId = useWatch({ control: form.control, name: `lines.${index}.itemId` });
  const item = items.find((i) => i.id === itemId);
  const tracked = Boolean(item?.trackContainers);
  const containers = useContainers({ status: 'open', locationId, itemId }, Boolean(itemId && tracked));
  const balances = useBalances({ locationId, itemId, available: 'true' }, Boolean(itemId && !tracked));
  const usable = (containers.data ?? []).filter((c) => c.usable);
  return (
    <Box sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} md={4}>
          <ItemPicker name={`lines.${index}.itemId`} items={items} label={t('item.name')} />
          {item && tracked && (
            <Typography variant="caption" color="text.secondary">
              {t(`policies.${item.containerPolicy}`)}
            </Typography>
          )}
        </Grid>
        <Grid item xs={12} md={3}>
          {tracked ? (
            <Controller
              name={`lines.${index}.containerId`}
              control={form.control}
              render={({ field, fieldState }) => (
                <TextField select fullWidth size="small" {...field} value={field.value ?? ''} label={`${t('usage.container')} *`} error={Boolean(fieldState.error)} helperText={usable.length ? undefined : t('usage.noOpenContainer')}>
                  {usable.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      <span dir="ltr">{c.code}</span>&nbsp;· {fmtQty(c.remainingQuantity, c.unit)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          ) : (
            <Controller
              name={`lines.${index}.batchId`}
              control={form.control}
              render={({ field }) => (
                <TextField select fullWidth size="small" {...field} value={field.value ?? ''} label={t('lot')} helperText={t('usage.lotAuto')} disabled={!itemId}>
                  <MenuItem value="">{t('usage.firstExpiry')}</MenuItem>
                  {(balances.data ?? []).map((b) => (
                    <MenuItem key={b.batchId} value={b.batchId}>
                      {`${b.lotNumber || '—'} · ${fmtQty(b.quantity, b.unit)}`}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          )}
        </Grid>
        <Grid item xs={5} md={2}>
          <RHFTextField name={`lines.${index}.quantityUsed`} label={item ? `${t('usage.used')} (${item.unit})` : t('usage.used')} size="small" required inputProps={{ dir: 'ltr', inputMode: 'decimal' }} />
        </Grid>
        <Grid item xs={5} md={2}>
          <RHFTextField name={`lines.${index}.quantityWasted`} label={t('usage.wasted')} size="small" inputProps={{ dir: 'ltr', inputMode: 'decimal' }} />
        </Grid>
        <Grid item xs={2} md={1}>
          <Tooltip title={t('removeLine')}>
            <IconButton aria-label={t('removeLine')} onClick={onRemove}>
              <Trash2 size={16} />
            </IconButton>
          </Tooltip>
        </Grid>
      </Grid>
      {item?.containerPolicy === 'single_use' && (
        <Typography variant="caption" color="warning.main">
          {t('policyHints.single_use')}
        </Typography>
      )}
    </Box>
  );
}
