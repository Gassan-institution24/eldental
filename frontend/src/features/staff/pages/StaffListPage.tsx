import { Avatar, Button, Chip, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import {
  color,
  email,
  enumOf,
  optional,
  personName,
  phone,
  freeText,
} from '@/shared/generated/validation/fields';
import { DataTable, useListParams } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFColor } from '@/shared/form/RHFColor';
import { RHFCheckbox, RHFPhone } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { Can, useFieldAccess } from '@/shared/rbac/usePermission';
import { staffApi, useInviteStaff, useRoles, type StaffMember } from '../api';

export const STAFF_TYPES = [
  'dentist',
  'hygienist',
  'assistant',
  'receptionist',
  'accountant',
  'hr',
  'manager',
  'other',
] as const;
const DEFAULT_ROLE: Record<string, string> = {
  dentist: 'dentist',
  hygienist: 'hygienist',
  assistant: 'assistant',
  receptionist: 'receptionist',
  accountant: 'accountant',
  hr: 'hr_manager',
  manager: 'owner',
  other: 'assistant',
};

const inviteSchema = z
  .object({
    name: personName({ max: 120 }),
    email: optional(email()),
    phone: optional(phone()),
    staffType: enumOf([...STAFF_TYPES]),
    jobTitle: optional(freeText(80)),
    roleId: optional(z.string()),
    color: color(),
    bookableOnline: z.boolean(),
    sendInvite: z.boolean(),
  })
  .refine((v) => v.email || v.phone, { path: ['email'], message: 'required' });
type Invite = z.input<typeof inviteSchema>;

function InviteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('staff');
  const typeName = useSeedName('staffType');
  const roleName = useSeedName('roles');
  const roles = useRoles();
  const invite = useInviteStaff();
  const notify = useNotify();
  const navigate = useNavigate();
  const form = useAppForm<Invite>({
    schema: inviteSchema,
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      staffType: 'dentist',
      jobTitle: '',
      roleId: '',
      color: '#4F46E5',
      bookableOnline: true,
      sendInvite: true,
    },
  });
  const staffType = form.watch('staffType');

  const onSubmit = async (v: Invite) => {
    const role =
      v.roleId || roles.data?.find((r) => r.key === DEFAULT_ROLE[String(v.staffType)])?.id;
    const created = await invite.mutateAsync({
      name: v.name,
      email: v.email || undefined,
      phone: v.phone || undefined,
      staffType: v.staffType,
      jobTitle: v.jobTitle || undefined,
      color: v.color,
      bookableOnline:
        v.staffType === 'dentist' || v.staffType === 'hygienist' ? v.bookableOnline : false,
      roleIds: role ? [role] : [],
      sendInvite: v.sendInvite,
    });
    notify.success(t('invited', { name: v.name }));
    form.reset();
    onClose();
    navigate(`/clinic/hr/staff/${created.id}`);
  };

  return (
    <FormDrawer
      open={open}
      title={t('inviteTitle')}
      subtitle={t('inviteSubtitle')}
      onClose={onClose}
      formId="invite-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      submitLabel={t('invite')}
      width={540}
    >
      <Form form={form} name="staff.invite" onSubmit={onSubmit} id="invite-form" requiredLegend>
        <Grid container spacing={4}>
          <Grid item xs={12}>
            <RHFTextField name="name" label={t('fields.name')} required autoFocus maxLength={120} />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField
              name="email"
              label={t('fields.email')}
              type="email"
              required
              inputProps={{ dir: 'ltr' }}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFPhone name="phone" label={t('fields.phone')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect
              name="staffType"
              label={t('fields.staffType')}
              required
              options={STAFF_TYPES.map((s) => ({ value: s, label: typeName({ systemKey: s }) }))}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect
              name="roleId"
              label={t('fields.roles')}
              clearable
              helperText={roleName({ systemKey: DEFAULT_ROLE[String(staffType)] ?? '' })}
              options={(roles.data ?? []).map((r) => ({
                value: r.id,
                label: roleName({ name: r.name, systemKey: r.systemKey }),
              }))}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField name="jobTitle" label={t('fields.jobTitle')} maxLength={80} />
          </Grid>
          {(staffType === 'dentist' || staffType === 'hygienist') && (
            <>
              <Grid item xs={12}>
                <RHFColor name="color" label={t('fields.color')} />
              </Grid>
              <Grid item xs={12}>
                <RHFCheckbox name="bookableOnline" label={t('fields.bookableOnline')} asSwitch />
              </Grid>
            </>
          )}
          <Grid item xs={12}>
            <RHFCheckbox name="sendInvite" label={t('sendInvite')} />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

export function StaffListPage() {
  const { t } = useTranslation('staff');
  const typeName = useSeedName('staffType');
  const navigate = useNavigate();
  const lp = useListParams({ sort: 'name' });
  const fieldAccess = useFieldAccess('staff.member');
  const list = staffApi.useList({
    ...lp.params,
    staffType: lp.filter('staffType') || undefined,
    status: lp.filter('status') || undefined,
  });
  const [inviting, setInviting] = useState(false);

  return (
    <FieldScope value={fieldAccess}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        primary={
          <Can perm="staff.member.create">
            <Button
              variant="contained"
              startIcon={<UserPlus size={18} />}
              onClick={() => setInviting(true)}
            >
              {t('invite')}
            </Button>
          </Can>
        }
      />
      <DataTable<StaffMember>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => navigate(`/clinic/hr/staff/${r.id}`)}
        toolbar={
          <Stack direction="row" spacing={2}>
            <TextField
              select
              size="small"
              label={t('fields.staffType')}
              value={lp.filter('staffType')}
              onChange={(e) => lp.set({ staffType: e.target.value, page: 1 })}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">{t('allTypes')}</MenuItem>
              {STAFF_TYPES.map((s) => (
                <MenuItem key={s} value={s}>
                  {typeName({ systemKey: s })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label={t('fields.status')}
              value={lp.filter('status')}
              onChange={(e) => lp.set({ status: e.target.value, page: 1 })}
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="">{t('allStatuses')}</MenuItem>
              {(['active', 'inactive', 'terminated'] as const).map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`statuses.${s}`)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        }
        empty={
          <EmptyState
            title={t('empty')}
            description={t('emptyHint')}
            action={
              <Button
                variant="contained"
                startIcon={<Plus size={18} />}
                onClick={() => setInviting(true)}
              >
                {t('invite')}
              </Button>
            }
            compact
          />
        }
        columns={[
          {
            field: 'name',
            headerName: t('fields.name'),
            fieldKey: 'name',
            flex: 1.4,
            minWidth: 220,
            sortable: true,
            renderCell: (p) => (
              <Stack direction="row" spacing={3} alignItems="center" sx={{ height: '100%' }}>
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: 14,
                    bgcolor: p.row.color ?? 'primary.main',
                  }}
                >
                  {p.row.name.slice(0, 1)}
                </Avatar>
                <Stack sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={650} dir="auto" noWrap>
                    {p.row.name}
                  </Typography>
                  {p.row.jobTitle && (
                    <Typography variant="caption" color="text.secondary" noWrap dir="auto">
                      {p.row.jobTitle}
                    </Typography>
                  )}
                </Stack>
                {p.row.isOwner && <Chip size="small" color="primary" label={t('owner')} />}
                {p.row.hasCustomPermissions && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color="warning"
                    label={t('customPermissions')}
                  />
                )}
              </Stack>
            ),
          },
          {
            field: 'staffType',
            headerName: t('fields.staffType'),
            fieldKey: 'staffType',
            width: 150,
            sortable: true,
            renderCell: (p) => typeName({ systemKey: p.row.staffType }),
          },
          {
            field: 'phone',
            headerName: t('fields.phone'),
            fieldKey: 'phone',
            width: 160,
            renderCell: (p) => <span dir="ltr">{p.row.phone ?? '—'}</span>,
          },
          {
            field: 'email',
            headerName: t('fields.email'),
            fieldKey: 'email',
            flex: 1,
            minWidth: 180,
            renderCell: (p) => <span dir="ltr">{p.row.email ?? '—'}</span>,
          },
          {
            field: 'status',
            headerName: t('fields.status'),
            fieldKey: 'status',
            width: 120,
            sortable: true,
            renderCell: (p) => <StatusChip status={p.row.status} />,
          },
        ]}
      />
      <InviteDrawer open={inviting} onClose={() => setInviting(false)} />
    </FieldScope>
  );
}
