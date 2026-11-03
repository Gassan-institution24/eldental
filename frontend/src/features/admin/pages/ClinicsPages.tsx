import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Ban, Building2, CheckCircle2, CreditCard, Pencil } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { formatDate } from '@/lib/dates';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFDate, RHFPhone } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import {
  dateOnly,
  email,
  entityName,
  enumOf,
  nullable,
  optional,
  personName,
  phone,
  slug,
} from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  plansApi,
  SUBSCRIPTION_STATUSES,
  useAdminClinic,
  useAdminClinics,
  useClinicMutations,
  type AdminClinic,
} from '../api';

const TIMEZONES = [
  'Asia/Amman',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Baghdad',
  'Africa/Cairo',
  'Asia/Beirut',
  'Europe/Istanbul',
  'UTC',
];
const CURRENCIES = ['JOD', 'SAR', 'AED', 'USD', 'EUR', 'EGP', 'IQD', 'KWD'];

function SubscriptionChip({ c }: { c: Pick<AdminClinic, 'subscription'> }) {
  const { t } = useTranslation('admin');
  return (
    <StatusChip
      status={c.subscription.status}
      label={t(`subscriptionStatus.${c.subscription.status}`)}
    />
  );
}

function useClinicColumns(mode: 'clinics' | 'subscriptions'): Column<AdminClinic>[] {
  const { t, i18n } = useTranslation('admin');
  const date = (v?: string | null) => (v ? formatDate(v, i18n.language, 'll') : '—');
  return [
    {
      field: 'name',
      headerName: t('clinics.name'),
      flex: 1.4,
      minWidth: 200,
      renderCell: ({ row }) => <span dir="auto">{row.name}</span>,
    },
    {
      field: 'slug',
      headerName: t('clinics.slug'),
      width: 150,
      renderCell: ({ row }) => <span dir="ltr">{row.slug}</span>,
    },
    ...(mode === 'clinics'
      ? ([
          {
            field: 'owner',
            headerName: t('clinics.owner'),
            flex: 1,
            minWidth: 180,
            sortable: false,
            valueGetter: (_v: unknown, row: AdminClinic) => row.owner?.name ?? '—',
          },
          {
            field: 'activeStaff',
            headerName: t('clinics.staff'),
            width: 90,
            align: 'right',
            headerAlign: 'right',
          },
          {
            field: 'status',
            headerName: t('clinics.status'),
            width: 130,
            renderCell: ({ row }: { row: AdminClinic }) => (
              <StatusChip status={row.status} label={t(`clinicStatus.${row.status}`)} />
            ),
          },
        ] as Column<AdminClinic>[])
      : []),
    {
      field: 'planName',
      headerName: t('clinics.plan'),
      width: 140,
      sortable: false,
      valueGetter: (_v, row) => row.planName || '—',
    },
    {
      field: 'subscription',
      headerName: t('clinics.subscription'),
      width: 140,
      sortable: false,
      renderCell: ({ row }) => <SubscriptionChip c={row} />,
    },
    ...(mode === 'subscriptions'
      ? ([
          {
            field: 'trialEndsAt',
            headerName: t('subscriptions.trialEndsAt'),
            width: 140,
            sortable: false,
            valueGetter: (_v: unknown, row: AdminClinic) => date(row.subscription.trialEndsAt),
          },
          {
            field: 'currentPeriodEnd',
            headerName: t('subscriptions.periodEnd'),
            width: 140,
            sortable: false,
            valueGetter: (_v: unknown, row: AdminClinic) => date(row.subscription.currentPeriodEnd),
          },
        ] as Column<AdminClinic>[])
      : []),
    {
      field: 'createdAt',
      headerName: t('clinics.created'),
      width: 130,
      valueGetter: (_v, row) => date(row.createdAt),
    },
  ];
}

function ClinicFilters({
  lp,
  withStatus,
}: {
  lp: ReturnType<typeof useListParams>;
  withStatus: boolean;
}) {
  const { t } = useTranslation('admin');
  return (
    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
      {withStatus && (
        <TextField
          select
          size="small"
          label={t('clinics.status')}
          value={lp.filter('status')}
          onChange={(e) => lp.set({ status: e.target.value || undefined, page: 1 })}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">{t('common.all')}</MenuItem>
          {(['active', 'suspended'] as const).map((s) => (
            <MenuItem key={s} value={s}>
              {t(`clinicStatus.${s}`)}
            </MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        select
        size="small"
        label={t('clinics.subscription')}
        value={lp.filter('subscription')}
        onChange={(e) => lp.set({ subscription: e.target.value || undefined, page: 1 })}
        sx={{ minWidth: 170 }}
      >
        <MenuItem value="">{t('common.all')}</MenuItem>
        {SUBSCRIPTION_STATUSES.map((s) => (
          <MenuItem key={s} value={s}>
            {t(`subscriptionStatus.${s}`)}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

/* ---------------- list ---------------- */

export function ClinicsListPage() {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const { can } = usePermission();
  const lp = useListParams();
  const list = useAdminClinics({
    ...lp.params,
    status: lp.filter('status') || undefined,
    subscription: lp.filter('subscription') || undefined,
  });
  const [creating, setCreating] = useState(false);
  const columns = useClinicColumns('clinics');
  return (
    <Box>
      <PageHeader
        title={t('clinics.title')}
        subtitle={t('clinics.subtitle')}
        primary={
          can('platform.clinic.manage') && (
            <Button
              variant="contained"
              startIcon={<Building2 size={18} />}
              onClick={() => setCreating(true)}
            >
              {t('clinics.new')}
            </Button>
          )
        }
      />
      <DataTable<AdminClinic>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        searchable
        toolbar={<ClinicFilters lp={lp} withStatus />}
        columns={columns}
        onRowClick={(r) => navigate(`/admin/clinics/${r.id}`)}
        empty={<EmptyState title={t('clinics.empty')} description={t('clinics.emptyHint')} />}
      />
      {creating && <CreateClinicDrawer onClose={() => setCreating(false)} />}
    </Box>
  );
}

/* ---------------- create ---------------- */

const createSchema = z.object({
  name: entityName({ max: 120 }),
  slug: slug(),
  timezone: enumOf(TIMEZONES as [string, ...string[]]),
  currency: enumOf(CURRENCIES as [string, ...string[]]),
  locale: enumOf(['ar', 'en']),
  planId: optional(z.string()),
  ownerName: personName({ max: 120 }),
  ownerEmail: email(),
  ownerPhone: optional(phone()),
});
type CreateForm = z.input<typeof createSchema>;

function CreateClinicDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const navigate = useNavigate();
  const muts = useClinicMutations();
  const plans = plansApi.useAll();
  const form = useAppForm<CreateForm>({
    schema: createSchema,
    defaultValues: {
      name: '',
      slug: '',
      timezone: 'Asia/Amman',
      currency: 'JOD',
      locale: 'ar',
      planId: '',
      ownerName: '',
      ownerEmail: '',
      ownerPhone: '',
    },
  });
  const onSubmit = async (raw: CreateForm) => {
    const v = raw as z.output<typeof createSchema>;
    const c = await muts.create.mutateAsync({
      name: v.name,
      slug: v.slug,
      timezone: v.timezone,
      currency: v.currency,
      locale: v.locale,
      ...(v.planId ? { planId: v.planId } : {}),
      owner: {
        name: v.ownerName,
        email: v.ownerEmail,
        ...(v.ownerPhone ? { phone: v.ownerPhone } : {}),
      },
    });
    notify.success(t('clinics.createdToast', { name: c.name }));
    onClose();
    navigate(`/admin/clinics/${c.id}`, {
      state: c.devInviteUrl ? { devInviteUrl: c.devInviteUrl } : undefined,
    });
  };
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('clinics.new')}
      subtitle={t('clinics.newHint')}
      formId="admin-clinic-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form form={form} name="admin.clinic" id="admin-clinic-form" onSubmit={onSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <RHFTextField name="name" label={t('clinics.name')} required maxLength={120} />
          </Grid>
          <Grid item xs={12} md={5}>
            <RHFTextField
              name="slug"
              label={t('clinics.slug')}
              required
              inputProps={{ dir: 'ltr' }}
              helperText={t('clinics.slugHint')}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <RHFSelect
              name="timezone"
              label={t('clinics.timezone')}
              required
              options={TIMEZONES.map((z) => ({ value: z, label: z }))}
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFSelect
              name="currency"
              label={t('clinics.currency')}
              required
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFSelect
              name="locale"
              label={t('clinics.locale')}
              required
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFSelect
              name="planId"
              label={t('clinics.plan')}
              clearable
              options={(plans.data ?? [])
                .filter((p) => p.isActive)
                .map((p) => ({ value: p.id, label: p.name }))}
              helperText={t('clinics.planHint')}
            />
          </Grid>
          <Grid item xs={12}>
            <Typography variant="subtitle2">{t('clinics.ownerSection')}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('clinics.ownerHint')}
            </Typography>
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="ownerName"
              label={t('clinics.ownerName')}
              required
              maxLength={120}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="ownerEmail"
              label={t('clinics.ownerEmail')}
              required
              type="email"
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFPhone name="ownerPhone" label={t('clinics.ownerPhone')} />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- detail ---------------- */

export function ClinicDetailPage() {
  const { t, i18n } = useTranslation('admin');
  const { id } = useParams();
  const { can } = usePermission();
  const confirm = useConfirm();
  const notify = useNotify();
  const q = useAdminClinic(id);
  const muts = useClinicMutations();
  const [editing, setEditing] = useState(false);
  const [subscription, setSubscription] = useState(false);
  const location = useLocation();
  // Only outside production: the server returns the owner's invitation link so it can be tested.
  const devInviteUrl = (location.state as { devInviteUrl?: string } | null)?.devInviteUrl;
  if (q.isLoading) return <PageSkeleton rows={6} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const date = (v?: string | null) => (v ? formatDate(v, i18n.language, 'll') : '—');

  const toggle = async () => {
    const suspending = c.status === 'active';
    const r = await confirm({
      title: t(suspending ? 'clinics.suspendTitle' : 'clinics.activateTitle', { name: c.name }),
      body: t(suspending ? 'clinics.suspendBody' : 'clinics.activateBody'),
      destructive: suspending,
      reason: { label: t('common.reason'), required: false, max: 300 },
    });
    if (!r.confirmed) return;
    await muts.setStatus
      .mutateAsync({
        id: c.id,
        to: suspending ? 'suspend' : 'activate',
        ...(r.reason ? { reason: r.reason } : {}),
      })
      .then(
        () => notify.success(t(suspending ? 'clinics.suspended' : 'clinics.activated')),
        notify.error,
      );
  };

  const rows: [string, React.ReactNode][] = [
    [t('clinics.slug'), <span dir="ltr">{c.slug}</span>],
    [t('clinics.email'), c.email || '—'],
    [t('clinics.phone'), <span dir="ltr">{c.phone || '—'}</span>],
    [t('clinics.timezone'), c.timezone],
    [t('clinics.currency'), c.currency],
    [t('clinics.locale'), c.locale === 'ar' ? 'العربية' : 'English'],
    [t('clinics.onboarding'), c.onboardingCompleted ? t('common.yes') : t('common.no')],
    [t('clinics.created'), date(c.createdAt)],
  ];

  return (
    <Box>
      <PageHeader
        title={<span dir="auto">{c.name}</span>}
        breadcrumbs={[{ label: t('clinics.title'), to: '/admin/clinics' }, { label: c.name }]}
        actions={
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <StatusChip status={c.status} label={t(`clinicStatus.${c.status}`)} />
            <SubscriptionChip c={c} />
            {can('platform.clinic.manage') && (
              <Button startIcon={<Pencil size={16} />} onClick={() => setEditing(true)}>
                {t('common.edit')}
              </Button>
            )}
            {can('platform.subscription.manage') && (
              <Button startIcon={<CreditCard size={16} />} onClick={() => setSubscription(true)}>
                {t('subscriptions.edit')}
              </Button>
            )}
            {can('platform.clinic.suspend') && (
              <Button
                color={c.status === 'active' ? 'error' : 'success'}
                variant="outlined"
                startIcon={c.status === 'active' ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                onClick={() => void toggle()}
              >
                {c.status === 'active' ? t('clinics.suspend') : t('clinics.activate')}
              </Button>
            )}
          </Stack>
        }
      />
      {devInviteUrl && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('clinics.devInvite')}{' '}
          <a href={devInviteUrl} dir="ltr">
            {devInviteUrl}
          </a>
        </Alert>
      )}
      {c.status === 'suspended' && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {t('clinics.suspendedNote')}
        </Alert>
      )}
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <SectionCard title={t('clinics.details')}>
            <Stack spacing={1.5}>
              {rows.map(([k, v]) => (
                <Stack key={k} direction="row" justifyContent="space-between" spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {k}
                  </Typography>
                  <Typography variant="body2" dir="auto" textAlign="end">
                    {v}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={5}>
          <Stack spacing={3}>
            <SectionCard title={t('clinics.owner')}>
              {c.owner ? (
                <Stack spacing={0.5}>
                  <Typography fontWeight={700} dir="auto">
                    {c.owner.name}
                  </Typography>
                  <Typography variant="body2" dir="ltr">
                    {c.owner.email}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('clinics.lastActive')}: {date(c.owner.lastActiveAt)}
                  </Typography>
                </Stack>
              ) : (
                <Typography color="text.secondary">—</Typography>
              )}
            </SectionCard>
            <SectionCard title={t('clinics.subscription')}>
              <Stack spacing={1}>
                <Typography>
                  {t('clinics.plan')}: <b>{c.plan?.name ?? '—'}</b>
                </Typography>
                <Typography variant="body2">
                  {t('subscriptions.trialEndsAt')}: {date(c.subscription.trialEndsAt)}
                </Typography>
                <Typography variant="body2">
                  {t('subscriptions.periodEnd')}: {date(c.subscription.currentPeriodEnd)}
                </Typography>
              </Stack>
            </SectionCard>
            {c.counts && (
              <Card variant="outlined">
                <CardContent>
                  <Grid container>
                    {(['staff', 'patients', 'invoices'] as const).map((k) => (
                      <Grid item xs={4} key={k} textAlign="center">
                        <Typography variant="h5" fontWeight={800}>
                          {c.counts![k]}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t(`clinics.counts.${k}`)}
                        </Typography>
                      </Grid>
                    ))}
                  </Grid>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>
      {editing && <EditClinicDrawer clinic={c} onClose={() => setEditing(false)} />}
      {subscription && <SubscriptionDrawer clinic={c} onClose={() => setSubscription(false)} />}
    </Box>
  );
}

const editSchema = z.object({
  name: entityName({ max: 120 }),
  email: nullable(email()),
  phone: nullable(phone()),
  timezone: enumOf(TIMEZONES as [string, ...string[]]),
  currency: enumOf(CURRENCIES as [string, ...string[]]),
  locale: enumOf(['ar', 'en']),
});
type EditForm = z.input<typeof editSchema>;

function EditClinicDrawer({ clinic, onClose }: { clinic: AdminClinic; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const muts = useClinicMutations();
  const form = useAppForm<EditForm>({
    schema: editSchema,
    defaultValues: {
      name: clinic.name,
      email: clinic.email,
      phone: clinic.phone,
      timezone: TIMEZONES.includes(clinic.timezone) ? clinic.timezone : 'Asia/Amman',
      currency: CURRENCIES.includes(clinic.currency) ? clinic.currency : 'JOD',
      locale: clinic.locale,
    },
  });
  const onSubmit = async (raw: EditForm) => {
    const v = raw as z.output<typeof editSchema>;
    await muts.update.mutateAsync({
      id: clinic.id,
      version: clinic.version,
      ...v,
      email: v.email || null,
      phone: v.phone || null,
    });
    notify.success(t('common.saved'));
    onClose();
  };
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('clinics.edit')}
      formId="admin-clinic-edit"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={560}
    >
      <Form form={form} name="admin.clinic" id="admin-clinic-edit" onSubmit={onSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <RHFTextField name="name" label={t('clinics.name')} required maxLength={120} />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFTextField
              name="email"
              label={t('clinics.email')}
              type="email"
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFPhone name="phone" label={t('clinics.phone')} />
          </Grid>
          <Grid item xs={12} md={4}>
            <RHFSelect
              name="timezone"
              label={t('clinics.timezone')}
              required
              options={TIMEZONES.map((z) => ({ value: z, label: z }))}
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFSelect
              name="currency"
              label={t('clinics.currency')}
              required
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </Grid>
          <Grid item xs={6} md={4}>
            <RHFSelect
              name="locale"
              label={t('clinics.locale')}
              required
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' },
              ]}
            />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- subscriptions ---------------- */

const subscriptionSchema = z.object({
  planId: optional(z.string()),
  status: enumOf([...SUBSCRIPTION_STATUSES]),
  trialEndsAt: nullable(dateOnly()),
  currentPeriodEnd: nullable(dateOnly()),
});
type SubForm = z.input<typeof subscriptionSchema>;

function SubscriptionDrawer({ clinic, onClose }: { clinic: AdminClinic; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const muts = useClinicMutations();
  const plans = plansApi.useAll();
  const form = useAppForm<SubForm>({
    schema: subscriptionSchema,
    defaultValues: {
      planId: clinic.planId ?? '',
      status: clinic.subscription.status,
      trialEndsAt: clinic.subscription.trialEndsAt?.slice(0, 10) ?? '',
      currentPeriodEnd: clinic.subscription.currentPeriodEnd?.slice(0, 10) ?? '',
    },
  });
  const onSubmit = async (raw: SubForm) => {
    const v = raw as z.output<typeof subscriptionSchema>;
    await muts.subscription.mutateAsync({
      id: clinic.id,
      version: clinic.version,
      planId: v.planId || null,
      status: v.status,
      trialEndsAt: v.trialEndsAt || null,
      currentPeriodEnd: v.currentPeriodEnd || null,
    });
    notify.success(t('common.saved'));
    onClose();
  };
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('subscriptions.editTitle', { name: clinic.name })}
      subtitle={t('subscriptions.editHint')}
      formId="admin-sub-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={520}
    >
      <Form form={form} name="admin.subscription" id="admin-sub-form" onSubmit={onSubmit}>
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <RHFSelect
              name="planId"
              label={t('clinics.plan')}
              clearable
              options={(plans.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFSelect
              name="status"
              label={t('clinics.subscription')}
              required
              options={SUBSCRIPTION_STATUSES.map((s) => ({
                value: s,
                label: t(`subscriptionStatus.${s}`),
              }))}
              helperText={t('subscriptions.statusHint')}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFDate name="trialEndsAt" label={t('subscriptions.trialEndsAt')} />
          </Grid>
          <Grid item xs={12} md={6}>
            <RHFDate name="currentPeriodEnd" label={t('subscriptions.periodEnd')} />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

export function SubscriptionsPage() {
  const { t } = useTranslation('admin');
  const lp = useListParams();
  const list = useAdminClinics({
    ...lp.params,
    subscription: lp.filter('subscription') || undefined,
  });
  const [editing, setEditing] = useState<AdminClinic | null>(null);
  const columns = useClinicColumns('subscriptions');
  return (
    <Box>
      <PageHeader title={t('subscriptions.title')} subtitle={t('subscriptions.subtitle')} />
      <DataTable<AdminClinic>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        searchable
        toolbar={<ClinicFilters lp={lp} withStatus={false} />}
        columns={columns}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title={t('clinics.empty')} />}
      />
      {editing && <SubscriptionDrawer clinic={editing} onClose={() => setEditing(null)} />}
    </Box>
  );
}
