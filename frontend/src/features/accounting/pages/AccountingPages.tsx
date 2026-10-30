import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Lock, LockOpen, MoreVertical, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { taxRatesApi } from '@/features/clinic-settings/api';
import { useEInvoices, useResubmitEInvoice } from '@/features/billing/api';
import { formatDate, todayLocal } from '@/lib/dates';
import {
  dateOnly,
  email,
  entityName,
  freeText,
  objectId,
  optional,
  phone,
  requiredText,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { MoneyInput } from '@/shared/form/MoneyInput';
import { RHFCheckbox, RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  ACCOUNT_TYPES,
  suppliersApi,
  useAccountLookup,
  useAccountMutations,
  useBillMutations,
  useBills,
  useExpenseMutations,
  useExpenses,
  useFiscalPeriods,
  useJournalMutations,
  useJournals,
  usePeriodMutations,
  useSupplierPayments,
  type Account,
  type Bill,
  type Expense,
  type Journal,
  type Supplier,
} from '../api';

const money = z
  .number({ invalid_type_error: 'invalid_amount' })
  .int({ message: 'too_many_decimals' })
  .min(0, { message: 'invalid_amount' });

/** Account picker over postable accounts, optionally limited by type. */
function AccountField({
  name,
  label,
  types,
  required,
}: {
  name: string;
  label: string;
  types?: string[];
  required?: boolean;
}) {
  const lookup = useAccountLookup();
  const options = lookup.postable.filter(
    (a) => !types || types.includes(a.type) || types.includes(a.subtype),
  );
  return (
    <Controller
      name={name}
      render={({ field, fieldState }) => (
        <Autocomplete
          size="small"
          options={options}
          value={lookup.byId.get(field.value as string) ?? null}
          onChange={(_e, v) => field.onChange(v?.id ?? '')}
          getOptionLabel={(o) => lookup.label(o)}
          renderInput={(p) => (
            <TextField
              {...p}
              name={name}
              label={required ? `${label} *` : label}
              error={Boolean(fieldState.error)}
              helperText={fieldState.error ? ' ' : undefined}
            />
          )}
        />
      )}
    />
  );
}

/* ---------------- chart of accounts ---------------- */

export function AccountsPage() {
  const { t } = useTranslation('accounting');
  const lookup = useAccountLookup();
  const { can } = usePermission();
  const [editing, setEditing] = useState<Account | 'new' | null>(null);
  const rows = useMemo(() => {
    const depth = (a: Account): number =>
      a.parentId ? 1 + depth(lookup.byId.get(a.parentId) ?? { ...a, parentId: undefined }) : 0;
    return lookup.list.map((a) => ({ ...a, depth: depth(a) }));
  }, [lookup.list, lookup.byId]);
  if (lookup.isLoading) return <PageSkeleton rows={10} />;
  if (lookup.error) return <ErrorState error={lookup.error} />;
  return (
    <Box>
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        primary={
          can('accounting.account.manage') && (
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() => setEditing('new')}
            >
              {t('accounts.add')}
            </Button>
          )
        }
      />
      <Card variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 120 }}>{t('accounts.code')}</TableCell>
              <TableCell>{t('accounts.name')}</TableCell>
              <TableCell sx={{ width: 140 }}>{t('accounts.type')}</TableCell>
              <TableCell sx={{ width: 160 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((a) => (
              <TableRow
                key={a.id}
                hover
                sx={{
                  cursor: can('accounting.account.manage') ? 'pointer' : 'default',
                  opacity: a.isActive ? 1 : 0.5,
                }}
                onClick={() => can('accounting.account.manage') && setEditing(a)}
              >
                <TableCell dir="ltr" sx={{ fontWeight: a.isGroup ? 800 : 400 }}>
                  {a.code}
                </TableCell>
                <TableCell
                  sx={{
                    paddingInlineStart: `${16 + a.depth * 20}px`,
                    fontWeight: a.isGroup ? 800 : 400,
                  }}
                  dir="auto"
                >
                  {lookup.name(a)}
                </TableCell>
                <TableCell>{t(`types.${a.type}`)}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1}>
                    {a.isGroup && (
                      <Chip size="small" variant="outlined" label={t('accounts.group')} />
                    )}
                    {a.isSystem && (
                      <Chip
                        size="small"
                        color="info"
                        variant="outlined"
                        label={t('accounts.system')}
                      />
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {editing && (
        <AccountDrawer
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Box>
  );
}

const accountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{3,8}$/, { message: 'invalid_format' }),
  name: entityName({ max: 120 }),
  type: z.enum(ACCOUNT_TYPES),
  parentId: optional(objectId()),
  isGroup: z.boolean(),
  isActive: z.boolean(),
});
type AccountValues = z.input<typeof accountSchema>;

function AccountDrawer({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { t } = useTranslation('accounting');
  const notify = useNotify();
  const confirm = useConfirm();
  const lookup = useAccountLookup();
  const muts = useAccountMutations();
  const form = useAppForm<AccountValues>({
    schema: accountSchema,
    defaultValues: {
      code: account?.code ?? '',
      name: account ? lookup.name(account) : '',
      type: account?.type ?? 'expense',
      parentId: account?.parentId ?? '',
      isGroup: account?.isGroup ?? false,
      isActive: account?.isActive ?? true,
    },
  });
  const type = useWatch({ control: form.control, name: 'type' });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={account ? t('accounts.edit') : t('accounts.add')}
      formId="account-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      extraActions={
        account && !account.isSystem ? (
          <Button
            color="error"
            startIcon={<Trash2 size={16} />}
            onClick={async () => {
              const r = await confirm({
                title: t('accounts.deleteTitle', { code: account.code }),
                destructive: true,
              });
              if (r.confirmed)
                await muts.remove
                  .mutateAsync(account.id)
                  .then(() => (notify.success(t('accounts.deleted')), onClose()), notify.error);
            }}
          >
            {t('accounts.delete')}
          </Button>
        ) : undefined
      }
    >
      <Form
        form={form}
        name="accounting.account"
        id="account-form"
        onSubmit={async (v) => {
          if (account)
            await muts.update.mutateAsync({
              id: account.id,
              code: v.code,
              name: v.name,
              isActive: v.isActive,
              parentId: v.parentId || null,
            });
          else
            await muts.create.mutateAsync({
              code: v.code,
              name: v.name,
              type: v.type,
              isGroup: v.isGroup,
              isActive: v.isActive,
              ...(v.parentId ? { parentId: v.parentId } : {}),
            });
          notify.success(t('accounts.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          {account?.isSystem && <Alert severity="info">{t('accounts.systemHint')}</Alert>}
          <RHFTextField
            name="code"
            label={t('accounts.code')}
            required
            inputProps={{ dir: 'ltr' }}
          />
          <RHFTextField name="name" label={t('accounts.name')} required maxLength={120} />
          <RHFSelect
            name="type"
            label={t('accounts.type')}
            options={ACCOUNT_TYPES.map((x) => ({ value: x, label: t(`types.${x}`) }))}
            disabled={Boolean(account)}
          />
          <RHFSelect
            name="parentId"
            label={t('accounts.parent')}
            clearable
            options={lookup.list
              .filter((a) => a.isGroup && a.type === type && a.id !== account?.id)
              .map((a) => ({ value: a.id, label: lookup.label(a) }))}
          />
          {!account && <RHFCheckbox name="isGroup" label={t('accounts.isGroup')} />}
          <RHFCheckbox name="isActive" label={t('accounts.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- journals ---------------- */

export function JournalsPage() {
  const { t, i18n } = useTranslation('accounting');
  const lp = useListParams();
  const { can } = usePermission();
  const notify = useNotify();
  const confirm = useConfirm();
  const list = useJournals({
    ...lp.params,
    source: lp.filter('source') || undefined,
    status: lp.filter('status') || undefined,
  });
  const muts = useJournalMutations();
  const lookup = useAccountLookup();
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<Journal | null>(null);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const columns: Column<Journal>[] = [
    {
      field: 'number',
      headerName: t('journals.number'),
      width: 160,
      renderCell: ({ row }) => <span dir="ltr">{row.number ?? t('journals.draft')}</span>,
    },
    {
      field: 'date',
      headerName: t('journals.date'),
      width: 120,
      valueGetter: (_v, row) => formatDate(row.date, i18n.language, 'll'),
    },
    {
      field: 'source',
      headerName: t('journals.source'),
      width: 150,
      valueGetter: (_v, row) => t(`sources.${row.source}`, { defaultValue: row.source }),
    },
    { field: 'memo', headerName: t('journals.memo'), flex: 1, minWidth: 200 },
    {
      field: 'total',
      headerName: t('journals.total'),
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => <MoneyText value={row.total} />,
    },
    {
      field: 'status',
      headerName: t('journals.status'),
      width: 120,
      renderCell: ({ row }) => (
        <StatusChip status={row.status === 'posted' ? 'posted' : row.status} />
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 120,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" onClick={(e) => e.stopPropagation()}>
          {row.status === 'draft' && can('accounting.journal.post') && (
            <Tooltip title={t('journals.post')}>
              <IconButton
                size="small"
                aria-label={t('journals.post')}
                onClick={() => run(muts.post.mutateAsync(row.id), t('journals.posted'))}
              >
                <Send size={16} />
              </IconButton>
            </Tooltip>
          )}
          {row.status === 'draft' && (
            <IconButton
              size="small"
              aria-label={t('journals.delete')}
              onClick={() => run(muts.remove.mutateAsync(row.id), t('journals.deleted'))}
            >
              <Trash2 size={16} />
            </IconButton>
          )}
          {row.status === 'posted' &&
            ['manual', 'opening'].includes(row.source) &&
            can('accounting.journal.reverse') && (
              <Tooltip title={t('journals.reverse')}>
                <IconButton
                  size="small"
                  aria-label={t('journals.reverse')}
                  onClick={async () => {
                    const r = await confirm({
                      title: t('journals.reverseTitle', { number: row.number }),
                      reason: { label: t('journals.reason'), required: true, max: 300 },
                    });
                    if (r.confirmed)
                      run(
                        muts.reverse.mutateAsync({ id: row.id, reason: r.reason ?? '' }),
                        t('journals.reversed'),
                      );
                  }}
                >
                  <RotateCcw size={16} />
                </IconButton>
              </Tooltip>
            )}
        </Stack>
      ),
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('journals.title')}
        subtitle={t('journals.subtitle')}
        primary={
          can('accounting.journal.create') && (
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() => setCreating(true)}
            >
              {t('journals.new')}
            </Button>
          )
        }
      />
      <DataTable<Journal>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setViewing(r)}
        columns={columns}
        toolbar={
          <Stack direction="row" spacing={2}>
            <TextField
              select
              size="small"
              label={t('journals.source')}
              value={lp.filter('source')}
              onChange={(e) => lp.set({ source: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">{t('journals.allSources')}</MenuItem>
              {[
                'manual',
                'invoice',
                'credit_note',
                'payment',
                'refund',
                'expense',
                'supplier_bill',
                'supplier_payment',
                'payroll',
                'reversal',
                'void',
                'cash_session',
                'closing',
              ].map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`sources.${s}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('journals.status')}
              value={lp.filter('status')}
              onChange={(e) => lp.set({ status: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{t('journals.allStatuses')}</MenuItem>
              <MenuItem value="draft">{t('journals.draft')}</MenuItem>
              <MenuItem value="posted">{t('journals.postedStatus')}</MenuItem>
              <MenuItem value="reversed">{t('journals.reversedStatus')}</MenuItem>
            </TextField>
          </Stack>
        }
        empty={<EmptyState title={t('journals.empty')} />}
      />
      {creating && <JournalDrawer onClose={() => setCreating(false)} />}
      {viewing && (
        <Dialog open onClose={() => setViewing(null)} fullWidth maxWidth="md">
          <DialogTitle>
            {viewing.number ?? t('journals.draft')} · {formatDate(viewing.date, i18n.language)}
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} dir="auto">
              {viewing.memo}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('journals.account')}</TableCell>
                  <TableCell>{t('journals.description')}</TableCell>
                  <TableCell align="right">{t('journals.debit')}</TableCell>
                  <TableCell align="right">{t('journals.credit')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {viewing.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell dir="auto">{lookup.label(l.accountId)}</TableCell>
                    <TableCell dir="auto">{l.description}</TableCell>
                    <TableCell align="right">
                      {l.debit ? <MoneyText value={l.debit} /> : ''}
                    </TableCell>
                    <TableCell align="right">
                      {l.credit ? <MoneyText value={l.credit} /> : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setViewing(null)}>{t('actions.close', { ns: 'common' })}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

const jLine = z
  .object({
    accountId: objectId(),
    debit: money,
    credit: money,
    description: optional(freeText(200)),
  })
  .superRefine((l, ctx) => {
    if (l.debit > 0 === l.credit > 0)
      ctx.addIssue({ code: 'custom', path: ['debit'], message: 'invalid_amount' });
  });
const journalSchema = z
  .object({
    date: dateOnly(),
    memo: requiredText(300),
    lines: z.array(jLine).min(2, { message: 'too_few' }).max(50),
  })
  .superRefine((v, ctx) => {
    const d = v.lines.reduce((s, l) => s + l.debit, 0);
    const c = v.lines.reduce((s, l) => s + l.credit, 0);
    if (d !== c) ctx.addIssue({ code: 'custom', path: ['memo'], message: 'not_balanced' });
  });
type JournalValues = z.input<typeof journalSchema>;

function JournalDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('accounting');
  const notify = useNotify();
  const currency = useCurrency();
  const muts = useJournalMutations();
  const { can } = usePermission();
  const form = useAppForm<JournalValues>({
    schema: journalSchema,
    defaultValues: {
      date: todayLocal(),
      memo: '',
      lines: [
        { accountId: '', debit: 0, credit: 0, description: '' },
        { accountId: '', debit: 0, credit: 0, description: '' },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const d = (lines ?? []).reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const c = (lines ?? []).reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const [postNow, setPostNow] = useState(false);
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('journals.new')}
      subtitle={t('journals.newHint')}
      formId="journal-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={860}
    >
      <Form
        form={form}
        name="accounting.journal"
        id="journal-form"
        onSubmit={async (v) => {
          const draft = await muts.create.mutateAsync({
            date: v.date,
            memo: v.memo,
            lines: v.lines.map((l) => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              ...(l.description ? { description: l.description } : {}),
            })),
          });
          if (postNow) await muts.post.mutateAsync(draft.id);
          notify.success(postNow ? t('journals.posted') : t('journals.savedDraft'));
          onClose();
        }}
      >
        <Stack spacing={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={4}>
              <RHFDate name="date" label={t('journals.date')} required />
            </Grid>
            <Grid item xs={12} sm={8}>
              <RHFTextField name="memo" label={t('journals.memo')} required maxLength={300} />
            </Grid>
          </Grid>
          {fields.map((f, i) => (
            <Grid container spacing={2} key={f.id} alignItems="center">
              <Grid item xs={12} md={4.5}>
                <AccountField
                  name={`lines.${i}.accountId`}
                  label={t('journals.account')}
                  required
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <RHFTextField
                  name={`lines.${i}.description`}
                  label={t('journals.description')}
                  size="small"
                  maxLength={200}
                />
              </Grid>
              <Grid item xs={5} md={2}>
                <RHFMoney
                  currency={currency}
                  name={`lines.${i}.debit`}
                  label={t('journals.debit')}
                />
              </Grid>
              <Grid item xs={5} md={2}>
                <RHFMoney
                  currency={currency}
                  name={`lines.${i}.credit`}
                  label={t('journals.credit')}
                />
              </Grid>
              <Grid item xs={2} md={0.5}>
                <IconButton
                  aria-label={t('journals.removeLine')}
                  onClick={() => remove(i)}
                  disabled={fields.length <= 2}
                >
                  <Trash2 size={16} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          <Button
            startIcon={<Plus size={16} />}
            onClick={() => append({ accountId: '', debit: 0, credit: 0, description: '' })}
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('journals.addLine')}
          </Button>
          <Alert severity={d === c && d > 0 ? 'success' : 'warning'}>
            {t('journals.totals')}: <MoneyText value={d} /> / <MoneyText value={c} />{' '}
            {d !== c ? `· ${t('journals.difference')} ` : ''}
            {d !== c && <MoneyText value={Math.abs(d - c)} />}
          </Alert>
          {can('accounting.journal.post') && (
            <Stack direction="row" alignItems="center" spacing={1}>
              <input
                id="post-now"
                type="checkbox"
                checked={postNow}
                onChange={(e) => setPostNow(e.target.checked)}
              />
              <label htmlFor="post-now">{t('journals.postNow')}</label>
            </Stack>
          )}
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- suppliers ---------------- */

const SUPPLIER_KINDS = ['lab', 'supplies', 'equipment', 'services', 'other'] as const;
const supplierSchema = z.object({
  name: entityName({ max: 120 }),
  kind: z.enum(SUPPLIER_KINDS),
  taxNumber: optional(freeText(20)),
  phone: optional(phone()),
  email: optional(email()),
  person: optional(freeText(80)),
  notes: optional(freeText(1000)),
  isActive: z.boolean(),
});
type SupplierValues = z.input<typeof supplierSchema>;

export function SuppliersPage() {
  const { t } = useTranslation('accounting');
  const list = suppliersApi.useAll({ includeInactive: 'true' });
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  return (
    <Box>
      <PageHeader
        title={t('suppliers.title')}
        subtitle={t('suppliers.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setEditing('new')}
          >
            {t('suppliers.add')}
          </Button>
        }
      />
      <DataTable<Supplier>
        clientSide
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title={t('suppliers.empty')} />}
        columns={[
          { field: 'name', headerName: t('suppliers.name'), flex: 1, minWidth: 200 },
          {
            field: 'kind',
            headerName: t('suppliers.kind'),
            width: 140,
            valueGetter: (_v, row) => t(`suppliers.kinds.${row.kind}`),
          },
          {
            field: 'phone',
            headerName: t('suppliers.phone'),
            width: 160,
            valueGetter: (_v, row) => row.contact?.phone ?? '',
          },
          {
            field: 'balance',
            headerName: t('suppliers.balance'),
            width: 140,
            align: 'right',
            headerAlign: 'right',
            renderCell: ({ row }) => <MoneyText value={row.balance} />,
          },
          {
            field: 'isActive',
            headerName: t('suppliers.status'),
            width: 120,
            renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} />,
          },
        ]}
      />
      {editing && (
        <SupplierDrawer
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Box>
  );
}

function SupplierDrawer({ supplier, onClose }: { supplier: Supplier | null; onClose: () => void }) {
  const { t } = useTranslation('accounting');
  const notify = useNotify();
  const create = suppliersApi.useCreate();
  const update = suppliersApi.useUpdate();
  const form = useAppForm<SupplierValues>({
    schema: supplierSchema,
    defaultValues: {
      name: supplier?.name ?? '',
      kind: supplier?.kind ?? 'supplies',
      taxNumber: supplier?.taxNumber ?? '',
      phone: supplier?.contact?.phone ?? '',
      email: supplier?.contact?.email ?? '',
      person: supplier?.contact?.person ?? '',
      notes: supplier?.notes ?? '',
      isActive: supplier?.isActive ?? true,
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={supplier ? t('suppliers.edit') : t('suppliers.add')}
      formId="supplier-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="accounting.supplier"
        id="supplier-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof supplierSchema>;
          const body = {
            name: v.name,
            kind: v.kind,
            ...(v.taxNumber ? { taxNumber: v.taxNumber } : {}),
            contact: {
              ...(v.phone ? { phone: v.phone } : {}),
              ...(v.email ? { email: v.email } : {}),
              ...(v.person ? { person: v.person } : {}),
            },
            notes: v.notes ?? '',
            isActive: v.isActive,
          };
          if (supplier)
            await update.mutateAsync({
              id: supplier.id,
              version: supplier.version,
              ...(body as Partial<Supplier>),
            });
          else await create.mutateAsync(body as Partial<Supplier>);
          notify.success(t('suppliers.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFTextField name="name" label={t('suppliers.name')} required maxLength={120} />
          <RHFSelect
            name="kind"
            label={t('suppliers.kind')}
            options={SUPPLIER_KINDS.map((k) => ({ value: k, label: t(`suppliers.kinds.${k}`) }))}
          />
          <RHFTextField
            name="taxNumber"
            label={t('suppliers.taxNumber')}
            inputProps={{ dir: 'ltr' }}
          />
          <RHFTextField name="person" label={t('suppliers.person')} maxLength={80} />
          <RHFTextField
            name="phone"
            label={t('suppliers.phone')}
            inputProps={{ dir: 'ltr', inputMode: 'tel' }}
          />
          <RHFTextField name="email" label={t('suppliers.email')} inputProps={{ dir: 'ltr' }} />
          <RHFTextField
            name="notes"
            label={t('suppliers.notes')}
            multiline
            minRows={2}
            maxLength={1000}
          />
          <RHFCheckbox name="isActive" label={t('suppliers.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- supplier bills ---------------- */

export function BillsPage() {
  const { t, i18n } = useTranslation('accounting');
  const notify = useNotify();
  const confirm = useConfirm();
  const lp = useListParams();
  const list = useBills({ ...lp.params, status: lp.filter('status') || undefined });
  const payments = useSupplierPayments();
  const muts = useBillMutations();
  const [editing, setEditing] = useState<Bill | 'new' | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const columns: Column<Bill>[] = [
    {
      field: 'number',
      headerName: t('bills.number'),
      width: 150,
      renderCell: ({ row }) => <span dir="ltr">{row.number}</span>,
    },
    { field: 'supplierName', headerName: t('bills.supplier'), flex: 1, minWidth: 160 },
    {
      field: 'billDate',
      headerName: t('bills.date'),
      width: 120,
      valueGetter: (_v, row) => formatDate(row.billDate, i18n.language, 'll'),
    },
    {
      field: 'dueDate',
      headerName: t('bills.due'),
      width: 120,
      valueGetter: (_v, row) => (row.dueDate ? formatDate(row.dueDate, i18n.language, 'll') : '—'),
    },
    {
      field: 'total',
      headerName: t('bills.total'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => <MoneyText value={row.total} />,
    },
    {
      field: 'balanceDue',
      headerName: t('bills.balance'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => <MoneyText value={row.balanceDue} />,
    },
    {
      field: 'status',
      headerName: t('bills.status'),
      width: 140,
      renderCell: ({ row }) => <StatusChip status={row.status} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 200,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1} onClick={(e) => e.stopPropagation()}>
          {row.status === 'draft' && (
            <Button
              size="small"
              onClick={() => run(muts.post.mutateAsync(row.id), t('bills.posted'))}
            >
              {t('bills.post')}
            </Button>
          )}
          {['posted', 'partially_paid'].includes(row.status) && (
            <Button size="small" variant="outlined" onClick={() => setPaying(row)}>
              {t('bills.pay')}
            </Button>
          )}
          {['draft', 'posted'].includes(row.status) && (
            <Button
              size="small"
              color="error"
              onClick={async () => {
                const r = await confirm({
                  title: t('bills.voidTitle', { number: row.number }),
                  reason: { label: t('bills.reason'), required: true, max: 300 },
                  destructive: true,
                });
                if (r.confirmed)
                  run(
                    muts.void.mutateAsync({ id: row.id, reason: r.reason ?? '' }),
                    t('bills.voided'),
                  );
              }}
            >
              {t('bills.void')}
            </Button>
          )}
        </Stack>
      ),
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('bills.title')}
        subtitle={t('bills.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setEditing('new')}
          >
            {t('bills.add')}
          </Button>
        }
      />
      <DataTable<Bill>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => r.status === 'draft' && setEditing(r)}
        columns={columns}
        toolbar={
          <TextField
            select
            size="small"
            label={t('bills.status')}
            value={lp.filter('status')}
            onChange={(e) => lp.set({ status: e.target.value || undefined, page: 1 })}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">{t('bills.all')}</MenuItem>
            <MenuItem value="open">{t('bills.open')}</MenuItem>
            {['draft', 'paid', 'void'].map((s) => (
              <MenuItem key={s} value={s}>
                {t(`bills.statuses.${s}`)}
              </MenuItem>
            ))}
          </TextField>
        }
        empty={<EmptyState title={t('bills.empty')} />}
      />
      {(payments.data ?? []).length > 0 && (
        <Card variant="outlined" sx={{ mt: 4 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              {t('bills.recentPayments')}
            </Typography>
            {(payments.data ?? []).slice(0, 10).map((p) => (
              <Stack key={p.id} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                <Typography variant="body2">
                  <span dir="ltr">{p.number}</span> · {p.supplierName} ·{' '}
                  {formatDate(p.date, i18n.language, 'll')}
                </Typography>
                <MoneyText value={p.amount} />
              </Stack>
            ))}
          </CardContent>
        </Card>
      )}
      {editing && (
        <BillDrawer bill={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {paying && <PayBillDialog bill={paying} onClose={() => setPaying(null)} />}
    </Box>
  );
}

const billSchema = z.object({
  supplierId: objectId(),
  supplierRef: optional(freeText(60)),
  billDate: dateOnly(),
  dueDate: optional(dateOnly()),
  notes: optional(freeText(1000)),
  lines: z
    .array(
      z.object({
        description: requiredText(200),
        expenseAccountId: objectId(),
        amount: money.min(1, { message: 'must_be_positive' }),
        taxRateId: optional(objectId()),
      }),
    )
    .min(1, { message: 'too_few' })
    .max(50),
});
type BillValues = z.input<typeof billSchema>;

function BillDrawer({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { t } = useTranslation('accounting');
  const notify = useNotify();
  const currency = useCurrency();
  const suppliers = suppliersApi.useAll();
  const taxes = taxRatesApi.useAll();
  const taxName = useSeedName('taxRate');
  const muts = useBillMutations();
  const form = useAppForm<BillValues>({
    schema: billSchema,
    defaultValues: {
      supplierId: bill?.supplierId ?? '',
      supplierRef: bill?.supplierRef ?? '',
      billDate: bill?.billDate ?? todayLocal(),
      dueDate: bill?.dueDate ?? '',
      notes: bill?.notes ?? '',
      lines: bill?.lines.map((l) => ({
        description: l.description,
        expenseAccountId: l.expenseAccountId,
        amount: l.amount,
        taxRateId: l.taxRateId ?? '',
      })) ?? [{ description: '', expenseAccountId: '', amount: 0, taxRateId: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={bill ? t('bills.edit') : t('bills.add')}
      formId="bill-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={820}
    >
      <Form
        form={form}
        name="accounting.bill"
        id="bill-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof billSchema>;
          const body = {
            supplierId: v.supplierId,
            ...(v.supplierRef ? { supplierRef: v.supplierRef } : {}),
            billDate: v.billDate,
            ...(v.dueDate ? { dueDate: v.dueDate } : {}),
            ...(v.notes ? { notes: v.notes } : {}),
            lines: v.lines.map((l) => ({
              description: l.description,
              expenseAccountId: l.expenseAccountId,
              amount: l.amount,
              ...(l.taxRateId ? { taxRateId: l.taxRateId } : {}),
            })),
          };
          if (bill) await muts.update.mutateAsync({ id: bill.id, version: bill.version, ...body });
          else await muts.create.mutateAsync(body);
          notify.success(t('bills.saved'));
          onClose();
        }}
      >
        <Stack spacing={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <RHFSelect
                name="supplierId"
                label={t('bills.supplier')}
                required
                options={(suppliers.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFTextField name="supplierRef" label={t('bills.supplierRef')} maxLength={60} />
            </Grid>
            <Grid item xs={6}>
              <RHFDate name="billDate" label={t('bills.date')} required />
            </Grid>
            <Grid item xs={6}>
              <RHFDate name="dueDate" label={t('bills.due')} />
            </Grid>
          </Grid>
          {fields.map((f, i) => (
            <Grid container spacing={2} key={f.id} alignItems="center">
              <Grid item xs={12} md={3.5}>
                <RHFTextField
                  name={`lines.${i}.description`}
                  label={t('bills.description')}
                  size="small"
                  required
                  maxLength={200}
                />
              </Grid>
              <Grid item xs={12} md={3.5}>
                <AccountField
                  name={`lines.${i}.expenseAccountId`}
                  label={t('bills.account')}
                  types={['expense', 'inventory', 'fixed_asset', 'prepaid']}
                  required
                />
              </Grid>
              <Grid item xs={6} md={2.5}>
                <RHFMoney
                  currency={currency}
                  name={`lines.${i}.amount`}
                  label={t('bills.amount')}
                  required
                />
              </Grid>
              <Grid item xs={5} md={2}>
                <RHFSelect
                  name={`lines.${i}.taxRateId`}
                  label={t('bills.tax')}
                  clearable
                  options={(taxes.data ?? []).map((x) => ({
                    value: x.id,
                    label: `${taxName(x)} (${x.rate / 100}%)`,
                  }))}
                />
              </Grid>
              <Grid item xs={1} md={0.5}>
                <IconButton
                  aria-label={t('bills.removeLine')}
                  onClick={() => remove(i)}
                  disabled={fields.length === 1}
                >
                  <Trash2 size={16} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          <Button
            startIcon={<Plus size={16} />}
            onClick={() =>
              append({ description: '', expenseAccountId: '', amount: 0, taxRateId: '' })
            }
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('bills.addLine')}
          </Button>
          <RHFTextField
            name="notes"
            label={t('bills.notes')}
            multiline
            minRows={2}
            maxLength={1000}
          />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

function PayBillDialog({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const { t } = useTranslation('accounting');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const currency = useCurrency();
  const lookup = useAccountLookup();
  const muts = useBillMutations();
  const [amount, setAmount] = useState(bill.balanceDue);
  const [from, setFrom] = useState(lookup.bySystem('BANK_DEFAULT')?.id ?? '');
  const [method, setMethod] = useState('bank_transfer');
  const sources = lookup.postable.filter((a) => ['cash', 'bank'].includes(a.subtype));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('bills.payTitle', { number: bill.number })}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <MoneyInput
            label={t('bills.amount')}
            value={amount}
            currency={currency}
            onChange={(v) => setAmount(typeof v === 'number' ? v : 0)}
            error={amount > bill.balanceDue}
          />
          <TextField
            select
            label={t('bills.paidFrom')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          >
            {sources.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {lookup.label(a)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('bills.method')}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {['bank_transfer', 'cash', 'cheque', 'card', 'other'].map((m) => (
              <MenuItem key={m} value={m}>
                {t(`methods.${m}`, { ns: 'billing' })}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button
          variant="contained"
          disabled={amount <= 0 || amount > bill.balanceDue || !from || muts.pay.isPending}
          onClick={() =>
            void muts.pay
              .mutateAsync({
                supplierId: bill.supplierId,
                amount,
                method,
                paidFromAccountId: from,
                allocations: [{ billId: bill.id, amount }],
              })
              .then(() => (notify.success(t('bills.paid')), onClose()), notify.error)
          }
        >
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ---------------- expenses ---------------- */

export function ExpensesPage() {
  const { t, i18n } = useTranslation('accounting');
  const notify = useNotify();
  const confirm = useConfirm();
  const lp = useListParams();
  const { can } = usePermission();
  const list = useExpenses({ ...lp.params, status: lp.filter('status') || undefined });
  const lookup = useAccountLookup();
  const muts = useExpenseMutations();
  const [adding, setAdding] = useState(false);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  return (
    <Box>
      <PageHeader
        title={t('expenses.title')}
        subtitle={t('expenses.subtitle')}
        primary={
          can('accounting.expense.create') && (
            <Button
              variant="contained"
              startIcon={<Plus size={18} />}
              onClick={() => setAdding(true)}
            >
              {t('expenses.add')}
            </Button>
          )
        }
      />
      <DataTable<Expense>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t('expenses.empty')} />}
        columns={[
          {
            field: 'number',
            headerName: t('expenses.number'),
            width: 150,
            renderCell: ({ row }) => <span dir="ltr">{row.number}</span>,
          },
          {
            field: 'date',
            headerName: t('expenses.date'),
            width: 120,
            valueGetter: (_v, row) => formatDate(row.date, i18n.language, 'll'),
          },
          {
            field: 'categoryAccountId',
            headerName: t('expenses.category'),
            flex: 1,
            minWidth: 180,
            valueGetter: (_v, row) => lookup.name(row.categoryAccountId),
          },
          { field: 'payee', headerName: t('expenses.payee'), flex: 1, minWidth: 140 },
          {
            field: 'amount',
            headerName: t('expenses.amount'),
            width: 120,
            align: 'right',
            headerAlign: 'right',
            renderCell: ({ row }) => <MoneyText value={row.amount + row.taxAmount} />,
          },
          {
            field: 'status',
            headerName: t('expenses.status'),
            width: 150,
            renderCell: ({ row }) => (
              <StatusChip
                status={
                  row.status === 'pending_approval'
                    ? 'pending'
                    : row.status === 'approved'
                      ? 'approved'
                      : 'void'
                }
              />
            ),
          },
          {
            field: 'actions',
            headerName: '',
            width: 180,
            sortable: false,
            renderCell: ({ row }) =>
              can('accounting.expense.approve') ? (
                <Stack direction="row" spacing={1}>
                  {row.status === 'pending_approval' && (
                    <Button
                      size="small"
                      onClick={() => run(muts.approve.mutateAsync(row.id), t('expenses.approved'))}
                    >
                      {t('expenses.approve')}
                    </Button>
                  )}
                  {row.status !== 'void' && (
                    <Button
                      size="small"
                      color="error"
                      onClick={async () => {
                        const r = await confirm({
                          title: t('expenses.voidTitle', { number: row.number }),
                          reason: { label: t('expenses.reason'), required: true, max: 300 },
                          destructive: true,
                        });
                        if (r.confirmed)
                          run(
                            muts.void.mutateAsync({ id: row.id, reason: r.reason ?? '' }),
                            t('expenses.voided'),
                          );
                      }}
                    >
                      {t('expenses.void')}
                    </Button>
                  )}
                </Stack>
              ) : null,
          },
        ]}
      />
      {adding && <ExpenseDrawer onClose={() => setAdding(false)} />}
    </Box>
  );
}

const expenseSchema = z.object({
  date: dateOnly(),
  categoryAccountId: objectId(),
  amount: money.min(1, { message: 'must_be_positive' }),
  taxRateId: optional(objectId()),
  paidFromAccountId: objectId(),
  payee: optional(freeText(120)),
  description: optional(freeText(300)),
});
type ExpenseValues = z.input<typeof expenseSchema>;

function ExpenseDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('accounting');
  const notify = useNotify();
  const currency = useCurrency();
  const lookup = useAccountLookup();
  const taxes = taxRatesApi.useAll();
  const taxName = useSeedName('taxRate');
  const muts = useExpenseMutations();
  const form = useAppForm<ExpenseValues>({
    schema: expenseSchema,
    defaultValues: {
      date: todayLocal(),
      categoryAccountId: '',
      amount: 0,
      taxRateId: '',
      paidFromAccountId: lookup.bySystem('CASH_DEFAULT')?.id ?? '',
      payee: '',
      description: '',
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('expenses.add')}
      formId="expense-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="accounting.expense"
        id="expense-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof expenseSchema>;
          const e = await muts.create.mutateAsync({
            ...v,
            taxRateId: v.taxRateId || undefined,
            payee: v.payee ?? '',
            description: v.description ?? '',
          });
          notify.success(
            e.status === 'pending_approval' ? t('expenses.pending') : t('expenses.saved'),
          );
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFDate name="date" label={t('expenses.date')} required />
          <AccountField
            name="categoryAccountId"
            label={t('expenses.category')}
            types={['expense']}
            required
          />
          <RHFMoney currency={currency} name="amount" label={t('expenses.amount')} required />
          <RHFSelect
            name="taxRateId"
            label={t('expenses.tax')}
            clearable
            options={(taxes.data ?? []).map((x) => ({
              value: x.id,
              label: `${taxName(x)} (${x.rate / 100}%)`,
            }))}
          />
          <RHFSelect
            name="paidFromAccountId"
            label={t('expenses.paidFrom')}
            required
            options={lookup.postable
              .filter((a) => ['cash', 'bank'].includes(a.subtype))
              .map((a) => ({ value: a.id, label: lookup.label(a) }))}
          />
          <RHFTextField name="payee" label={t('expenses.payee')} maxLength={120} />
          <RHFTextField name="description" label={t('expenses.description')} maxLength={300} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- periods ---------------- */

export function PeriodsPage() {
  const { t, i18n } = useTranslation('accounting');
  const notify = useNotify();
  const confirm = useConfirm();
  const q = useFiscalPeriods();
  const muts = usePeriodMutations();
  const [menu, setMenu] = useState<{ el: HTMLElement; id: string; status: string } | null>(null);
  const setStatus = async (id: string, status: string, current: string) => {
    let reason: string | undefined;
    if (status === 'open' && current !== 'open') {
      const r = await confirm({
        title: t('periods.reopenTitle'),
        reason: { label: t('periods.reason'), required: true, max: 300 },
      });
      if (!r.confirmed) return;
      reason = r.reason;
    }
    await muts.status
      .mutateAsync({ id, status, ...(reason ? { reason } : {}) })
      .then(() => notify.success(t('periods.updated')), notify.error);
  };
  if (q.isLoading) return <PageSkeleton rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Box>
      <PageHeader title={t('periods.title')} subtitle={t('periods.subtitle')} />
      <Stack spacing={4}>
        {(q.data ?? []).map((y) => (
          <Card key={y.id} variant="outlined">
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 3 }}
              >
                <Typography variant="h5">
                  {t('periods.year', { year: y.year })} ·{' '}
                  {formatDate(y.startDate, i18n.language, 'll')} –{' '}
                  {formatDate(y.endDate, i18n.language, 'll')}
                </Typography>
                {y.status === 'open' ? (
                  <Button
                    color="error"
                    variant="outlined"
                    startIcon={<Lock size={16} />}
                    onClick={async () => {
                      const r = await confirm({
                        title: t('periods.closeYearTitle', { year: y.year }),
                        body: t('periods.closeYearBody'),
                        destructive: true,
                      });
                      if (r.confirmed)
                        await muts.closeYear
                          .mutateAsync(y.year)
                          .then(() => notify.success(t('periods.yearClosed')), notify.error);
                    }}
                  >
                    {t('periods.closeYear')}
                  </Button>
                ) : (
                  <StatusChip status="closed" />
                )}
              </Stack>
              <Grid container spacing={2}>
                {y.periods.map((p) => (
                  <Grid item xs={6} sm={4} md={2} key={p.id}>
                    <Box
                      sx={{
                        p: 2,
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 2,
                        textAlign: 'center',
                      }}
                    >
                      <Typography variant="subtitle2">
                        {formatDate(p.startDate, i18n.language, 'MMM YYYY')}
                      </Typography>
                      <Stack
                        direction="row"
                        justifyContent="center"
                        alignItems="center"
                        spacing={0.5}
                        sx={{ mt: 1 }}
                      >
                        <StatusChip
                          status={p.status === 'soft_closed' ? 'soft_closed' : p.status}
                        />
                        {y.status === 'open' && (
                          <IconButton
                            size="small"
                            aria-label={t('periods.change')}
                            onClick={(e) =>
                              setMenu({ el: e.currentTarget, id: p.id, status: p.status })
                            }
                          >
                            <MoreVertical size={14} />
                          </IconButton>
                        )}
                      </Stack>
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Menu anchorEl={menu?.el} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {(['open', 'soft_closed', 'closed'] as const)
          .filter((s) => s !== menu?.status)
          .map((s) => (
            <MenuItem
              key={s}
              onClick={() => (menu && void setStatus(menu.id, s, menu.status), setMenu(null))}
            >
              {s === 'open' ? (
                <LockOpen size={14} style={{ marginInlineEnd: 8 }} />
              ) : (
                <Lock size={14} style={{ marginInlineEnd: 8 }} />
              )}
              {t(`periods.to.${s}`)}
            </MenuItem>
          ))}
      </Menu>
    </Box>
  );
}

/* ---------------- e-invoices (JoFotara) ---------------- */

export function EInvoicesPage() {
  const { t, i18n } = useTranslation('accounting');
  const notify = useNotify();
  const [status, setStatus] = useState('');
  const list = useEInvoices(status || undefined);
  const resubmit = useResubmitEInvoice();
  return (
    <Box>
      <PageHeader title={t('einvoices.title')} subtitle={t('einvoices.subtitle')} />
      <TextField
        select
        size="small"
        label={t('einvoices.status')}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        sx={{ mb: 3, minWidth: 180 }}
      >
        <MenuItem value="">{t('einvoices.all')}</MenuItem>
        {['queued', 'accepted', 'rejected', 'disabled'].map((s) => (
          <MenuItem key={s} value={s}>
            {t(`einvoice.status.${s}`, { ns: 'billing' })}
          </MenuItem>
        ))}
      </TextField>
      <DataTable
        clientSide
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        empty={<EmptyState title={t('einvoices.empty')} description={t('einvoices.emptyHint')} />}
        columns={[
          {
            field: 'number',
            headerName: t('einvoices.number'),
            width: 170,
            renderCell: ({ row }) => <span dir="ltr">{row.number}</span>,
          },
          {
            field: 'patient',
            headerName: t('einvoices.patient'),
            flex: 1,
            minWidth: 160,
            valueGetter: (_v, row) => row.patient?.fullName ?? '',
          },
          {
            field: 'issueDate',
            headerName: t('einvoices.date'),
            width: 120,
            valueGetter: (_v, row) =>
              row.issueDate ? formatDate(row.issueDate, i18n.language, 'll') : '',
          },
          {
            field: 'total',
            headerName: t('einvoices.total'),
            width: 120,
            align: 'right',
            headerAlign: 'right',
            renderCell: ({ row }) => <MoneyText value={row.total} />,
          },
          {
            field: 'status',
            headerName: t('einvoices.status'),
            width: 150,
            renderCell: ({ row }) => (
              <StatusChip
                status={
                  row.einvoice?.status === 'accepted'
                    ? 'approved'
                    : row.einvoice?.status === 'rejected'
                      ? 'rejected'
                      : 'pending'
                }
                label={t(`einvoice.status.${row.einvoice?.status ?? 'not_sent'}`, {
                  ns: 'billing',
                })}
              />
            ),
          },
          {
            field: 'attempts',
            headerName: t('einvoices.attempts'),
            width: 100,
            valueGetter: (_v, row) => row.einvoice?.attempts ?? 0,
          },
          {
            field: 'actions',
            headerName: '',
            width: 140,
            sortable: false,
            renderCell: ({ row }) =>
              row.einvoice?.status === 'rejected' || row.einvoice?.status === 'queued' ? (
                <Button
                  size="small"
                  onClick={() =>
                    void resubmit
                      .mutateAsync(row.id)
                      .then(() => notify.success(t('einvoices.resubmitted')), notify.error)
                  }
                >
                  {t('einvoices.resubmit')}
                </Button>
              ) : null,
          },
        ]}
      />
    </Box>
  );
}
