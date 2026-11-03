import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Plus, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PermissionEditor } from '@/features/staff/components/PermissionEditor';
import type { Grant } from '@/features/staff/api';
import { ColorDot, RowActions } from '@/shared/components/CrudBits';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFColor } from '@/shared/form/RHFColor';
import { RHFCheckbox, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { format } from '@/shared/generated/money';
import {
  color,
  entityName,
  enumOf,
  freeText,
  money,
  optional,
} from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import {
  catalogApi,
  plansApi,
  useClinicPermissionRegistry,
  useRoleTemplateMutations,
  useRoleTemplates,
  type CatalogItem,
  type CatalogKind,
  type Plan,
} from '../api';

const intField = (min: number, max: number) =>
  z.coerce
    .number({ invalid_type_error: 'invalid_type' })
    .int({ message: 'invalid' })
    .min(min, { message: 'too_small' })
    .max(max, { message: 'too_big' });

/* ---------------- plans ---------------- */

const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{2,30}$/, { message: 'invalid_format' }),
  name: entityName({ max: 60 }),
  description: optional(freeText(300)),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { message: 'invalid_format' }),
  priceMonthly: money(),
  priceYearly: money(),
  trialDays: intField(0, 365),
  chairs: intField(0, 1000),
  staff: intField(0, 10_000),
  patients: intField(0, 10_000_000),
  monthlyMessages: intField(0, 10_000_000),
  storageGb: intField(0, 100_000),
  features: optional(freeText(400)),
  isActive: z.boolean(),
  sortOrder: intField(0, 999),
});
type PlanForm = z.input<typeof planSchema>;

function PlanDrawer({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const create = plansApi.useCreate();
  const update = plansApi.useUpdate();
  const form = useAppForm<PlanForm>({
    schema: planSchema,
    defaultValues: plan
      ? { ...plan, ...plan.limits, features: plan.features.join(', ') }
      : {
          code: '',
          name: '',
          description: '',
          currency: 'JOD',
          priceMonthly: 0,
          priceYearly: 0,
          trialDays: 30,
          chairs: 0,
          staff: 0,
          patients: 0,
          monthlyMessages: 0,
          storageGb: 0,
          features: '',
          isActive: true,
          sortOrder: 0,
        },
  });
  const currency = String(form.watch('currency') || 'JOD');
  const onSubmit = async (raw: PlanForm) => {
    const v = raw as z.output<typeof planSchema>;
    const { chairs, staff, patients, monthlyMessages, storageGb, features, ...rest } = v;
    // One input: feature keys separated by commas.
    const featureList = (features ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const body = {
      ...rest,
      description: v.description ?? '',
      limits: { chairs, staff, patients, monthlyMessages, storageGb },
      features: featureList,
    };
    if (plan) await update.mutateAsync({ id: plan.id, version: plan.version, ...body });
    else await create.mutateAsync(body as never);
    notify.success(t('common.saved'));
    onClose();
  };
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={plan ? t('plans.edit') : t('plans.new')}
      subtitle={t('plans.hint')}
      formId="admin-plan-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={620}
    >
      <Form form={form} name="admin.plan" id="admin-plan-form" onSubmit={onSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <RHFTextField
              name="code"
              label={t('plans.code')}
              required
              inputProps={{ dir: 'ltr' }}
              disabled={Boolean(plan)}
            />
          </Grid>
          <Grid item xs={12} md={8}>
            <RHFTextField name="name" label={t('plans.name')} required maxLength={60} />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField
              name="description"
              label={t('plans.description')}
              multiline
              minRows={2}
              maxLength={300}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <RHFTextField
              name="currency"
              label={t('plans.currency')}
              required
              inputProps={{ dir: 'ltr', maxLength: 3 }}
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFMoney
              name="priceMonthly"
              label={t('plans.priceMonthly')}
              currency={currency}
              required
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFMoney
              name="priceYearly"
              label={t('plans.priceYearly')}
              currency={currency}
              required
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFTextField name="trialDays" label={t('plans.trialDays')} type="number" required />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFTextField name="sortOrder" label={t('plans.sortOrder')} type="number" required />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="subtitle2">{t('plans.limits')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('plans.limitsHint')}
            </Typography>
          </Grid>
          {(['chairs', 'staff', 'patients', 'monthlyMessages', 'storageGb'] as const).map((k) => (
            <Grid item xs={6} md={4} key={k}>
              <RHFTextField name={k} label={t(`plans.${k}`)} type="number" required />
            </Grid>
          ))}
          <Grid item xs={12}>
            <RHFTextField
              name="features"
              label={t('plans.features')}
              helperText={t('plans.featuresHint')}
              maxLength={400}
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFCheckbox name="isActive" label={t('common.active')} asSwitch />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

export function PlansPage() {
  const { t, i18n } = useTranslation('admin');
  const list = plansApi.useAll();
  const remove = plansApi.useRemove();
  const [editing, setEditing] = useState<Plan | null | 'new'>(null);
  const limit = (n: number) => (n ? n.toLocaleString(i18n.language) : t('plans.unlimited'));
  const columns: Column<Plan>[] = [
    {
      field: 'name',
      headerName: t('plans.name'),
      flex: 1,
      minWidth: 160,
      renderCell: ({ row }) => <span dir="auto">{row.name}</span>,
    },
    {
      field: 'code',
      headerName: t('plans.code'),
      width: 120,
      renderCell: ({ row }) => <span dir="ltr">{row.code}</span>,
    },
    {
      field: 'priceMonthly',
      headerName: t('plans.priceMonthly'),
      width: 150,
      valueGetter: (_v, row) => format(row.priceMonthly, row.currency, i18n.language),
    },
    {
      field: 'priceYearly',
      headerName: t('plans.priceYearly'),
      width: 150,
      valueGetter: (_v, row) => format(row.priceYearly, row.currency, i18n.language),
    },
    { field: 'trialDays', headerName: t('plans.trialDays'), width: 110 },
    {
      field: 'limits',
      headerName: t('plans.limits'),
      flex: 1,
      minWidth: 200,
      sortable: false,
      valueGetter: (_v, row) =>
        `${t('plans.staff')}: ${limit(row.limits.staff)} · ${t('plans.chairs')}: ${limit(row.limits.chairs)}`,
    },
    {
      field: 'isActive',
      headerName: t('common.status'),
      width: 110,
      renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 90,
      sortable: false,
      renderCell: ({ row }) => (
        <RowActions
          onEdit={() => setEditing(row)}
          onDelete={() => remove.mutateAsync(row.id)}
          name={row.name}
          deleteTitle={t('plans.deleteTitle', { name: row.name })}
          deletedMessage={t('common.deleted')}
        />
      ),
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('plans.title')}
        subtitle={t('plans.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setEditing('new')}
          >
            {t('plans.new')}
          </Button>
        }
      />
      <DataTable<Plan>
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        clientSide
        columns={columns}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title={t('plans.empty')} description={t('plans.emptyHint')} />}
      />
      {editing && (
        <PlanDrawer plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Box>
  );
}

/* ---------------- global catalogs ---------------- */

const CATALOG_KINDS: CatalogKind[] = [
  'procedures',
  'tooth-conditions',
  'medicines',
  'countries',
  'cities',
  'currencies',
];
const PROCEDURE_CATEGORIES = [
  'diagnostic',
  'preventive',
  'restorative',
  'endodontics',
  'periodontics',
  'prosthodontics',
  'implants',
  'oral_surgery',
  'orthodontics',
  'cosmetic',
  'other',
];

type FieldDef = {
  name: string;
  kind: 'text' | 'code' | 'int' | 'money' | 'bool' | 'color' | 'select';
  required?: boolean;
  max?: number;
  options?: string[];
  min?: number;
  maxValue?: number;
  ltr?: boolean;
};

const FIELDS: Record<CatalogKind, FieldDef[]> = {
  procedures: [
    { name: 'code', kind: 'code', required: true, ltr: true },
    { name: 'name', kind: 'text', max: 120 },
    { name: 'category', kind: 'select', required: true, options: PROCEDURE_CATEGORIES },
    { name: 'defaultDurationMin', kind: 'int', required: true, min: 5, maxValue: 480 },
    { name: 'suggestedPrice', kind: 'money', required: true },
    { name: 'toothRequired', kind: 'bool' },
    { name: 'surfacesRequired', kind: 'bool' },
    { name: 'labRequired', kind: 'bool' },
  ],
  'tooth-conditions': [
    { name: 'code', kind: 'code', required: true, ltr: true },
    { name: 'name', kind: 'text', max: 120 },
    { name: 'color', kind: 'color', required: true },
    { name: 'appliesTo', kind: 'select', required: true, options: ['tooth', 'surface'] },
  ],
  medicines: [
    { name: 'name', kind: 'text', required: true, max: 120 },
    { name: 'form', kind: 'text', max: 60 },
    { name: 'dose', kind: 'text', max: 60 },
    { name: 'frequency', kind: 'text', max: 60 },
    { name: 'days', kind: 'int', min: 0, maxValue: 365 },
    { name: 'group', kind: 'text', max: 60 },
  ],
  countries: [
    { name: 'code', kind: 'code', required: true, ltr: true },
    { name: 'name', kind: 'text', required: true, max: 80 },
    { name: 'dialCode', kind: 'code', ltr: true },
    { name: 'currency', kind: 'code', ltr: true },
  ],
  cities: [
    { name: 'countryCode', kind: 'code', required: true, ltr: true },
    { name: 'name', kind: 'text', required: true, max: 80 },
  ],
  currencies: [
    { name: 'code', kind: 'code', required: true, ltr: true },
    { name: 'name', kind: 'text', required: true, max: 60 },
    { name: 'symbol', kind: 'text', max: 8 },
    { name: 'decimals', kind: 'int', required: true, min: 0, maxValue: 4 },
  ],
};

const CODE_PATTERNS: Record<string, RegExp> = {
  'procedures.code': /^[A-Za-z0-9.-]{2,20}$/,
  'tooth-conditions.code': /^[a-z0-9_]{2,40}$/,
  'countries.code': /^[A-Za-z]{2}$/,
  'countries.dialCode': /^\d{1,4}$/,
  'countries.currency': /^[A-Za-z]{3}$/,
  'cities.countryCode': /^[A-Za-z]{2}$/,
  'currencies.code': /^[A-Za-z]{3}$/,
};

function schemaFor(kind: CatalogKind) {
  const shape: Record<string, z.ZodTypeAny> = { isActive: z.boolean() };
  for (const f of FIELDS[kind]) {
    let s: z.ZodTypeAny;
    if (f.kind === 'bool') s = z.boolean();
    else if (f.kind === 'color') s = color();
    else if (f.kind === 'money') s = money();
    else if (f.kind === 'int')
      s = f.required
        ? intField(f.min ?? 0, f.maxValue ?? 999)
        : z.union([z.literal(''), intField(f.min ?? 0, f.maxValue ?? 999)]).optional();
    else if (f.kind === 'select') s = enumOf(f.options as [string, ...string[]]);
    else if (f.kind === 'code') {
      const base = z
        .string()
        .trim()
        .regex(CODE_PATTERNS[`${kind}.${f.name}`] ?? /.+/, { message: 'invalid_format' });
      s = f.required ? base : z.union([z.literal(''), base]).optional();
    } else s = f.required ? entityName({ max: f.max ?? 120 }) : optional(freeText(f.max ?? 120));
    shape[f.name] = s;
  }
  return z.object(shape);
}

function CatalogDrawer({
  kind,
  item,
  onClose,
}: {
  kind: CatalogKind;
  item: CatalogItem | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const hooks = catalogApi(kind);
  const create = hooks.useCreate();
  const update = hooks.useUpdate();
  const schema = useMemo(() => schemaFor(kind), [kind]);
  const defaults = Object.fromEntries([
    ['isActive', item?.isActive ?? true],
    ...FIELDS[kind].map((f) => [
      f.name,
      item?.[f.name] ??
        (f.kind === 'bool'
          ? false
          : f.kind === 'money'
            ? 0
            : f.kind === 'color'
              ? '#94A3B8'
              : f.kind === 'select'
                ? f.options![0]
                : f.kind === 'int' && f.required
                  ? (f.min ?? 0)
                  : ''),
    ]),
  ]);
  const form = useAppForm<Record<string, unknown>>({ schema, defaultValues: defaults });
  const onSubmit = async (v: Record<string, unknown>) => {
    const body = Object.fromEntries(
      Object.entries(v)
        .filter(([k, x]) => !(x === '' && !FIELDS[kind].find((f) => f.name === k)?.required))
        .map(([k, x]) => [k, k === 'name' && x === '' ? null : x]),
    );
    if (item) await update.mutateAsync({ id: item.id, version: item.version, ...body } as never);
    else await create.mutateAsync(body as never);
    notify.success(t('common.saved'));
    onClose();
  };
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={item ? t('catalog.edit') : t('catalog.new')}
      subtitle={t(`catalog.kinds.${kind}`)}
      formId="admin-catalog-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={520}
    >
      <Form form={form} name={`admin.catalog.${kind}`} id="admin-catalog-form" onSubmit={onSubmit}>
        <Grid container spacing={3}>
          {FIELDS[kind].map((f) => {
            const label = t(`catalog.fields.${f.name}`);
            return (
              <Grid item xs={12} md={f.kind === 'bool' ? 12 : 6} key={f.name}>
                {f.kind === 'bool' ? (
                  <RHFCheckbox name={f.name} label={label} asSwitch />
                ) : f.kind === 'color' ? (
                  <RHFColor name={f.name} label={label} />
                ) : f.kind === 'money' ? (
                  <RHFMoney name={f.name} label={label} currency="JOD" required={f.required} />
                ) : f.kind === 'select' ? (
                  <RHFSelect
                    name={f.name}
                    label={label}
                    required={f.required}
                    options={f.options!.map((o) => ({
                      value: o,
                      label: t(`catalog.options.${o}`, { defaultValue: o }),
                    }))}
                  />
                ) : (
                  <RHFTextField
                    name={f.name}
                    label={label}
                    required={f.required}
                    type={f.kind === 'int' ? 'number' : 'text'}
                    {...(f.max ? { maxLength: f.max } : {})}
                    {...(f.ltr ? { inputProps: { dir: 'ltr' } } : {})}
                    {...(f.name === 'name' && (kind === 'procedures' || kind === 'tooth-conditions')
                      ? { helperText: t('catalog.nameHint') }
                      : {})}
                    disabled={Boolean(item) && f.name === 'code'}
                  />
                )}
              </Grid>
            );
          })}
          <Grid item xs={12}>
            <RHFCheckbox name="isActive" label={t('common.active')} asSwitch />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

function CatalogTable({ kind }: { kind: CatalogKind }) {
  const { t } = useTranslation('admin');
  const lp = useListParams({ limit: 25 });
  const hooks = catalogApi(kind);
  const list = hooks.useList({ ...lp.params, includeInactive: 'true' });
  const remove = hooks.useRemove();
  const [editing, setEditing] = useState<CatalogItem | null | 'new'>(null);
  const seedName = useSeedName(kind === 'procedures' ? 'procedure' : 'condition');
  const display = (row: CatalogItem) =>
    kind === 'procedures' || kind === 'tooth-conditions'
      ? seedName({ name: (row.name as string | null) ?? null, systemKey: String(row.code) })
      : String(row.name ?? '');
  const shown = FIELDS[kind]
    .filter((f) => !['bool', 'money'].includes(f.kind) || f.name === 'suggestedPrice')
    .slice(0, 4);
  const columns: Column<CatalogItem>[] = [
    ...shown.map((f): Column<CatalogItem> => ({
      field: f.name,
      headerName: t(`catalog.fields.${f.name}`),
      flex: f.name === 'name' ? 1.4 : 1,
      minWidth: f.name === 'name' ? 180 : 110,
      sortable: ['code', 'name'].includes(f.name),
      renderCell: ({ row }) =>
        f.name === 'name' ? (
          <span dir="auto">{display(row)}</span>
        ) : f.kind === 'color' ? (
          <ColorDot color={String(row[f.name] ?? '')} />
        ) : f.kind === 'money' ? (
          format(Number(row[f.name] ?? 0), 'JOD')
        ) : f.kind === 'select' ? (
          t(`catalog.options.${String(row[f.name])}`, { defaultValue: String(row[f.name] ?? '') })
        ) : (
          <span dir={f.ltr ? 'ltr' : 'auto'}>{String(row[f.name] ?? '')}</span>
        ),
    })),
    {
      field: 'isActive',
      headerName: t('common.status'),
      width: 110,
      renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 90,
      sortable: false,
      renderCell: ({ row }) => (
        <RowActions
          onEdit={() => setEditing(row)}
          onDelete={() => remove.mutateAsync(row.id)}
          name={display(row) || String(row.code ?? '')}
          deleteTitle={t('catalog.deleteTitle')}
          deleteBody={t('catalog.deleteBody')}
          deletedMessage={t('common.deleted')}
        />
      ),
    },
  ];
  return (
    <>
      <DataTable<CatalogItem>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        searchable
        toolbar={
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setEditing('new')}
          >
            {t('catalog.new')}
          </Button>
        }
        columns={columns}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title={t('catalog.empty')} />}
      />
      {editing && (
        <CatalogDrawer
          kind={kind}
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export function CatalogPage() {
  const { t } = useTranslation('admin');
  const lp = useListParams();
  const kind = (
    CATALOG_KINDS.includes(lp.filter('tab') as CatalogKind) ? lp.filter('tab') : 'procedures'
  ) as CatalogKind;
  return (
    <Box>
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')} />
      <Tabs
        value={kind}
        onChange={(_e, v: string) =>
          lp.set({ tab: v === 'procedures' ? undefined : v, page: 1, q: undefined })
        }
        variant="scrollable"
        sx={{ mb: 3 }}
      >
        {CATALOG_KINDS.map((k) => (
          <Tab key={k} value={k} label={t(`catalog.kinds.${k}`)} />
        ))}
      </Tabs>
      <CatalogTable key={kind} kind={kind} />
    </Box>
  );
}

/* ---------------- role templates ---------------- */

export function RoleTemplatesPage() {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const confirm = useConfirm();
  const roleName = useSeedName('roles');
  const templates = useRoleTemplates();
  const registry = useClinicPermissionRegistry();
  const muts = useRoleTemplateMutations();
  const [key, setKey] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const selected = templates.data?.find((x) => x.key === (key ?? templates.data?.[0]?.key));
  useEffect(() => {
    if (selected) setGrants(selected.permissions);
  }, [selected]);
  if (templates.isLoading || registry.isLoading) return <PageSkeleton rows={6} />;
  if (templates.error || registry.error || !registry.data)
    return (
      <ErrorState
        error={templates.error ?? registry.error}
        onRetry={() => void templates.refetch()}
      />
    );
  const locked = selected?.key === 'owner';
  const dirty = selected ? JSON.stringify(grants) !== JSON.stringify(selected.permissions) : false;
  return (
    <Box>
      <PageHeader title={t('roleTemplates.title')} subtitle={t('roleTemplates.subtitle')} />
      <Alert severity="info" sx={{ mb: 3 }}>
        {t('roleTemplates.newClinicsOnly')}
      </Alert>
      <Grid container spacing={3}>
        <Grid item xs={12} md={3}>
          <SectionCard title={t('roleTemplates.list')} noPadding>
            <List dense>
              {(templates.data ?? []).map((tpl) => (
                <ListItemButton
                  key={tpl.key}
                  selected={tpl.key === selected?.key}
                  onClick={() => setKey(tpl.key)}
                >
                  <ListItemText
                    primary={roleName({ name: tpl.name, systemKey: tpl.systemKey ?? tpl.key })}
                  />
                  {tpl.customized && (
                    <Chip
                      size="small"
                      color="info"
                      variant="outlined"
                      label={t('roleTemplates.customized')}
                    />
                  )}
                </ListItemButton>
              ))}
            </List>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={9}>
          {selected && (
            <SectionCard
              title={roleName({
                name: selected.name,
                systemKey: selected.systemKey ?? selected.key,
              })}
              actions={
                <Stack direction="row" spacing={1}>
                  {selected.customized && (
                    <Button
                      startIcon={<RotateCcw size={16} />}
                      onClick={async () => {
                        const r = await confirm({
                          title: t('roleTemplates.resetTitle'),
                          body: t('roleTemplates.resetBody'),
                        });
                        if (r.confirmed)
                          await muts.reset
                            .mutateAsync(selected.key)
                            .then(() => notify.success(t('roleTemplates.resetDone')), notify.error);
                      }}
                    >
                      {t('roleTemplates.reset')}
                    </Button>
                  )}
                  {!locked && (
                    <Button
                      variant="contained"
                      disabled={!dirty || muts.save.isPending}
                      onClick={() =>
                        void muts.save
                          .mutateAsync({
                            key: selected.key,
                            version: selected.version,
                            permissions: grants,
                          })
                          .then(() => notify.success(t('common.saved')), notify.error)
                      }
                    >
                      {t('common.save')}
                    </Button>
                  )}
                </Stack>
              }
            >
              {locked ? (
                <Typography color="text.secondary">
                  {t('roleTemplates.fullAccessLocked')}
                </Typography>
              ) : (
                <PermissionEditor registry={registry.data} value={grants} onChange={setGrants} />
              )}
            </SectionCard>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
