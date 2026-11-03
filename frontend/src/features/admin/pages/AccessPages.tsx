import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Ban, CheckCircle2, KeyRound, LockOpen, Shield, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { formatDateTime } from '@/lib/dates';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { email, personName } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSessionData } from '@/features/auth/api/session';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  usePlatformPermissions,
  useAdminUsers,
  useSuperadminMutations,
  useSuperadmins,
  useUserAction,
  type PlatformUser,
} from '../api';

function UserStatus({ u }: { u: PlatformUser }) {
  const { t } = useTranslation('admin');
  const s = u.locked ? 'locked' : u.status;
  return <StatusChip status={s} label={t(`userStatus.${s}`)} />;
}

/* ---------------- users ---------------- */

export function UsersPage() {
  const { t, i18n } = useTranslation('admin');
  const { can } = usePermission();
  const confirm = useConfirm();
  const notify = useNotify();
  const lp = useListParams();
  const list = useAdminUsers({
    ...lp.params,
    kind: lp.filter('kind') || undefined,
    status: lp.filter('status') || undefined,
  });
  const action = useUserAction();
  const run = async (u: PlatformUser, a: 'disable' | 'enable' | 'unlock') => {
    if (a === 'disable') {
      const r = await confirm({
        title: t('users.disableTitle', { name: u.displayName }),
        body: t('users.disableBody'),
        destructive: true,
      });
      if (!r.confirmed) return;
    }
    await action
      .mutateAsync({ id: u.id, action: a })
      .then(() => notify.success(t(`users.done.${a}`)), notify.error);
  };
  const columns: Column<PlatformUser>[] = [
    {
      field: 'displayName',
      headerName: t('users.name'),
      flex: 1.2,
      minWidth: 180,
      renderCell: ({ row }) => <span dir="auto">{row.displayName}</span>,
    },
    {
      field: 'email',
      headerName: t('users.email'),
      flex: 1.2,
      minWidth: 200,
      renderCell: ({ row }) => <span dir="ltr">{row.email || row.phone || '—'}</span>,
    },
    {
      field: 'kind',
      headerName: t('users.kind'),
      width: 120,
      valueGetter: (_v, row) => t(`userKind.${row.kind}`),
    },
    {
      field: 'clinics',
      headerName: t('users.clinics'),
      flex: 1.2,
      minWidth: 180,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }}>
          {(row.clinics ?? []).map((c) => (
            <Chip
              key={c.id}
              size="small"
              variant="outlined"
              label={c.isOwner ? `${c.name} · ${t('users.owner')}` : c.name}
              component={RouterLink}
              to={`/admin/clinics/${c.id}`}
              clickable
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            />
          ))}
        </Stack>
      ),
    },
    {
      field: 'lastActiveAt',
      headerName: t('users.lastActive'),
      width: 170,
      valueGetter: (_v, row) =>
        row.lastActiveAt ? formatDateTime(row.lastActiveAt, i18n.language) : '—',
    },
    {
      field: 'status',
      headerName: t('common.status'),
      width: 120,
      sortable: false,
      renderCell: ({ row }) => <UserStatus u={row} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 140,
      sortable: false,
      renderCell: ({ row }) =>
        row.kind === 'platform' || !can('platform.user.manage') ? null : (
          <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
            {row.locked && (
              <Tooltip title={t('users.unlock')}>
                <Button
                  size="small"
                  onClick={() => void run(row, 'unlock')}
                  aria-label={t('users.unlock')}
                >
                  <LockOpen size={16} />
                </Button>
              </Tooltip>
            )}
            {row.status === 'disabled' ? (
              <Tooltip title={t('users.enable')}>
                <Button
                  size="small"
                  color="success"
                  onClick={() => void run(row, 'enable')}
                  aria-label={t('users.enable')}
                >
                  <CheckCircle2 size={16} />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip title={t('users.disable')}>
                <Button
                  size="small"
                  color="error"
                  onClick={() => void run(row, 'disable')}
                  aria-label={t('users.disable')}
                >
                  <Ban size={16} />
                </Button>
              </Tooltip>
            )}
          </Stack>
        ),
    },
  ];
  return (
    <Box>
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} />
      <DataTable<PlatformUser>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        searchable
        toolbar={
          <Stack direction="row" spacing={2}>
            <TextField
              select
              size="small"
              label={t('users.kind')}
              value={lp.filter('kind')}
              onChange={(e) => lp.set({ kind: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{t('common.all')}</MenuItem>
              {(['staff', 'patient', 'platform'] as const).map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`userKind.${k}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('common.status')}
              value={lp.filter('status')}
              onChange={(e) => lp.set({ status: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{t('common.all')}</MenuItem>
              {(['active', 'disabled', 'locked'] as const).map((k) => (
                <MenuItem key={k} value={k}>
                  {t(`userStatus.${k}`)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        }
        columns={columns}
        empty={<EmptyState title={t('users.empty')} />}
      />
    </Box>
  );
}

/* ---------------- superadmins ---------------- */

/** Grouped checklist of platform permissions; options the editor doesn't hold are disabled (escalation rule). */
function PlatformPermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation(['perm', 'admin']);
  const all = usePlatformPermissions();
  const { can } = usePermission();
  const groups = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const k of all.data ?? []) {
      const g = k.split('.')[1] ?? '';
      out.set(g, [...(out.get(g) ?? []), k]);
    }
    return [...out.entries()];
  }, [all.data]);
  return (
    <Stack spacing={2}>
      {groups.map(([g, keys]) => (
        <Box key={g}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            {t(`admin:permGroups.${g}`, { defaultValue: g })}
          </Typography>
          <Grid container>
            {keys.map((k) => (
              <Grid item xs={12} sm={6} key={k}>
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={value.includes(k)}
                      disabled={disabled || !can(k)}
                      onChange={(e) =>
                        onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))
                      }
                    />
                  }
                  label={
                    <Typography variant="body2">{t(`perm:${k}`, { defaultValue: k })}</Typography>
                  }
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Stack>
  );
}

const inviteSchema = z.object({ name: personName({ max: 120 }), email: email() });
type InviteForm = z.input<typeof inviteSchema>;

function InviteSuperadminDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const muts = useSuperadminMutations();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const form = useAppForm<InviteForm>({
    schema: inviteSchema,
    defaultValues: { name: '', email: '' },
  });
  const onSubmit = async (raw: InviteForm) => {
    const v = raw as z.output<typeof inviteSchema>;
    const u = await muts.invite.mutateAsync({ name: v.name, email: v.email, permissions });
    notify.success(t('superadmins.invited', { name: u.displayName }));
    if (u.devInviteUrl) setInviteUrl(u.devInviteUrl);
    else onClose();
  };
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('superadmins.invite')}
      subtitle={t('superadmins.inviteHint')}
      formId="admin-sa-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form form={form} name="admin.superadmin" id="admin-sa-form" onSubmit={onSubmit}>
        <Stack spacing={3}>
          {inviteUrl && (
            <Alert severity="info">
              {t('clinics.devInvite')}{' '}
              <a href={inviteUrl} dir="ltr">
                {inviteUrl}
              </a>
            </Alert>
          )}
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <RHFTextField name="name" label={t('users.name')} required maxLength={120} />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="email"
                label={t('users.email')}
                required
                type="email"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
          </Grid>
          <Typography variant="subtitle1" fontWeight={700}>
            {t('superadmins.permissions')}
          </Typography>
          <PlatformPermissionPicker value={permissions} onChange={setPermissions} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

function PermissionsDrawer({ user, onClose }: { user: PlatformUser; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const muts = useSuperadminMutations();
  const [permissions, setPermissions] = useState<string[]>(user.permissions ?? []);
  const dirty =
    JSON.stringify([...permissions].sort()) !==
    JSON.stringify([...(user.permissions ?? [])].sort());
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('superadmins.permissionsOf', { name: user.displayName })}
      subtitle={t('superadmins.escalationHint')}
      formId="admin-sa-perms"
      submitting={muts.permissions.isPending}
      dirty={dirty}
      width={640}
    >
      <form
        id="admin-sa-perms"
        onSubmit={(e) => {
          e.preventDefault();
          void muts.permissions
            .mutateAsync({ id: user.id, permissions })
            .then(() => (notify.success(t('common.saved')), onClose()), notify.error);
        }}
      >
        <PlatformPermissionPicker value={permissions} onChange={setPermissions} />
      </form>
    </FormDrawer>
  );
}

export function SuperadminsPage() {
  const { t, i18n } = useTranslation('admin');
  const session = useSessionData();
  const confirm = useConfirm();
  const notify = useNotify();
  const list = useSuperadmins();
  const muts = useSuperadminMutations();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const isRoot = Boolean(session?.user.isRootSuperadmin);
  const columns: Column<PlatformUser>[] = [
    {
      field: 'displayName',
      headerName: t('users.name'),
      flex: 1.6,
      minWidth: 300,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <span dir="auto">{row.displayName}</span>
          {row.isRootSuperadmin && (
            <Chip
              size="small"
              color="warning"
              icon={<Shield size={12} />}
              label={t('superadmins.root')}
            />
          )}
          {row.id === session?.user.id && <Chip size="small" label={t('superadmins.you')} />}
        </Stack>
      ),
    },
    {
      field: 'email',
      headerName: t('users.email'),
      flex: 1.2,
      minWidth: 200,
      renderCell: ({ row }) => <span dir="ltr">{row.email}</span>,
    },
    {
      field: 'permissions',
      headerName: t('superadmins.permissions'),
      width: 150,
      sortable: false,
      valueGetter: (_v, row) =>
        row.isRootSuperadmin
          ? t('superadmins.allPermissions')
          : t('superadmins.count', { count: row.permissions?.length ?? 0 }),
    },
    {
      field: 'mfaEnabled',
      headerName: t('superadmins.mfa'),
      width: 110,
      renderCell: ({ row }) => (
        <StatusChip
          status={row.mfaEnabled ? 'active' : 'pending'}
          label={row.mfaEnabled ? t('common.yes') : t('common.no')}
        />
      ),
    },
    {
      field: 'lastActiveAt',
      headerName: t('users.lastActive'),
      width: 170,
      valueGetter: (_v, row) =>
        row.lastActiveAt
          ? formatDateTime(row.lastActiveAt, i18n.language)
          : row.invitationPending
            ? t('superadmins.invitationPending')
            : '—',
    },
    {
      field: 'status',
      headerName: t('common.status'),
      width: 120,
      sortable: false,
      renderCell: ({ row }) => <UserStatus u={row} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 220,
      sortable: false,
      renderCell: ({ row }) => {
        // Server rules mirrored (04 §8.2): nobody changes the root or themselves, except the root.
        const locked = row.isRootSuperadmin || (!isRoot && row.id === session?.user.id);
        if (locked) return null;
        return (
          <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
            <Button size="small" startIcon={<KeyRound size={14} />} onClick={() => setEditing(row)}>
              {t('superadmins.permissions')}
            </Button>
            <Button
              size="small"
              color={row.status === 'disabled' ? 'success' : 'error'}
              onClick={async () => {
                const to = row.status === 'disabled' ? 'enable' : 'disable';
                if (to === 'disable') {
                  const r = await confirm({
                    title: t('superadmins.disableTitle', { name: row.displayName }),
                    body: t('superadmins.disableBody'),
                    destructive: true,
                  });
                  if (!r.confirmed) return;
                }
                await muts.status
                  .mutateAsync({ id: row.id, to })
                  .then(() => notify.success(t(`users.done.${to}`)), notify.error);
              }}
            >
              {row.status === 'disabled' ? t('users.enable') : t('users.disable')}
            </Button>
            <Button
              size="small"
              component={RouterLink}
              to={`/admin/logs?tab=timeline&userId=${row.id}`}
            >
              {t('superadmins.activity')}
            </Button>
          </Stack>
        );
      },
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('superadmins.title')}
        subtitle={t('superadmins.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<UserPlus size={18} />}
            onClick={() => setInviting(true)}
          >
            {t('superadmins.invite')}
          </Button>
        }
      />
      <DataTable<PlatformUser>
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        clientSide
        columns={columns}
        empty={<EmptyState title={t('superadmins.empty')} />}
      />
      {inviting && <InviteSuperadminDrawer onClose={() => setInviting(false)} />}
      {editing && <PermissionsDrawer user={editing} onClose={() => setEditing(null)} />}
    </Box>
  );
}
