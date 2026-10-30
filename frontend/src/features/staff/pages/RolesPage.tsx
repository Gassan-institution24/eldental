import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Copy, Eye, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { entityName } from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { SectionCard } from '@/shared/components/SectionCard';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { PermissionEditor, useAccessSummary } from '../components/PermissionEditor';
import {
  rolesApi,
  useCloneRole,
  usePermissionRegistry,
  usePreviewDiff,
  useRoles,
  type DiffChange,
  type Grant,
  type Role,
} from '../api';

const norm = (g: Grant[]) =>
  JSON.stringify([...g].sort((a, b) => a.permission.localeCompare(b.permission)));

function DiffDialog({
  role,
  changes,
  affected,
  open,
  onClose,
  onConfirm,
  saving,
}: {
  role: string;
  changes: DiffChange[];
  affected: number;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation(['roles', 'perm']);
  const lvl = (l: string) => t(`perm:access.${l}`);
  const pl = (p: string) => t(`perm:${p}`, { defaultValue: p });
  const describe = (c: DiffChange): string => {
    switch (c.kind) {
      case 'added':
        return t('diffAdded', { perm: pl(c.permission), scope: t(`perm:scope.${c.scope}`) });
      case 'removed':
        return t('diffRemoved', { perm: pl(c.permission) });
      case 'scope':
        return t('diffScope', {
          perm: pl(c.permission),
          from: t(`perm:scope.${c.from}`),
          to: t(`perm:scope.${c.to}`),
        });
      default:
        return t('diffField', {
          perm: pl(c.permission),
          field: t(`perm:fields.${c.field}`),
          from: lvl(c.from),
          to: lvl(c.to),
        });
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('diffTitle', { name: role })}</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 4 }}>
          {t('diffAffects', { count: affected })}
        </Alert>
        {changes.length === 0 && <Typography color="text.secondary">{t('diffNone')}</Typography>}
        <Stack spacing={2}>
          {changes.map((c, i) => {
            const text = describe(c);
            const widened =
              c.kind === 'added' ||
              (c.kind === 'field' && c.widened) ||
              (c.kind === 'scope' && c.to === 'all');
            return (
              <Stack key={i} direction="row" spacing={2} alignItems="flex-start">
                <Box
                  sx={{
                    width: 8,
                    height: 8,
                    mt: 1,
                    borderRadius: '50%',
                    bgcolor: widened ? 'warning.main' : 'text.disabled',
                    flexShrink: 0,
                  }}
                />
                <Typography variant="body2">{text}</Typography>
                {widened && (
                  <Chip size="small" color="warning" variant="outlined" label={t('widened')} />
                )}
              </Stack>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 6, py: 4 }}>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={onConfirm} disabled={saving || changes.length === 0}>
          {t('confirmSave')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const newRoleSchema = z.object({ name: entityName({ max: 60 }), from: z.string() });
type NewRole = z.infer<typeof newRoleSchema>;

function NewRoleDialog({
  open,
  onClose,
  roles,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  roles: Role[];
  onCreated: (r: Role) => void;
}) {
  const { t } = useTranslation('roles');
  const roleName = useSeedName('roles');
  const create = rolesApi.useCreate();
  const clone = useCloneRole();
  const form = useAppForm<NewRole>({
    schema: newRoleSchema,
    defaultValues: { name: '', from: '' },
  });
  const onSubmit = async (v: NewRole) => {
    const r = v.from
      ? await clone.mutateAsync({ id: v.from, name: v.name })
      : await create.mutateAsync({ name: v.name, permissions: [] } as Partial<Role>);
    form.reset();
    onCreated(r);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('createTitle')}</DialogTitle>
      <DialogContent>
        <Form form={form} name="roles.create" onSubmit={onSubmit} id="new-role">
          <Stack spacing={4} sx={{ pt: 2 }}>
            <RHFTextField name="name" label={t('nameLabel')} required autoFocus maxLength={60} />
            <TextField
              select
              label={t('startFrom')}
              value={form.watch('from')}
              onChange={(e) => form.setValue('from', e.target.value)}
            >
              <MenuItem value="">{t('blank')}</MenuItem>
              {roles.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {roleName({ name: r.name, systemKey: r.systemKey })}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        </Form>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          type="submit"
          form="new-role"
          variant="contained"
          disabled={form.formState.isSubmitting}
        >
          {t('common:actions.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Role & permission editor (04 §7). */
export function RolesPage() {
  const { t } = useTranslation(['roles', 'perm']);
  const roleName = useSeedName('roles');
  const roles = useRoles();
  const registry = usePermissionRegistry();
  const update = rolesApi.useUpdate();
  const remove = rolesApi.useRemove();
  const preview = usePreviewDiff();
  const notify = useNotify();
  const confirm = useConfirm();
  const summary = useAccessSummary();
  const [sp, setSp] = useSearchParams();
  const selectedId = sp.get('role') ?? roles.data?.[0]?.id;
  const selected = roles.data?.find((r) => r.id === selectedId);
  const [draft, setDraft] = useState<Grant[]>([]);
  const [diff, setDiff] = useState<{ changes: DiffChange[]; affected: number } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (selected) setDraft(selected.permissions);
  }, [selected]);

  const dirty = useMemo(
    () => (selected ? norm(draft) !== norm(selected.permissions) : false),
    [draft, selected],
  );
  const isOwnerRole = selected?.key === 'owner';

  if (roles.isLoading || registry.isLoading) return <PageSkeleton />;
  if (roles.isError || registry.isError || !registry.data)
    return (
      <ErrorState error={roles.error ?? registry.error} onRetry={() => void roles.refetch()} />
    );

  const select = async (id: string) => {
    if (dirty) {
      const r = await confirm({
        title: t('common:states.unsavedTitle'),
        body: t('common:states.unsavedBody'),
        confirmLabel: t('common:actions.leave'),
        destructive: true,
      });
      if (!r.confirmed) return;
    }
    setSp({ role: id }, { replace: true });
  };

  const review = async () => {
    if (!selected) return;
    try {
      const r = await preview.mutateAsync({ id: selected.id, permissions: draft });
      setDiff({ changes: r.changes, affected: r.affectedStaff });
    } catch (err) {
      notify.error(err);
    }
  };

  const save = async () => {
    if (!selected) return;
    try {
      await update.mutateAsync({ id: selected.id, version: selected.version, permissions: draft });
      setDiff(null);
      notify.success(t('saved'));
      void roles.refetch();
    } catch (err) {
      notify.error(err);
    }
  };

  const staffFields = registry.data.resources['staff.member']?.fields;
  const patientFields = registry.data.resources['patients.patient']?.fields;

  return (
    <Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '260px 1fr' },
          gap: 5,
          alignItems: 'start',
        }}
      >
        <Card sx={{ p: 2 }}>
          <Button
            fullWidth
            startIcon={<Plus size={18} />}
            variant="outlined"
            onClick={() => setCreating(true)}
            sx={{ mb: 2 }}
          >
            {t('newRole')}
          </Button>
          <List dense disablePadding>
            {(roles.data ?? []).map((r) => (
              <ListItemButton
                key={r.id}
                selected={r.id === selectedId}
                onClick={() => void select(r.id)}
                sx={{ borderRadius: '10px', mb: 0.5 }}
              >
                <ListItemText
                  primary={
                    <span dir="auto">{roleName({ name: r.name, systemKey: r.systemKey })}</span>
                  }
                  secondary={t('users', { count: r.userCount ?? 0 })}
                />
                {r.isSystem && <Chip size="small" variant="outlined" label={t('system')} />}
              </ListItemButton>
            ))}
          </List>
        </Card>
        {selected ? (
          <Box sx={{ minWidth: 0 }}>
            <SectionCard
              title={
                <span dir="auto">
                  {roleName({ name: selected.name, systemKey: selected.systemKey })}
                </span>
              }
              subtitle={t('users', { count: selected.userCount ?? 0 })}
              actions={
                !isOwnerRole && (
                  <Stack direction="row" spacing={1}>
                    {!selected.isSystem && (
                      <Button
                        color="error"
                        startIcon={<Trash2 size={16} />}
                        onClick={async () => {
                          const r = await confirm({
                            title: t('deleteTitle', {
                              name: roleName({
                                name: selected.name,
                                systemKey: selected.systemKey,
                              }),
                            }),
                            destructive: true,
                            confirmLabel: t('delete'),
                          });
                          if (!r.confirmed) return;
                          try {
                            await remove.mutateAsync(selected.id);
                            setSp({}, { replace: true });
                            notify.success(t('deleted'));
                          } catch (err) {
                            notify.error(err);
                          }
                        }}
                      >
                        {t('delete')}
                      </Button>
                    )}
                    <Button startIcon={<Copy size={16} />} onClick={() => setCreating(true)}>
                      {t('clone')}
                    </Button>
                  </Stack>
                )
              }
            >
              {isOwnerRole ? (
                <Alert icon={<ShieldCheck size={20} />} severity="success">
                  {t('ownerRole')}
                </Alert>
              ) : (
                <>
                  <Card variant="outlined" sx={{ p: 4, mb: 5, bgcolor: 'background.default' }}>
                    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                      <Eye size={16} />
                      <Typography variant="body2" fontWeight={700}>
                        {t('preview')}
                      </Typography>
                    </Stack>
                    {[
                      ...summary(draft, 'staff.member', staffFields),
                      ...summary(draft, 'patients.patient', patientFields),
                    ].map((line) => (
                      <Typography key={line} variant="body2" color="text.secondary">
                        • {line}
                      </Typography>
                    ))}
                  </Card>
                  <PermissionEditor registry={registry.data} value={draft} onChange={setDraft} />
                </>
              )}
            </SectionCard>
            {dirty && (
              <Card
                sx={(th) => ({
                  position: 'sticky',
                  bottom: 16,
                  p: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  boxShadow: th.brand.elevated,
                  zIndex: 5,
                })}
              >
                <Typography variant="body2" fontWeight={650} sx={{ flex: 1 }}>
                  {t('unsaved')}
                </Typography>
                <Button onClick={() => setDraft(selected.permissions)}>{t('discard')}</Button>
                <Button
                  variant="contained"
                  onClick={() => void review()}
                  disabled={preview.isPending}
                >
                  {t('save')}
                </Button>
              </Card>
            )}
          </Box>
        ) : (
          <Card sx={{ p: 10, textAlign: 'center' }}>
            <Typography color="text.secondary">{t('selectRole')}</Typography>
          </Card>
        )}
      </Box>
      {diff && selected && (
        <DiffDialog
          role={roleName({ name: selected.name, systemKey: selected.systemKey })}
          changes={diff.changes}
          affected={diff.affected}
          open
          onClose={() => setDiff(null)}
          onConfirm={() => void save()}
          saving={update.isPending}
        />
      )}
      <NewRoleDialog
        open={creating}
        onClose={() => setCreating(false)}
        roles={roles.data ?? []}
        onCreated={(r) => setSp({ role: r.id }, { replace: true })}
      />
    </Box>
  );
}
