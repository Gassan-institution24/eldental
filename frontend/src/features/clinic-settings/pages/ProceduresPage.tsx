import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Download, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  entityName,
  enumOf,
  money,
  objectId,
  optional,
} from '@/shared/generated/validation/fields';
import { RowActions } from '@/shared/components/CrudBits';
import { DataTable, useListParams } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { toSearchName } from '@/shared/generated/validation/normalize';
import {
  PROCEDURE_CATEGORIES,
  proceduresApi,
  taxRatesApi,
  useCatalogProcedures,
  useImportProcedures,
  type ClinicProcedure,
  type ProcedureCategory,
} from '../api';

const schema = z.object({
  code: z.string().trim().min(1, { message: 'required' }).max(16, { message: 'too_long' }),
  name: entityName({ max: 120 }),
  category: enumOf([...PROCEDURE_CATEGORIES]),
  price: money(),
  taxRateId: optional(objectId()),
  defaultDurationMin: z.coerce
    .number()
    .int({ message: 'invalid' })
    .min(5, { message: 'too_small' })
    .max(480, { message: 'too_big' }),
  toothRequired: z.boolean(),
  surfacesRequired: z.boolean(),
  labRequired: z.boolean(),
  commissionEligible: z.boolean(),
  isActive: z.boolean(),
});
type ProcForm = z.input<typeof schema>;

function ProcedureDrawer({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: ClinicProcedure | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('procedure');
  const catName = useSeedName('category');
  const taxName = useSeedName('taxRate');
  const currency = useCurrency();
  const notify = useNotify();
  const taxes = taxRatesApi.useAll();
  const create = proceduresApi.useCreate();
  const update = proceduresApi.useUpdate();
  const empty: ProcForm = {
    code: '',
    name: '',
    category: 'restorative',
    price: 0,
    taxRateId: '',
    defaultDurationMin: 30,
    toothRequired: false,
    surfacesRequired: false,
    labRequired: false,
    commissionEligible: true,
    isActive: true,
  };
  const form = useAppForm<ProcForm>({
    schema,
    defaultValues: empty,
    values: item
      ? {
          code: item.code,
          name: seedName(item),
          category: item.category,
          price: item.price,
          taxRateId: item.taxRateId ?? '',
          defaultDurationMin: item.defaultDurationMin,
          toothRequired: item.toothRequired,
          surfacesRequired: item.surfacesRequired,
          labRequired: item.labRequired,
          commissionEligible: item.commissionEligible,
          isActive: item.isActive,
        }
      : empty,
  });
  const onSubmit = async (v: ProcForm) => {
    const body = {
      ...v,
      taxRateId: v.taxRateId || null,
      name: item && !item.name && v.name === seedName(item) ? null : v.name,
    } as unknown as Partial<ClinicProcedure>;
    if (item) await update.mutateAsync({ id: item.id, version: item.version, ...body });
    else await create.mutateAsync(body);
    notify.success(item ? t('procedures.updated') : t('procedures.created'));
    onClose();
  };
  return (
    <FormDrawer
      open={open}
      title={item ? t('procedures.edit') : t('procedures.add')}
      subtitle={item?.code}
      onClose={onClose}
      formId="proc-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={560}
    >
      <Form form={form} name="settings.procedure" onSubmit={onSubmit} id="proc-form" requiredLegend>
        <Grid container spacing={4}>
          <Grid item xs={4}>
            <RHFTextField
              name="code"
              label={t('procedures.code')}
              required
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={8}>
            <RHFTextField
              name="name"
              label={t('procedures.name')}
              required
              autoFocus
              maxLength={120}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect
              name="category"
              label={t('procedures.category')}
              required
              options={PROCEDURE_CATEGORIES.map((c) => ({
                value: c,
                label: catName({ systemKey: c }),
              }))}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFTextField
              name="defaultDurationMin"
              label={t('procedures.duration')}
              type="number"
              inputProps={{ dir: 'ltr', step: 5 }}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFMoney name="price" label={t('procedures.price')} currency={currency} required />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect
              name="taxRateId"
              label={t('procedures.tax')}
              clearable
              options={(taxes.data ?? []).map((x) => ({
                value: x.id,
                label: `${taxName(x)} · ${(x.rate / 100).toFixed(0)}%`,
              }))}
            />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
              {t('procedures.flags')}
            </Typography>
            <RHFCheckbox name="toothRequired" label={t('procedures.toothRequired')} />
            <RHFCheckbox name="surfacesRequired" label={t('procedures.surfacesRequired')} />
            <RHFCheckbox name="labRequired" label={t('procedures.labRequired')} />
            <RHFCheckbox name="commissionEligible" label={t('procedures.commission')} />
            <RHFCheckbox name="isActive" label={t('procedures.active')} asSwitch />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

function ImportDialog({
  open,
  onClose,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  existing: Set<string>;
}) {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('procedure');
  const catName = useSeedName('category');
  const notify = useNotify();
  const catalog = useCatalogProcedures(open);
  const importer = useImportProcedures();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ProcedureCategory | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [factor, setFactor] = useState(100);

  const visible = useMemo(() => {
    const needle = toSearchName(q);
    return (catalog.data ?? []).filter(
      (p) =>
        (!category || p.category === category) &&
        (!needle || toSearchName(`${p.code} ${seedName(p)}`).includes(needle)),
    );
  }, [catalog.data, q, category, seedName]);

  const toggle = (code: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });

  const run = async () => {
    try {
      const r = await importer.mutateAsync({ codes: [...selected], priceFactorPercent: factor });
      notify.success(t('procedures.imported', r));
      setSelected(new Set());
      onClose();
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>
        {t('procedures.importTitle')}
        <Typography variant="body2" color="text.secondary">
          {t('procedures.importSubtitle')}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mb: 4 }}>
          <TextField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common:actions.search')}
            inputProps={{ dir: 'auto' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            select
            value={category}
            onChange={(e) => setCategory(e.target.value as ProcedureCategory | '')}
            label={t('procedures.category')}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{t('procedures.allCategories')}</MenuItem>
            {PROCEDURE_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {catName({ systemKey: c })}
              </MenuItem>
            ))}
          </TextField>
          <Button
            onClick={() =>
              setSelected(
                (s) =>
                  new Set([
                    ...s,
                    ...visible.filter((p) => !existing.has(p.code)).map((p) => p.code),
                  ]),
              )
            }
            sx={{ whiteSpace: 'nowrap' }}
          >
            {t('procedures.selectAll')}
          </Button>
        </Stack>
        <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
          {visible.map((p) => {
            const inList = existing.has(p.code);
            return (
              <ListItemButton
                key={p.code}
                onClick={() => !inList && toggle(p.code)}
                disabled={inList}
                sx={{ borderRadius: 2 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Checkbox
                    edge="start"
                    checked={inList || selected.has(p.code)}
                    tabIndex={-1}
                    disableRipple
                    inputProps={{ 'aria-label': seedName(p) }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ fontFamily: 'monospace', color: 'text.secondary' }}
                        dir="ltr"
                      >
                        {p.code}
                      </Typography>
                      <span>{seedName(p)}</span>
                    </Stack>
                  }
                  secondary={catName({ systemKey: p.category })}
                />
                {inList ? (
                  <Chip size="small" label={t('procedures.inList')} />
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    <MoneyText value={Math.round((p.suggestedPrice * factor) / 100 / 10) * 10} />
                  </Typography>
                )}
              </ListItemButton>
            );
          })}
        </List>
        <Box sx={{ mt: 4, px: 2 }}>
          <Typography variant="body2" fontWeight={700}>
            {t('procedures.priceFactor')}
          </Typography>
          <Slider
            value={factor}
            min={50}
            max={250}
            step={5}
            onChange={(_e, v) => setFactor(v as number)}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}%`}
            aria-label={t('procedures.priceFactor')}
          />
          <Typography variant="caption" color="text.secondary">
            {t('procedures.priceFactorHelper', { percent: factor })}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 6, py: 4 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {t('procedures.selected', { count: selected.size })}
        </Typography>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={!selected.size || importer.isPending}
          onClick={() => void run()}
        >
          {t('procedures.importAction', { count: selected.size })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ProceduresPage() {
  const { t } = useTranslation('settings');
  const seedName = useSeedName('procedure');
  const catName = useSeedName('category');
  const lp = useListParams({ sort: 'code' });
  const category = lp.filter('category');
  const list = proceduresApi.useList({
    ...lp.params,
    category: category || undefined,
    includeInactive: 'true',
  });
  const all = proceduresApi.useList({ limit: 100, includeInactive: 'true' });
  const remove = proceduresApi.useRemove();
  const restore = proceduresApi.useRestore();
  const [editing, setEditing] = useState<ClinicProcedure | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const existing = useMemo(() => new Set((all.data?.data ?? []).map((p) => p.code)), [all.data]);
  const edit = (r: ClinicProcedure | null) => {
    setEditing(r);
    setOpen(true);
  };

  return (
    <SectionCard
      title={t('procedures.title')}
      subtitle={t('procedures.subtitle')}
      noPadding
      actions={
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<Download size={18} />}
            onClick={() => setImportOpen(true)}
          >
            {t('procedures.import')}
          </Button>
          <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => edit(null)}>
            {t('procedures.add')}
          </Button>
        </Stack>
      }
    >
      <DataTable<ClinicProcedure>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={edit}
        toolbar={
          <TextField
            select
            size="small"
            value={category}
            onChange={(e) => lp.set({ category: e.target.value, page: 1 })}
            label={t('procedures.category')}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">{t('procedures.allCategories')}</MenuItem>
            {PROCEDURE_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {catName({ systemKey: c })}
              </MenuItem>
            ))}
          </TextField>
        }
        empty={
          <EmptyState
            title={t('procedures.empty')}
            description={t('procedures.emptyHint')}
            action={
              <Button
                variant="contained"
                startIcon={<Download size={18} />}
                onClick={() => setImportOpen(true)}
              >
                {t('procedures.import')}
              </Button>
            }
            compact
          />
        }
        columns={[
          {
            field: 'code',
            headerName: t('procedures.code'),
            width: 110,
            sortable: true,
            renderCell: (p) => (
              <Box component="span" dir="ltr" sx={{ fontFamily: 'monospace' }}>
                {p.row.code}
              </Box>
            ),
          },
          {
            field: 'name',
            headerName: t('procedures.name'),
            flex: 1,
            minWidth: 220,
            renderCell: (p) => <span dir="auto">{seedName(p.row)}</span>,
          },
          {
            field: 'category',
            headerName: t('procedures.category'),
            width: 160,
            sortable: true,
            renderCell: (p) => catName({ systemKey: p.row.category }),
          },
          {
            field: 'price',
            headerName: t('procedures.price'),
            width: 140,
            sortable: true,
            renderCell: (p) => <MoneyText value={p.row.price} sx={{ fontWeight: 650 }} />,
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
            renderCell: (p) => (
              <RowActions
                name={seedName(p.row)}
                onEdit={() => edit(p.row)}
                onDelete={() => remove.mutateAsync(p.row.id)}
                onUndo={() => restore.mutateAsync(p.row.id)}
                deleteTitle={t('procedures.deleteTitle', { name: seedName(p.row) })}
                deletedMessage={t('procedures.deleted')}
              />
            ),
          },
        ]}
      />
      <ProcedureDrawer open={open} item={editing} onClose={() => setOpen(false)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} existing={existing} />
    </SectionCard>
  );
}
