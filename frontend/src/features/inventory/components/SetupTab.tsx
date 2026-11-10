import { Box, Button, Chip, Grid, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { chairsApi, type ClinicProcedure } from '@/features/clinic-settings/api';
import { useProcedureLookup } from '@/features/clinical/components/shared';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { LOCATION_TYPES, stockQty, USAGE_SCOPES } from '@/shared/generated/inventory';
import { entityName, enumOf, objectId, optional } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { itemsApi, locationsApi, numeric, useProcedureMaterials, useSaveMaterials, type InventoryLocation, type ProcedureMaterials } from '../api';
import { ItemPicker } from './ItemsTab';

export default function SetupTab() {
  const { t } = useTranslation('inventory');
  const locations = locationsApi.useAll({ includeInactive: 'true' });
  const chairs = chairsApi.useAll();
  const procs = useProcedureLookup();
  const materials = useProcedureMaterials();
  const [editingLoc, setEditingLoc] = useState<InventoryLocation | 'new' | null>(null);
  const [editingProc, setEditingProc] = useState<ClinicProcedure | null>(null);
  const chairName = new Map((chairs.data ?? []).map((c) => [c.id, c.name]));
  const matsByProc = new Map((materials.data ?? []).map((m) => [m.clinicProcedureId, m]));
  return (
    <Stack spacing={4}>
      <SectionCard
        title={t('locations.title')}
        subtitle={t('locations.hint')}
        noPadding
        actions={
          <Button size="small" variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditingLoc('new')}>
            {t('locations.add')}
          </Button>
        }
      >
        <DataTable<InventoryLocation>
          clientSide
          dense
          rows={locations.data ?? []}
          loading={locations.isLoading}
          error={locations.error}
          onRetry={() => void locations.refetch()}
          onRowClick={(r) => setEditingLoc(r)}
          empty={<EmptyState title={t('locations.empty')} compact />}
          columns={[
            { field: 'name', headerName: t('locations.name'), flex: 1, minWidth: 180 },
            { field: 'type', headerName: t('locations.type'), width: 190, valueGetter: (_v, row) => t(`locationTypes.${row.type}`) },
            { field: 'chairId', headerName: t('locations.chair'), width: 150, valueGetter: (_v, row) => (row.chairId ? (chairName.get(row.chairId) ?? '') : '—') },
            {
              field: 'flags',
              headerName: '',
              width: 200,
              sortable: false,
              renderCell: ({ row }) => (
                <Stack direction="row" spacing={1}>
                  {row.isDefault && <Chip size="small" color="primary" label={t('locations.default')} />}
                  {!row.isActive && <Chip size="small" label={t('inactive')} />}
                </Stack>
              ),
            },
          ]}
        />
      </SectionCard>
      <SectionCard title={t('materials.title')} subtitle={t('materials.hint')} noPadding>
        <DataTable<ClinicProcedure>
          clientSide
          searchable
          dense
          rows={procs.items}
          loading={procs.loading}
          onRowClick={(r) => setEditingProc(r)}
          empty={<EmptyState title={t('materials.noProcedures')} compact />}
          columns={[
            { field: 'code', headerName: t('materials.code'), width: 110, renderCell: ({ row }) => <span dir="ltr">{row.code}</span> },
            { field: 'name', headerName: t('materials.procedure'), flex: 1, minWidth: 200, valueGetter: (_v, row) => procs.label(row).replace(`${row.code} · `, '') },
            {
              field: 'materials',
              headerName: t('materials.count'),
              width: 160,
              sortable: false,
              renderCell: ({ row }) => {
                const n = matsByProc.get(row.id)?.materials.length ?? 0;
                return n ? <Chip size="small" color="primary" variant="outlined" label={t('materials.items', { count: n })} /> : <Typography variant="body2" color="text.secondary">{t('materials.none')}</Typography>;
              },
            },
          ]}
        />
      </SectionCard>
      {editingLoc && <LocationDrawer location={editingLoc === 'new' ? null : editingLoc} onClose={() => setEditingLoc(null)} />}
      {editingProc && <MaterialsDrawer procedure={editingProc} label={procs.label(editingProc)} current={matsByProc.get(editingProc.id)} onClose={() => setEditingProc(null)} />}
    </Stack>
  );
}

/* ---------- locations ---------- */

const locationForm = z
  .object({ name: entityName({ max: 80 }), type: enumOf([...LOCATION_TYPES]), chairId: optional(objectId()), isDefault: z.boolean(), isActive: z.boolean() })
  .superRefine((v, ctx) => {
    if (v.type === 'chair' && !v.chairId) ctx.addIssue({ code: 'custom', path: ['chairId'], message: 'required' });
    if (v.isDefault && v.type !== 'warehouse') ctx.addIssue({ code: 'custom', path: ['isDefault'], message: 'invalid_option' });
  });
type LocationValues = z.input<typeof locationForm>;

function LocationDrawer({ location, onClose }: { location: InventoryLocation | null; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const chairs = chairsApi.useAll();
  const create = locationsApi.useCreate();
  const update = locationsApi.useUpdate();
  const form = useAppForm<LocationValues>({
    schema: locationForm,
    defaultValues: { name: location?.name ?? '', type: location?.type ?? 'warehouse', chairId: location?.chairId ?? '', isDefault: location?.isDefault ?? false, isActive: location?.isActive ?? true },
  });
  const type = useWatch({ control: form.control, name: 'type' });
  return (
    <FormDrawer open onClose={onClose} title={location ? t('locations.edit') : t('locations.add')} formId="inv-location-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty}>
      <Form
        form={form}
        name="inventory.location"
        id="inv-location-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof locationForm>;
          const payload = { ...v, chairId: v.type === 'chair' ? v.chairId : undefined, isDefault: v.type === 'warehouse' ? v.isDefault : false };
          if (location) await update.mutateAsync({ id: location.id, version: location.version, ...payload });
          else await create.mutateAsync(payload);
          notify.success(t('locations.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFTextField name="name" label={t('locations.name')} required maxLength={80} />
          <RHFSelect name="type" label={t('locations.type')} required options={LOCATION_TYPES.map((x) => ({ value: x, label: t(`locationTypes.${x}`) }))} helperText={t(`locationHints.${type}`)} />
          {type === 'chair' && <RHFSelect name="chairId" label={t('locations.chair')} required options={(chairs.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />}
          {type === 'warehouse' && <RHFCheckbox name="isDefault" label={t('locations.makeDefault')} asSwitch helperText={t('locations.defaultHint')} />}
          <RHFCheckbox name="isActive" label={t('active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------- default materials of a procedure ---------- */

const materialsForm = z.object({
  materials: z
    .array(z.object({ itemId: objectId(), defaultQuantity: numeric(stockQty()), usageScope: enumOf([...USAGE_SCOPES]), optional: z.boolean() }))
    .max(50, { message: 'too_many' }),
});
type MaterialsValues = z.input<typeof materialsForm>;

function MaterialsDrawer({ procedure, label, current, onClose }: { procedure: ClinicProcedure; label: string; current?: ProcedureMaterials; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const items = itemsApi.useAll();
  const save = useSaveMaterials();
  const consumables = useMemo(() => (items.data ?? []).filter((i) => i.isActive && !['reusable', 'equipment'].includes(i.type)), [items.data]);
  const unitOf = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i.unit])), [items.data]);
  const form = useAppForm<MaterialsValues>({
    schema: materialsForm,
    defaultValues: { materials: (current?.materials ?? []).map((m) => ({ ...m, defaultQuantity: String(m.defaultQuantity) })) } as unknown as MaterialsValues,
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'materials' });
  const rows = useWatch({ control: form.control, name: 'materials' });
  return (
    <FormDrawer open onClose={onClose} title={t('materials.editTitle')} subtitle={label} formId="inv-materials-form" submitting={form.formState.isSubmitting} dirty={form.formState.isDirty} width={760}>
      <Form
        form={form}
        name="inventory.procedureMaterials"
        id="inv-materials-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof materialsForm>;
          await save.mutateAsync({ clinicProcedureId: procedure.id, materials: v.materials });
          notify.success(t('materials.saved'));
          onClose();
        }}
      >
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            {t('materials.editHint')}
          </Typography>
          {fields.map((f, i) => (
            <Box key={f.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
              <Grid container spacing={2} alignItems="flex-start">
                <Grid item xs={12} md={5}>
                  <ItemPicker name={`materials.${i}.itemId`} items={consumables} label={t('item.name')} />
                </Grid>
                <Grid item xs={6} md={2}>
                  <RHFTextField name={`materials.${i}.defaultQuantity`} label={unitOf.get(rows?.[i]?.itemId ?? '') ?? t('quantity')} required size="small" inputProps={{ dir: 'ltr', inputMode: 'decimal' }} />
                </Grid>
                <Grid item xs={6} md={3}>
                  <RHFSelect name={`materials.${i}.usageScope`} label={t('materials.scope')} required options={USAGE_SCOPES.map((s) => ({ value: s, label: t(`scopes.${s}`) }))} />
                </Grid>
                <Grid item xs={10} md={1.5}>
                  <RHFCheckbox name={`materials.${i}.optional`} label={t('materials.optional')} />
                </Grid>
                <Grid item xs={2} md={0.5}>
                  <Tooltip title={t('removeLine')}>
                    <IconButton aria-label={t('removeLine')} onClick={() => remove(i)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </Tooltip>
                </Grid>
              </Grid>
            </Box>
          ))}
          {fields.length === 0 && <EmptyState compact title={t('materials.emptyLines')} />}
          <Button startIcon={<Plus size={16} />} onClick={() => append({ itemId: '', defaultQuantity: '1', usageScope: 'per_procedure', optional: false } as unknown as MaterialsValues['materials'][number])} sx={{ alignSelf: 'flex-start' }}>
            {t('addLine')}
          </Button>
        </Stack>
      </Form>
    </FormDrawer>
  );
}
