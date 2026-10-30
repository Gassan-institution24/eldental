import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Grid,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Mail, Power, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useSessionData } from '@/features/auth/api/session';
import {
  color,
  dateOfBirth,
  dateOnly,
  email,
  enumOf,
  freeText,
  iban,
  money,
  nationalId,
  nullable,
  optional,
  percent,
  personName,
  phone,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { ErrorState, NoPermission, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFColor } from '@/shared/form/RHFColor';
import { RHFCheckbox, RHFDate, RHFMoney, RHFPhone } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { useFieldAccess, usePermission } from '@/shared/rbac/usePermission';
import { PermissionEditor } from '../components/PermissionEditor';
import {
  staffApi,
  useEffectivePermissions,
  usePermissionRegistry,
  useRoles,
  useSaveOverrides,
  useSetRoles,
  useStaffAction,
  type Grant,
  type Override,
  type StaffMember,
} from '../api';
import { STAFF_TYPES } from './StaffListPage';

const profileSchema = z.object({
  name: personName({ max: 120 }),
  email: nullable(email()),
  phone: nullable(phone()),
  staffType: enumOf([...STAFF_TYPES]),
  jobTitle: optional(freeText(80)),
  gender: optional(enumOf(['male', 'female'])),
  dateOfBirth: nullable(dateOfBirth()),
  nationalId: nullable(nationalId()),
  address: optional(freeText(300)),
  specialty: optional(freeText(80)),
  licenseNumber: optional(freeText(40)),
  licenseExpiry: nullable(dateOnly()),
  color: color(),
  bookableOnline: z.boolean(),
});
type Profile = z.input<typeof profileSchema>;

/** Only send fields the user changed (others may be hidden/read-only → FIELD_FORBIDDEN). */
function dirtyOnly<T extends Record<string, unknown>>(
  values: T,
  dirty: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([k]) => dirty[k as keyof T]),
  ) as Partial<T>;
}

function ProfileTab({ staff }: { staff: StaffMember }) {
  const { t } = useTranslation('staff');
  const typeName = useSeedName('staffType');
  const notify = useNotify();
  const update = staffApi.useUpdate();
  const { can } = usePermission();
  const canEdit = can('staff.member.update');
  const form = useAppForm<Profile>({
    schema: profileSchema,
    values: {
      name: staff.name,
      email: staff.email ?? '',
      phone: staff.phone ?? '',
      staffType: staff.staffType as Profile['staffType'],
      jobTitle: staff.jobTitle ?? '',
      gender: staff.gender ?? '',
      dateOfBirth: staff.dateOfBirth ?? '',
      nationalId: staff.nationalId && !staff.nationalId.includes('•') ? staff.nationalId : '',
      address: staff.address ?? '',
      specialty: staff.specialty ?? '',
      licenseNumber: staff.licenseNumber ?? '',
      licenseExpiry: staff.licenseExpiry ?? '',
      color: staff.color ?? '#4F46E5',
      bookableOnline: Boolean(staff.bookableOnline),
    },
    defaultValues: { name: '', color: '#4F46E5', bookableOnline: false, staffType: 'other' },
  });
  const onSubmit = async (v: Profile) => {
    const changes = dirtyOnly(
      v as Record<string, unknown>,
      form.formState.dirtyFields as Record<string, unknown>,
    );
    await update.mutateAsync({
      id: staff.id,
      version: staff.version,
      ...(changes as Partial<StaffMember>),
    });
    notify.success(t('saved'));
  };
  const clinical = staff.staffType === 'dentist' || staff.staffType === 'hygienist';
  return (
    <Form form={form} name="staff.profile" onSubmit={onSubmit} guardUnsaved>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <SectionCard title={t('sections.personal')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="name"
                label={t('fields.name')}
                fieldKey="name"
                required
                maxLength={120}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <RHFSelect
                name="gender"
                label={t('fields.gender')}
                fieldKey="gender"
                clearable
                options={(['male', 'female'] as const).map((g) => ({
                  value: g,
                  label: t(`genders.${g}`),
                }))}
              />
            </Grid>
            <Grid item xs={12} md={3}>
              <RHFDate
                name="dateOfBirth"
                label={t('fields.dateOfBirth')}
                fieldKey="dateOfBirth"
                disableFuture
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="nationalId"
                label={t('fields.nationalId')}
                fieldKey="nationalId"
                inputProps={{ dir: 'ltr', inputMode: 'numeric' }}
              />
            </Grid>
          </Grid>
        </SectionCard>
        <SectionCard title={t('sections.contact')}>
          <Grid container spacing={4}>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="email"
                label={t('fields.email')}
                fieldKey="email"
                type="email"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFPhone name="phone" label={t('fields.phone')} fieldKey="phone" />
            </Grid>
            <Grid item xs={12}>
              <RHFTextField
                name="address"
                label={t('fields.address')}
                fieldKey="address"
                maxLength={300}
              />
            </Grid>
          </Grid>
        </SectionCard>
        <SectionCard
          title={t('sections.professional')}
          footer={
            canEdit && (
              <Button
                type="submit"
                variant="contained"
                disabled={form.formState.isSubmitting || !form.formState.isDirty}
              >
                {t('common:actions.saveChanges')}
              </Button>
            )
          }
        >
          <Grid container spacing={4}>
            <Grid item xs={12} md={4}>
              <RHFSelect
                name="staffType"
                label={t('fields.staffType')}
                fieldKey="staffType"
                required
                options={STAFF_TYPES.map((s) => ({ value: s, label: typeName({ systemKey: s }) }))}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="jobTitle"
                label={t('fields.jobTitle')}
                fieldKey="jobTitle"
                maxLength={80}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="specialty"
                label={t('fields.specialty')}
                fieldKey="specialty"
                maxLength={80}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFTextField
                name="licenseNumber"
                label={t('fields.licenseNumber')}
                fieldKey="licenseNumber"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFDate
                name="licenseExpiry"
                label={t('fields.licenseExpiry')}
                fieldKey="licenseExpiry"
              />
            </Grid>
            {clinical && (
              <>
                <Grid item xs={12}>
                  <RHFColor name="color" label={t('fields.color')} />
                </Grid>
                <Grid item xs={12}>
                  <RHFCheckbox
                    name="bookableOnline"
                    label={t('fields.bookableOnline')}
                    fieldKey="bookableOnline"
                    asSwitch
                  />
                </Grid>
              </>
            )}
          </Grid>
        </SectionCard>
      </fieldset>
    </Form>
  );
}

const employmentSchema = z.object({
  employmentType: enumOf(['full_time', 'part_time', 'contractor']),
  hireDate: optional(dateOnly()),
  endDate: optional(dateOnly()),
  basicSalary: money(),
  sscEnrolled: z.boolean(),
  commissionBasis: optional(enumOf(['production', 'collection'])),
  commissionPercent: optional(z.coerce.number().pipe(percent())),
  bankName: optional(freeText(80)),
  iban: optional(iban()),
});
type Employment = z.input<typeof employmentSchema>;

function EmploymentTab({ staff }: { staff: StaffMember }) {
  const { t } = useTranslation('staff');
  const notify = useNotify();
  const currency = useCurrency();
  const update = staffApi.useUpdate();
  const scope = useFieldAccess('staff.member', 'write');
  const form = useAppForm<Employment>({
    schema: employmentSchema,
    values: {
      employmentType: (staff.employment?.type as Employment['employmentType']) ?? 'full_time',
      hireDate: staff.employment?.hireDate ?? '',
      endDate: staff.employment?.endDate ?? '',
      basicSalary: staff.compensation?.basicSalary ?? 0,
      sscEnrolled: staff.compensation?.socialSecurity?.enrolled ?? true,
      commissionBasis: staff.compensation?.commission?.basis ?? '',
      commissionPercent: staff.compensation?.commission?.percent ?? '',
      bankName: staff.bank?.bankName ?? '',
      iban: staff.bank?.iban && !staff.bank.iban.includes('*') ? staff.bank.iban : '',
    },
    defaultValues: { employmentType: 'full_time', basicSalary: 0, sscEnrolled: true },
  });
  const d = form.formState.dirtyFields;
  const onSubmit = async (v: Employment) => {
    const body: Record<string, unknown> = {};
    if (d.employmentType || d.hireDate || d.endDate)
      body.employment = {
        type: v.employmentType,
        hireDate: v.hireDate || undefined,
        endDate: v.endDate || undefined,
      };
    if (d.basicSalary || d.sscEnrolled || d.commissionBasis || d.commissionPercent) {
      body.compensation = {
        ...(d.basicSalary ? { basicSalary: v.basicSalary } : {}),
        ...(d.sscEnrolled ? { socialSecurity: { enrolled: v.sscEnrolled } } : {}),
        ...(d.commissionBasis || d.commissionPercent
          ? {
              commission: v.commissionBasis
                ? { basis: v.commissionBasis, percent: Number(v.commissionPercent || 0) }
                : null,
            }
          : {}),
      };
    }
    if (d.bankName || d.iban)
      body.bank = { bankName: v.bankName ?? '', ...(v.iban ? { iban: v.iban } : {}) };
    await update.mutateAsync({
      id: staff.id,
      version: staff.version,
      ...(body as Partial<StaffMember>),
    });
    notify.success(t('saved'));
  };
  const canSeeComp = scope.canSee('basicSalary');
  return (
    <FieldScope value={scope}>
      <Form form={form} name="staff.employment" onSubmit={onSubmit} guardUnsaved>
        {scope.canSee('employment') && (
          <SectionCard title={t('sections.employment')}>
            <Grid container spacing={4}>
              <Grid item xs={12} md={4}>
                <RHFSelect
                  name="employmentType"
                  label={t('fields.employmentType')}
                  fieldKey="employment"
                  options={(['full_time', 'part_time', 'contractor'] as const).map((e) => ({
                    value: e,
                    label: t(`employmentTypes.${e}`),
                  }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <RHFDate name="hireDate" label={t('fields.hireDate')} fieldKey="employment" />
              </Grid>
              <Grid item xs={12} md={4}>
                <RHFDate name="endDate" label={t('fields.endDate')} fieldKey="employment" />
              </Grid>
            </Grid>
          </SectionCard>
        )}
        {canSeeComp && (
          <SectionCard
            title={t('sections.compensation')}
            subtitle={<MoneyText value={staff.compensation?.basicSalary ?? 0} />}
          >
            <Grid container spacing={4}>
              <Grid item xs={12} md={4}>
                <RHFMoney
                  name="basicSalary"
                  label={t('fields.basicSalary')}
                  fieldKey="basicSalary"
                  currency={currency}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <RHFSelect
                  name="commissionBasis"
                  label={t('fields.commissionBasis')}
                  fieldKey="commission"
                  clearable
                  options={(['production', 'collection'] as const).map((b) => ({
                    value: b,
                    label: t(`commissionBases.${b}`),
                  }))}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <RHFTextField
                  name="commissionPercent"
                  label={t('fields.commissionPercent')}
                  fieldKey="commission"
                  type="number"
                  inputProps={{ dir: 'ltr', step: 0.5 }}
                />
              </Grid>
              <Grid item xs={12}>
                <RHFCheckbox
                  name="sscEnrolled"
                  label={t('fields.sscEnrolled')}
                  fieldKey="allowances"
                />
              </Grid>
            </Grid>
          </SectionCard>
        )}
        {(scope.canSee('bank') || scope.isMasked('bank')) && (
          <SectionCard title={t('sections.bank')}>
            <Grid container spacing={4}>
              <Grid item xs={12} md={5}>
                <RHFTextField name="bankName" label={t('fields.bankName')} fieldKey="bank" />
              </Grid>
              <Grid item xs={12} md={7}>
                <RHFTextField
                  name="iban"
                  label={t('fields.iban')}
                  fieldKey="bank"
                  helperText={staff.bank?.iban}
                  inputProps={{ dir: 'ltr' }}
                />
              </Grid>
            </Grid>
          </SectionCard>
        )}
        {(scope.canEdit('basicSalary') || scope.canEdit('employment') || scope.canEdit('bank')) && (
          <Stack direction="row" justifyContent="flex-end">
            <Button
              type="submit"
              variant="contained"
              disabled={form.formState.isSubmitting || !form.formState.isDirty}
            >
              {t('common:actions.saveChanges')}
            </Button>
          </Stack>
        )}
      </Form>
    </FieldScope>
  );
}

function PermissionsTab({ staff }: { staff: StaffMember }) {
  const { t, i18n } = useTranslation(['staff', 'perm']);
  const listFormat = new Intl.ListFormat(i18n.resolvedLanguage ?? 'ar', { type: 'conjunction' });
  const roleName = useSeedName('roles');
  const roles = useRoles();
  const registry = usePermissionRegistry();
  const eff = useEffectivePermissions(staff.id);
  const setRoles = useSetRoles();
  const saveOverrides = useSaveOverrides();
  const notify = useNotify();
  const session = useSessionData();
  const [roleIds, setRoleIds] = useState<string[]>(staff.roleIds ?? []);
  const [isOwner, setIsOwner] = useState(Boolean(staff.isOwner));
  const [grants, setGrants] = useState<Grant[]>([]);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const o = eff.data?.overrides ?? [];
    setGrants(o.filter((x): x is Grant => !('revoked' in x)));
    setRevoked(new Set(o.filter((x) => 'revoked' in x).map((x) => x.permission)));
  }, [eff.data]);

  const rolesDirty = useMemo(
    () =>
      JSON.stringify([...roleIds].sort()) !== JSON.stringify([...(staff.roleIds ?? [])].sort()) ||
      isOwner !== Boolean(staff.isOwner),
    [roleIds, isOwner, staff],
  );

  if (roles.isLoading || registry.isLoading || eff.isLoading) return <PageSkeleton rows={4} />;
  if (!registry.data) return <ErrorState error={registry.error} />;

  const saveRoles = async () => {
    try {
      await setRoles.mutateAsync({
        id: staff.id,
        roleIds,
        ...(session?.isOwner ? { isOwner } : {}),
      });
      notify.success(t('rolesSaved'));
      void eff.refetch();
    } catch (err) {
      notify.error(err);
    }
  };
  const saveOv = async () => {
    const overrides: Override[] = [
      ...grants,
      ...[...revoked].map((p) => ({ permission: p, revoked: true as const })),
    ];
    try {
      await saveOverrides.mutateAsync({ id: staff.id, overrides });
      notify.success(t('overridesSaved'));
      setEditing(false);
      void eff.refetch();
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <>
      <SectionCard
        title={t('rolesTitle')}
        subtitle={t('rolesHint')}
        footer={
          rolesDirty && (
            <Button
              variant="contained"
              onClick={() => void saveRoles()}
              disabled={setRoles.isPending}
            >
              {t('common:actions.saveChanges')}
            </Button>
          )
        }
      >
        {session?.isOwner && (
          <FormControlLabel
            control={<Checkbox checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)} />}
            label={t('makeOwner')}
            sx={{ mb: 2 }}
          />
        )}
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
          {(roles.data ?? []).map((r) => {
            const on = roleIds.includes(r.id);
            return (
              <Chip
                key={r.id}
                label={roleName({ name: r.name, systemKey: r.systemKey })}
                color={on ? 'primary' : 'default'}
                variant={on ? 'filled' : 'outlined'}
                onClick={() =>
                  setRoleIds((ids) => (on ? ids.filter((x) => x !== r.id) : [...ids, r.id]))
                }
                aria-pressed={on}
              />
            );
          })}
        </Stack>
      </SectionCard>
      {eff.data?.isOwner ? (
        <Alert icon={<ShieldCheck size={20} />} severity="success">
          {t('ownerHasAll')}
        </Alert>
      ) : (
        <SectionCard
          title={t('overrides')}
          subtitle={t('overridesHint')}
          actions={
            editing ? (
              <Stack direction="row" spacing={1}>
                <Button onClick={() => setEditing(false)}>{t('common:actions.cancel')}</Button>
                <Button
                  variant="contained"
                  onClick={() => void saveOv()}
                  disabled={saveOverrides.isPending}
                >
                  {t('common:actions.save')}
                </Button>
              </Stack>
            ) : (
              <Button variant="outlined" onClick={() => setEditing(true)}>
                {t('editOverrides')}
              </Button>
            )
          }
        >
          {editing ? (
            <PermissionEditor
              registry={registry.data}
              value={grants}
              onChange={setGrants}
              revoked={revoked}
              onToggleRevoked={(p) =>
                setRevoked((s) => {
                  const n = new Set(s);
                  if (n.has(p)) n.delete(p);
                  else n.add(p);
                  return n;
                })
              }
            />
          ) : grants.length + revoked.size === 0 ? (
            <Typography color="text.secondary">{t('noOverrides')}</Typography>
          ) : (
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
              {grants.map((g) => (
                <Chip
                  key={g.permission}
                  color="warning"
                  variant="outlined"
                  label={`${t(`perm:${g.permission}`)} · ${t(`perm:scope.${g.scope}`)}`}
                />
              ))}
              {[...revoked].map((p) => (
                <Chip
                  key={p}
                  color="error"
                  variant="outlined"
                  sx={{ textDecoration: 'line-through' }}
                  label={t(`perm:${p}`)}
                />
              ))}
            </Stack>
          )}
        </SectionCard>
      )}
      <SectionCard title={t('inherited')}>
        <Stack spacing={1}>
          {Object.entries(eff.data?.inherited ?? {}).map(([perm, g]) => (
            <Stack
              key={perm}
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ py: 1, borderBottom: 1, borderColor: 'divider' }}
            >
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  color: revoked.has(perm) ? 'text.disabled' : 'text.primary',
                  textDecoration: revoked.has(perm) ? 'line-through' : 'none',
                }}
              >
                {t(`perm:${perm}`)}
              </Typography>
              <Chip size="small" label={t(`perm:scope.${g.scope}`)} />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ minWidth: 140 }}
                dir="auto"
              >
                {listFormat.format(
                  g.sources.map((src) => roleName({ systemKey: src, name: null })),
                )}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </SectionCard>
    </>
  );
}

export function StaffProfilePage() {
  const { t } = useTranslation('staff');
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'profile';
  const q = staffApi.useItem(id);
  const fieldAccess = useFieldAccess('staff.member', 'write');
  const { can } = usePermission();
  const action = useStaffAction();
  const confirm = useConfirm();
  const notify = useNotify();
  const typeName = useSeedName('staffType');
  const session = useSessionData();

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  const showEmployment =
    fieldAccess.canSee('basicSalary') ||
    fieldAccess.canSee('employment') ||
    fieldAccess.canSee('bank') ||
    fieldAccess.isMasked('bank');

  const toggleActive = async () => {
    if (s.status === 'active') {
      const r = await confirm({
        title: t('deactivateTitle', { name: s.name }),
        body: t('deactivateBody'),
        destructive: true,
        confirmLabel: t('deactivate'),
        reason: { required: false },
      });
      if (!r.confirmed) return;
      try {
        await action.mutateAsync({
          id: s.id,
          action: 'deactivate',
          body: { status: 'inactive', ...(r.reason ? { reason: r.reason } : {}) },
        });
        notify.success(t('deactivated', { name: s.name }));
      } catch (err) {
        notify.error(err);
      }
    } else {
      await action.mutateAsync({ id: s.id, action: 'reactivate' });
      notify.success(t('reactivated', { name: s.name }));
    }
  };

  return (
    <FieldScope value={fieldAccess}>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/clinic/hr/staff' }, { label: s.name }]}
        title={
          <Stack direction="row" spacing={3} alignItems="center">
            <Avatar
              sx={{ width: 52, height: 52, bgcolor: s.color ?? 'primary.main', fontSize: 22 }}
            >
              {s.name.slice(0, 1)}
            </Avatar>
            <Box>
              <span dir="auto">{s.name}</span>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
                <StatusChip status={s.status} />
                <Chip
                  size="small"
                  variant="outlined"
                  label={typeName({ systemKey: s.staffType })}
                />
                {s.isOwner && <Chip size="small" color="primary" label={t('owner')} />}
                {s.id === session?.staff?.id && <Chip size="small" label={t('you')} />}
                {s.fileNumber && (
                  <Typography variant="caption" color="text.secondary" dir="ltr">
                    {s.fileNumber}
                  </Typography>
                )}
              </Stack>
            </Box>
          </Stack>
        }
        secondary={[
          {
            label: t('resend'),
            icon: <Mail size={16} />,
            hidden: !can('staff.member.create'),
            onClick: () =>
              void action.mutateAsync({ id: s.id, action: 'resend-invite' }).then(
                () => notify.success(t('resent')),
                (e: unknown) => notify.error(e),
              ),
          },
          {
            label: s.status === 'active' ? t('deactivate') : t('reactivate'),
            icon: <Power size={16} />,
            hidden: !can('staff.member.delete') || s.id === session?.staff?.id,
            onClick: () => void toggleActive(),
          },
        ]}
      />
      <Tabs
        value={tab}
        onChange={(_e, v: string) => setSp({ tab: v }, { replace: true })}
        sx={{ mb: 6, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="profile" label={t('tabs.profile')} />
        {showEmployment && <Tab value="employment" label={t('tabs.employment')} />}
        {can('staff.role.manage') && <Tab value="permissions" label={t('tabs.permissions')} />}
      </Tabs>
      {tab === 'profile' && <ProfileTab staff={s} />}
      {tab === 'employment' && showEmployment && <EmploymentTab staff={s} />}
      {tab === 'permissions' && can('staff.role.manage') && <PermissionsTab staff={s} />}
      {!showEmployment && tab === 'employment' && (
        <NoPermission permission="hr.compensation.read" />
      )}
    </FieldScope>
  );
}

/** `/clinic/me` → the signed-in staff member's own profile (own scope). */
export function MyProfileRedirect() {
  const session = useSessionData();
  if (!session?.staff) return <PageSkeleton />;
  return <Navigate to={`/clinic/hr/staff/${session.staff.id}`} replace />;
}
