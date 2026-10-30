import { Button, Chip, Grid, Stack, Typography } from '@mui/material';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  color,
  entityName,
  enumOf,
  freeText,
  optional,
} from '@/shared/generated/validation/fields';
import { ColorDot, InactiveToggle, RowActions } from '@/shared/components/CrudBits';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFColor } from '@/shared/form/RHFColor';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import {
  appointmentTypesApi,
  chairsApi,
  taxRatesApi,
  type AppointmentType,
  type Chair,
  type TaxRate,
} from '../api';

const intField = (min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .int({ message: 'invalid' })
    .min(min, { message: 'too_small' })
    .max(max, { message: 'too_big' });

/* ---------------- chairs ---------------- */

const chairSchema = z.object({
  name: entityName({ max: 60 }),
  roomName: optional(freeText(60)),
  color: color(),
  isActive: z.boolean(),
  sortOrder: intField(0, 999),
});
type ChairForm = z.input<typeof chairSchema>;

function ChairDrawer({
  open,
  chair,
  onClose,
  nextOrder,
}: {
  open: boolean;
  chair: Chair | null;
  onClose: () => void;
  nextOrder: number;
}) {
  const { t } = useTranslation('settings');
  const notify = useNotify();
  const create = chairsApi.useCreate();
  const update = chairsApi.useUpdate();
  const form = useAppForm<ChairForm>({
    schema: chairSchema,
    values: chair
      ? {
          name: chair.name,
          roomName: chair.roomName,
          color: chair.color,
          isActive: chair.isActive,
          sortOrder: chair.sortOrder,
        }
      : { name: '', roomName: '', color: '#4F46E5', isActive: true, sortOrder: nextOrder },
    defaultValues: {
      name: '',
      roomName: '',
      color: '#4F46E5',
      isActive: true,
      sortOrder: nextOrder,
    },
  });
  const onSubmit = async (v: ChairForm) => {
    if (chair)
      await update.mutateAsync({ id: chair.id, version: chair.version, ...(v as Partial<Chair>) });
    else await create.mutateAsync(v as Partial<Chair>);
    notify.success(chair ? t('chairs.updated') : t('chairs.created'));
    onClose();
  };
  return (
    <FormDrawer
      open={open}
      title={chair ? t('chairs.edit') : t('chairs.add')}
      onClose={onClose}
      formId="chair-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form form={form} name="settings.chair" onSubmit={onSubmit} id="chair-form">
        <Stack spacing={4}>
          <RHFTextField
            name="name"
            label={t('chairs.name')}
            helperText={t('chairs.nameHelper')}
            required
            autoFocus
            maxLength={60}
          />
          <RHFTextField name="roomName" label={t('chairs.room')} maxLength={60} />
          <RHFTextField
            name="sortOrder"
            label={t('chairs.order')}
            type="number"
            inputProps={{ dir: 'ltr' }}
          />
          <RHFColor name="color" label={t('chairs.color')} />
          <RHFCheckbox name="isActive" label={t('chairs.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

export function ChairsPage() {
  const { t } = useTranslation('settings');
  const [showInactive, setShowInactive] = useState(false);
  const list = chairsApi.useAll({ includeInactive: showInactive ? 'true' : undefined });
  const remove = chairsApi.useRemove();
  const restore = chairsApi.useRestore();
  const [editing, setEditing] = useState<Chair | null>(null);
  const [open, setOpen] = useState(false);
  const rows = list.data ?? [];
  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <SectionCard
      title={t('chairs.title')}
      subtitle={t('chairs.subtitle')}
      noPadding
      actions={
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={openNew}>
          {t('chairs.add')}
        </Button>
      }
    >
      <DataTable<Chair>
        clientSide
        searchable={false}
        toolbar={
          <InactiveToggle
            checked={showInactive}
            onChange={setShowInactive}
            label={t('common.showInactive')}
          />
        }
        rows={rows}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => {
          setEditing(r);
          setOpen(true);
        }}
        empty={
          <EmptyState
            title={t('chairs.empty')}
            description={t('chairs.emptyHint')}
            action={
              <Button variant="contained" onClick={openNew}>
                {t('chairs.add')}
              </Button>
            }
            compact
          />
        }
        columns={[
          {
            field: 'name',
            headerName: t('chairs.name'),
            flex: 1,
            minWidth: 160,
            renderCell: (p) => (
              <Stack direction="row" spacing={2} alignItems="center" sx={{ height: '100%' }}>
                <ColorDot color={p.row.color} />
                <span dir="auto">{p.row.name}</span>
              </Stack>
            ),
          },
          { field: 'roomName', headerName: t('chairs.room'), flex: 1, minWidth: 120 },
          { field: 'sortOrder', headerName: t('chairs.order'), width: 90 },
          {
            field: 'isActive',
            headerName: t('common.status'),
            width: 120,
            renderCell: (p) => (
              <Chip
                size="small"
                label={p.row.isActive ? t('common.active') : t('common.inactive')}
                color={p.row.isActive ? 'success' : 'default'}
                variant="outlined"
              />
            ),
          },
          {
            field: 'actions',
            headerName: '',
            width: 100,
            sortable: false,
            renderCell: (p) => (
              <RowActions
                name={p.row.name}
                onEdit={() => {
                  setEditing(p.row);
                  setOpen(true);
                }}
                onDelete={() => remove.mutateAsync(p.row.id)}
                onUndo={() => restore.mutateAsync(p.row.id)}
                deleteTitle={t('chairs.deleteTitle', { name: p.row.name })}
                deleteBody={t('chairs.deleteBody')}
                deletedMessage={t('chairs.deleted')}
              />
            ),
          },
        ]}
      />
      <ChairDrawer
        open={open}
        chair={editing}
        onClose={() => setOpen(false)}
        nextOrder={rows.length + 1}
      />
    </SectionCard>
  );
}

/* ---------------- appointment types ---------------- */

const typeSchema = z.object({
  name: entityName({ max: 80 }),
  code: optional(z.string().trim().max(12, { message: 'too_long' })),
  defaultDurationMin: intField(5, 480),
  bufferAfterMin: intField(0, 120),
  color: color(),
  allowOnline: z.boolean(),
  requiresDeposit: z.boolean(),
  isActive: z.boolean(),
});
type TypeForm = z.input<typeof typeSchema>;

function TypeDrawer({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: AppointmentType | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('appointmentType');
  const notify = useNotify();
  const create = appointmentTypesApi.useCreate();
  const update = appointmentTypesApi.useUpdate();
  const empty: TypeForm = {
    name: '',
    code: '',
    defaultDurationMin: 30,
    bufferAfterMin: 0,
    color: '#4F46E5',
    allowOnline: false,
    requiresDeposit: false,
    isActive: true,
  };
  const form = useAppForm<TypeForm>({
    schema: typeSchema,
    defaultValues: empty,
    values: item
      ? {
          name: seedName(item),
          code: item.code,
          defaultDurationMin: item.defaultDurationMin,
          bufferAfterMin: item.bufferAfterMin,
          color: item.color,
          allowOnline: item.allowOnline,
          requiresDeposit: item.requiresDeposit,
          isActive: item.isActive,
        }
      : empty,
  });
  const onSubmit = async (v: TypeForm) => {
    // An untouched system name stays a translation key (name: null) so it follows the UI language.
    const body = {
      ...v,
      ...(item && !item.name && v.name === seedName(item) ? { name: null } : {}),
    } as Partial<AppointmentType>;
    if (item) await update.mutateAsync({ id: item.id, version: item.version, ...body });
    else await create.mutateAsync(body);
    notify.success(item ? t('types.updated') : t('types.created'));
    onClose();
  };
  return (
    <FormDrawer
      open={open}
      title={item ? t('types.edit') : t('types.add')}
      onClose={onClose}
      formId="type-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form form={form} name="settings.appointmentType" onSubmit={onSubmit} id="type-form">
        <Grid container spacing={4}>
          <Grid item xs={8}>
            <RHFTextField name="name" label={t('types.name')} required autoFocus maxLength={80} />
          </Grid>
          <Grid item xs={4}>
            <RHFTextField name="code" label={t('types.code')} inputProps={{ dir: 'ltr' }} />
          </Grid>
          <Grid item xs={6}>
            <RHFTextField
              name="defaultDurationMin"
              label={t('types.duration')}
              type="number"
              required
              inputProps={{ dir: 'ltr', step: 5 }}
            />
          </Grid>
          <Grid item xs={6}>
            <RHFTextField
              name="bufferAfterMin"
              label={t('types.buffer')}
              helperText={t('types.bufferHelper')}
              type="number"
              inputProps={{ dir: 'ltr', step: 5 }}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFColor name="color" label={t('types.color')} />
          </Grid>
          <Grid item xs={12}>
            <RHFCheckbox name="allowOnline" label={t('types.online')} asSwitch />
            <RHFCheckbox name="requiresDeposit" label={t('types.deposit')} asSwitch />
            <RHFCheckbox name="isActive" label={t('types.active')} asSwitch />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

export function AppointmentTypesPage() {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('appointmentType');
  const [showInactive, setShowInactive] = useState(false);
  const list = appointmentTypesApi.useAll({ includeInactive: showInactive ? 'true' : undefined });
  const remove = appointmentTypesApi.useRemove();
  const restore = appointmentTypesApi.useRestore();
  const [editing, setEditing] = useState<AppointmentType | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (r: AppointmentType | null) => {
    setEditing(r);
    setOpen(true);
  };
  return (
    <SectionCard
      title={t('types.title')}
      subtitle={t('types.subtitle')}
      noPadding
      actions={
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => edit(null)}>
          {t('types.add')}
        </Button>
      }
    >
      <DataTable<AppointmentType>
        clientSide
        searchable={false}
        toolbar={
          <InactiveToggle
            checked={showInactive}
            onChange={setShowInactive}
            label={t('common.showInactive')}
          />
        }
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={edit}
        empty={<EmptyState title={t('types.empty')} compact />}
        columns={[
          {
            field: 'name',
            headerName: t('types.name'),
            flex: 1,
            minWidth: 180,
            valueGetter: (_v, r) => seedName(r),
            renderCell: (p) => (
              <Stack direction="row" spacing={2} alignItems="center" sx={{ height: '100%' }}>
                <ColorDot color={p.row.color} />
                <span dir="auto">{seedName(p.row)}</span>
              </Stack>
            ),
          },
          {
            field: 'defaultDurationMin',
            headerName: t('types.duration'),
            width: 140,
            renderCell: (p) => t('types.minutes', { count: p.row.defaultDurationMin }),
          },
          {
            field: 'allowOnline',
            headerName: t('types.online'),
            width: 140,
            renderCell: (p) =>
              p.row.allowOnline ? (
                <Chip size="small" color="info" variant="outlined" label={t('common:yes')} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('common:no')}
                </Typography>
              ),
          },
          {
            field: 'isActive',
            headerName: t('common.status'),
            width: 110,
            renderCell: (p) => (
              <Chip
                size="small"
                label={p.row.isActive ? t('common.active') : t('common.inactive')}
                color={p.row.isActive ? 'success' : 'default'}
                variant="outlined"
              />
            ),
          },
          {
            field: 'actions',
            headerName: '',
            width: 100,
            sortable: false,
            renderCell: (p) => (
              <RowActions
                name={seedName(p.row)}
                onEdit={() => edit(p.row)}
                onDelete={() => remove.mutateAsync(p.row.id)}
                onUndo={() => restore.mutateAsync(p.row.id)}
                deleteTitle={t('types.deleteTitle', { name: seedName(p.row) })}
                deletedMessage={t('types.deleted')}
              />
            ),
          },
        ]}
      />
      <TypeDrawer open={open} item={editing} onClose={() => setOpen(false)} />
    </SectionCard>
  );
}

/* ---------------- tax rates ---------------- */

const taxSchema = z.object({
  name: entityName({ max: 60 }),
  ratePercent: z.coerce
    .number({ invalid_type_error: 'out_of_range' })
    .min(0, { message: 'out_of_range' })
    .max(100, { message: 'out_of_range' })
    .refine((v) => Math.round(v * 100) === v * 100, { message: 'too_many_decimals' }),
  jofotaraCategory: enumOf(['S', 'Z', 'O']),
  isDefault: z.boolean(),
  isActive: z.boolean(),
});
type TaxForm = z.input<typeof taxSchema>;

function TaxDrawer({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: TaxRate | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('taxRate');
  const notify = useNotify();
  const create = taxRatesApi.useCreate();
  const update = taxRatesApi.useUpdate();
  const empty: TaxForm = {
    name: '',
    ratePercent: 0,
    jofotaraCategory: 'S',
    isDefault: false,
    isActive: true,
  };
  const form = useAppForm<TaxForm>({
    schema: taxSchema,
    defaultValues: empty,
    values: item
      ? {
          name: seedName(item),
          ratePercent: item.rate / 100,
          jofotaraCategory: item.jofotaraCategory,
          isDefault: item.isDefault,
          isActive: item.isActive,
        }
      : empty,
  });
  const onSubmit = async (v: TaxForm) => {
    const body = {
      name: item && !item.name && v.name === seedName(item) ? null : v.name,
      rate: Math.round(Number(v.ratePercent) * 100),
      jofotaraCategory: v.jofotaraCategory,
      isDefault: v.isDefault,
      isActive: v.isActive,
    } as Partial<TaxRate>;
    if (item) await update.mutateAsync({ id: item.id, version: item.version, ...body });
    else await create.mutateAsync(body);
    notify.success(item ? t('taxes.updated') : t('taxes.created'));
    onClose();
  };
  return (
    <FormDrawer
      open={open}
      title={item ? t('taxes.edit') : t('taxes.add')}
      onClose={onClose}
      formId="tax-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form form={form} name="settings.taxRate" onSubmit={onSubmit} id="tax-form">
        <Stack spacing={4}>
          <RHFTextField name="name" label={t('taxes.name')} required autoFocus maxLength={60} />
          <RHFTextField
            name="ratePercent"
            label={t('taxes.rate')}
            type="number"
            required
            inputProps={{ dir: 'ltr', step: 0.01 }}
          />
          <RHFSelect
            name="jofotaraCategory"
            label={t('taxes.category')}
            options={(['S', 'Z', 'O'] as const).map((c) => ({
              value: c,
              label: t(`taxes.categories.${c}`),
            }))}
          />
          <RHFCheckbox name="isDefault" label={t('taxes.default')} asSwitch />
          <RHFCheckbox name="isActive" label={t('taxes.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

export function TaxRatesPage() {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('taxRate');
  const list = taxRatesApi.useAll({ includeInactive: 'true' });
  const remove = taxRatesApi.useRemove();
  const restore = taxRatesApi.useRestore();
  const [editing, setEditing] = useState<TaxRate | null>(null);
  const [open, setOpen] = useState(false);
  const edit = (r: TaxRate | null) => {
    setEditing(r);
    setOpen(true);
  };
  return (
    <SectionCard
      title={t('taxes.title')}
      subtitle={t('taxes.subtitle')}
      noPadding
      actions={
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => edit(null)}>
          {t('taxes.add')}
        </Button>
      }
    >
      <DataTable<TaxRate>
        clientSide
        searchable={false}
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={edit}
        columns={[
          {
            field: 'name',
            headerName: t('taxes.name'),
            flex: 1,
            minWidth: 200,
            valueGetter: (_v, r) => seedName(r),
          },
          {
            field: 'rate',
            headerName: t('taxes.rate'),
            width: 110,
            renderCell: (p) => <span dir="ltr">{(p.row.rate / 100).toFixed(2)}%</span>,
          },
          {
            field: 'jofotaraCategory',
            headerName: t('taxes.category'),
            width: 160,
            renderCell: (p) => t(`taxes.categories.${p.row.jofotaraCategory}`),
          },
          {
            field: 'isDefault',
            headerName: t('taxes.isDefault'),
            width: 120,
            renderCell: (p) =>
              p.row.isDefault ? (
                <Chip size="small" color="primary" label={t('taxes.isDefault')} />
              ) : null,
          },
          {
            field: 'actions',
            headerName: '',
            width: 100,
            sortable: false,
            renderCell: (p) => (
              <RowActions
                name={seedName(p.row)}
                onEdit={() => edit(p.row)}
                onDelete={() => remove.mutateAsync(p.row.id)}
                onUndo={() => restore.mutateAsync(p.row.id)}
                deleteTitle={t('taxes.deleteTitle', { name: seedName(p.row) })}
                deletedMessage={t('taxes.deleted')}
              />
            ),
          },
        ]}
      />
      <TaxDrawer open={open} item={editing} onClose={() => setOpen(false)} />
    </SectionCard>
  );
}
