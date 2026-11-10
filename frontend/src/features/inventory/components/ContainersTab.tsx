import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, LinearProgress, List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { History, MoveRight, PackageOpen, Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { formatDate, formatDateTime } from '@/lib/dates';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable } from '@/shared/components/DataTable';
import { MoneyText } from '@/shared/components/MoneyText';
import { StatusChip } from '@/shared/components/StatusChip';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { useAppForm } from '@/shared/form/useAppForm';
import { dateOnly, objectId, optional } from '@/shared/generated/validation/fields';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { fmtQty, locationsApi, useContainerAction, useContainerEvents, useContainers, type Container } from '../api';

/** Status → tone of the shared status chip. */
export const CONTAINER_TONE: Record<Container['status'], string> = { sealed: 'new', open: 'open', empty: 'closed', discarded: 'void' };

export default function ContainersTab() {
  const { t, i18n } = useTranslation('inventory');
  const { can } = usePermission();
  const notify = useNotify();
  const confirm = useConfirm();
  const [status, setStatus] = useState('sealed,open');
  const [locationId, setLocationId] = useState('');
  const locations = locationsApi.useAll();
  const list = useContainers({ status, locationId: locationId || undefined });
  const action = useContainerAction();
  const [opening, setOpening] = useState<Container | null>(null);
  const [moving, setMoving] = useState<Container | null>(null);
  const [history, setHistory] = useState<Container | null>(null);
  const lang = i18n.language;
  const canAdjust = can('inventory.stock.adjust');
  const canUse = canAdjust || can('inventory.usage.record');

  const discard = async (c: Container) => {
    const r = await confirm({
      title: t('containers.discardTitle', { code: c.code }),
      body: t('containers.discardBody', { qty: fmtQty(c.remainingQuantity, c.unit) }),
      destructive: true,
      confirmLabel: t('containers.discard'),
      reason: { label: t('containers.discardReason'), required: true, max: 500 },
    });
    if (!r.confirmed) return;
    await action.mutateAsync({ id: c.id, action: 'discard', reason: r.reason ?? '' }).then(() => notify.success(t('containers.discarded')), notify.error);
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 3 }}>
        {t('containers.intro')}
      </Alert>
      <DataTable<Container>
        clientSide
        searchable
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        toolbar={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <TextField select size="small" label={t('containers.status')} value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="sealed,open">{t('containers.inUse')}</MenuItem>
              {(['sealed', 'open', 'empty', 'discarded'] as const).map((s) => (
                <MenuItem key={s} value={s}>
                  {t(`containerStatus.${s}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label={t('location')} value={locationId} onChange={(e) => setLocationId(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="">{t('allLocations')}</MenuItem>
              {(locations.data ?? []).map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
        }
        empty={<EmptyState title={t('containers.empty')} description={t('containers.emptyHint')} />}
        columns={[
          { field: 'code', headerName: t('containers.code'), width: 200, renderCell: ({ row }) => <span dir="ltr">{row.code}</span> },
          { field: 'itemName', headerName: t('item.name'), flex: 1, minWidth: 180 },
          { field: 'locationName', headerName: t('location'), width: 150 },
          {
            field: 'remainingQuantity',
            headerName: t('containers.remaining'),
            width: 170,
            renderCell: ({ row }) => (
              <Box sx={{ width: '100%' }}>
                <Typography variant="body2">{`${fmtQty(row.remainingQuantity)} / ${fmtQty(row.initialQuantity, row.unit)}`}</Typography>
                <LinearProgress variant="determinate" value={row.initialQuantity ? (row.remainingQuantity / row.initialQuantity) * 100 : 0} sx={{ height: 4, borderRadius: 2 }} />
              </Box>
            ),
          },
          { field: 'status', headerName: t('containers.status'), width: 120, renderCell: ({ row }) => <StatusChip status={CONTAINER_TONE[row.status]} label={t(`containerStatus.${row.status}`)} /> },
          { field: 'policy', headerName: t('item.policy'), width: 140, valueGetter: (_v, row) => t(`policies.${row.policy}`) },
          {
            field: 'beyondUseDate',
            headerName: t('containers.beyondUse'),
            width: 140,
            renderCell: ({ row }) => (row.beyondUseDate ? <Chip size="small" color={row.status === 'open' && !row.usable ? 'error' : 'default'} label={formatDate(row.beyondUseDate, lang)} /> : '—'),
          },
          {
            field: 'actions',
            headerName: '',
            width: 220,
            sortable: false,
            renderCell: ({ row }) => (
              <Stack direction="row" spacing={0.5}>
                {row.status === 'sealed' && canUse && (
                  <Button size="small" startIcon={<PackageOpen size={14} />} onClick={() => setOpening(row)}>
                    {t('containers.open')}
                  </Button>
                )}
                {['sealed', 'open'].includes(row.status) && canAdjust && !(row.policy === 'single_use' && row.status === 'open') && (
                  <Button size="small" startIcon={<MoveRight size={14} />} onClick={() => setMoving(row)}>
                    {t('containers.move')}
                  </Button>
                )}
                {['sealed', 'open'].includes(row.status) && canUse && (
                  <Button size="small" color="error" aria-label={t('containers.discard')} onClick={() => void discard(row)} sx={{ minWidth: 0 }}>
                    <Trash size={14} />
                  </Button>
                )}
                <Button size="small" aria-label={t('containers.history')} onClick={() => setHistory(row)} sx={{ minWidth: 0 }}>
                  <History size={14} />
                </Button>
              </Stack>
            ),
          },
        ]}
      />
      {opening && <OpenDialog container={opening} onClose={() => setOpening(null)} />}
      {moving && <MoveDialog container={moving} onClose={() => setMoving(null)} />}
      <HistoryDrawer container={history} onClose={() => setHistory(null)} />
    </Box>
  );
}

const openForm = z.object({ beyondUseDate: optional(dateOnly()) });
/** Multi-dose: the date is required (an empty field reads "required", not "invalid date"). */
const openMultiDoseForm = z.object({ beyondUseDate: z.preprocess((v) => (v === '' ? undefined : v), dateOnly()) });
type OpenValues = z.input<typeof openForm>;

/** Opening has no stock or cost effect; multi-dose containers need a beyond-use date. */
function OpenDialog({ container, onClose }: { container: Container; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const action = useContainerAction();
  const needsBud = container.policy === 'multi_dose';
  const form = useAppForm<OpenValues>({ schema: needsBud ? openMultiDoseForm : openForm, defaultValues: { beyondUseDate: '' } });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('containers.openTitle', { code: container.code })}</DialogTitle>
      <Form
        form={form}
        name="inventory.containerOpen"
        id="inv-open-form"
        onSubmit={async (v) => {
          await action.mutateAsync({ id: container.id, action: 'open', ...(v.beyondUseDate ? { beyondUseDate: v.beyondUseDate } : {}) });
          notify.success(t('containers.opened'));
          onClose();
        }}
      >
        <DialogContent>
          <Stack spacing={3}>
            {needsBud && <Alert severity="warning">{t('policyHints.multi_dose')}</Alert>}
            <RHFDate name="beyondUseDate" label={t('containers.beyondUse')} required={needsBud} minDate={undefined} maxDate={container.expiresAt} helperText={t('containers.beyondUseHint')} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
            {t('containers.open')}
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}

const moveForm = z.object({ toLocationId: objectId() });

function MoveDialog({ container, onClose }: { container: Container; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const notify = useNotify();
  const action = useContainerAction();
  const locations = locationsApi.useAll();
  const form = useAppForm<z.input<typeof moveForm>>({ schema: moveForm, defaultValues: { toLocationId: '' } });
  // Multi-dose containers stay in a preparation area (or quarantine).
  const allowed = (locations.data ?? []).filter((l) => l.id !== container.locationId && (container.policy !== 'multi_dose' || ['medication_prep', 'quarantine'].includes(l.type)));
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('containers.moveTitle', { code: container.code })}</DialogTitle>
      <Form
        form={form}
        name="inventory.containerMove"
        id="inv-move-form"
        onSubmit={async (v) => {
          await action.mutateAsync({ id: container.id, action: 'transfer', toLocationId: v.toLocationId });
          notify.success(t('containers.moved'));
          onClose();
        }}
      >
        <DialogContent>
          <RHFSelect name="toLocationId" label={t('transfer.to')} required options={allowed.map((l) => ({ value: l.id, label: l.name }))} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={form.formState.isSubmitting}>
            {t('containers.move')}
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}

function HistoryDrawer({ container, onClose }: { container: Container | null; onClose: () => void }) {
  const { t, i18n } = useTranslation('inventory');
  const events = useContainerEvents(container?.id);
  return (
    <Drawer anchor="right" open={Boolean(container)} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, p: 4 } }}>
      {container && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="h6">{container.itemName}</Typography>
            <Typography variant="body2" color="text.secondary" dir="ltr">
              {container.code} · {t('lot')} {container.lotNumber || '—'}
            </Typography>
          </Box>
          {events.isLoading ? (
            <PageSkeleton rows={4} />
          ) : events.error ? (
            <ErrorState error={events.error} onRetry={() => void events.refetch()} compact />
          ) : (
            <List dense disablePadding>
              {(events.data ?? []).map((e) => (
                <ListItem key={e.id} disableGutters divider alignItems="flex-start">
                  <ListItemText
                    primary={t(`containerEvents.${e.action}`)}
                    secondary={
                      <>
                        {formatDateTime(e.at, i18n.language)}
                        {e.usedQuantity ? ` · ${t('usage.used')} ${fmtQty(e.usedQuantity, container.unit)}` : ''}
                        {e.wastedQuantity ? ` · ${t('usage.wasted')} ${fmtQty(e.wastedQuantity, container.unit)}` : ''}
                        {e.autoWasteQuantity ? ` · ${t('usage.autoWaste')} ${fmtQty(e.autoWasteQuantity, container.unit)}` : ''}
                        {e.remainingQuantity !== undefined ? ` · ${t('containers.remaining')} ${fmtQty(e.remainingQuantity, container.unit)}` : ''}
                        {e.reason ? ` · ${e.reason}` : ''}
                      </>
                    }
                  />
                  {e.cost !== undefined && e.cost > 0 && <MoneyText value={e.cost} />}
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
