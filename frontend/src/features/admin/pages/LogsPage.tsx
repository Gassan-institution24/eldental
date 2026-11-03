import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/dates';
import { DataTable, useListParams, type Column } from '@/shared/components/DataTable';
import { DateInput } from '@/shared/components/DateInput';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  downloadLogsCsv,
  LOG_KINDS,
  LOG_PERMISSION,
  useLogItemUpdate,
  useLogs,
  useTimeline,
  type LogKind,
  type LogRow,
} from '../api';

const TYPES: Record<LogKind, string[]> = {
  audit: [
    'create',
    'update',
    'delete',
    'status_change',
    'login',
    'login_failed',
    'export',
    'permission_change',
    'ownership_transfer',
    'post',
    'reverse',
  ],
  activity: [
    'page_view',
    'action',
    'search',
    'download',
    'session_start',
    'session_end',
    'api_action',
  ],
  issues: [
    'js_error',
    'api_error',
    'validation_error',
    'slow_page',
    'permission_denied',
    'user_report',
  ],
  errors: ['http', 'job', 'socket', 'integration'],
  requests: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
};
const STATUSES: Partial<Record<LogKind, string[]>> = {
  issues: ['new', 'acknowledged', 'resolved', 'ignored'],
  errors: ['new', 'acknowledged', 'resolved'],
  requests: ['errors'],
};

function useColumns(kind: LogKind): Column<LogRow>[] {
  const { t, i18n } = useTranslation('admin');
  const at = (v: unknown) => (v ? formatDateTime(String(v), i18n.language) : '—');
  const text = (field: string, header: string, flex = 1, ltr = false): Column<LogRow> => ({
    field,
    headerName: header,
    flex,
    minWidth: 120,
    sortable: false,
    renderCell: ({ row }) => <span dir={ltr ? 'ltr' : 'auto'}>{String(row[field] ?? '')}</span>,
  });
  const time = (field: string): Column<LogRow> => ({
    field,
    headerName: t('logs.at'),
    width: 170,
    sortable: false,
    valueGetter: (_v, row) => at(row[field]),
  });
  const clinic = text('clinic', t('logs.clinic'));
  const status = (field = 'status'): Column<LogRow> => ({
    field,
    headerName: t('common.status'),
    width: 130,
    sortable: false,
    renderCell: ({ row }) => (
      <StatusChip
        status={String(row[field])}
        label={t(`logStatus.${String(row[field])}`, { defaultValue: String(row[field]) })}
      />
    ),
  });
  switch (kind) {
    case 'audit':
      return [
        time('at'),
        clinic,
        text('actorName', t('logs.user')),
        text('action', t('logs.action')),
        text('entity', t('logs.entity')),
        text('summary', t('logs.summary'), 1.5),
      ];
    case 'activity':
      return [
        time('at'),
        clinic,
        text('user', t('logs.user')),
        text('type', t('logs.type')),
        text('route', t('logs.route'), 1.5, true),
      ];
    case 'issues':
      return [
        time('lastAt'),
        clinic,
        text('kind', t('logs.type')),
        text('message', t('logs.message'), 2),
        { field: 'occurrences', headerName: '#', width: 70 },
        status(),
      ];
    case 'errors':
      return [
        time('lastAt'),
        text('source', t('logs.type')),
        { field: 'httpStatus', headerName: 'HTTP', width: 80 },
        text('message', t('logs.message'), 2),
        text('route', t('logs.route'), 1, true),
        { field: 'occurrences', headerName: '#', width: 70 },
        status(),
      ];
    default:
      return [
        time('at'),
        clinic,
        text('user', t('logs.user')),
        text('method', t('logs.method')),
        text('path', t('logs.route'), 1.6, true),
        { field: 'status', headerName: 'HTTP', width: 80 },
        { field: 'durationMs', headerName: 'ms', width: 80 },
      ];
  }
}

function TriageDrawer({
  kind,
  row,
  onClose,
}: {
  kind: 'issues' | 'errors';
  row: LogRow;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('admin');
  const notify = useNotify();
  const update = useLogItemUpdate(kind);
  const [status, setStatus] = useState(String(row.status ?? 'new'));
  const [notes, setNotes] = useState(String(row.notes ?? ''));
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('logs.triage')}
      subtitle={String(row.message ?? '')}
      formId="admin-triage"
      submitting={update.isPending}
      dirty={status !== row.status || notes !== String(row.notes ?? '')}
      width={620}
    >
      <form
        id="admin-triage"
        onSubmit={(e) => {
          e.preventDefault();
          void update
            .mutateAsync({ id: row.id, status, notes })
            .then(() => (notify.success(t('common.saved')), onClose()), notify.error);
        }}
      >
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {row.clinic && <Chip size="small" label={row.clinic} />}
            {row.route != null && (
              <Chip size="small" variant="outlined" label={String(row.route)} dir="ltr" />
            )}
            <Chip
              size="small"
              variant="outlined"
              label={`${t('logs.firstAt')}: ${formatDateTime(String(row.firstAt ?? row.lastAt), i18n.language)}`}
            />
            <Chip size="small" variant="outlined" label={`# ${String(row.occurrences ?? 1)}`} />
          </Stack>
          {row.stack != null && (
            <Box
              component="pre"
              dir="ltr"
              sx={{
                m: 0,
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 1,
                fontSize: 12,
                maxHeight: 260,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {String(row.stack)}
            </Box>
          )}
          <TextField
            select
            label={t('common.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {(STATUSES[kind] ?? []).map((s) => (
              <MenuItem key={s} value={s}>
                {t(`logStatus.${s}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('logs.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
            multiline
            minRows={3}
          />
        </Stack>
      </form>
    </FormDrawer>
  );
}

function LogTable({ kind }: { kind: LogKind }) {
  const { t } = useTranslation('admin');
  const notify = useNotify();
  const lp = useListParams({ limit: 50 });
  const filters = {
    type: lp.filter('type') || undefined,
    status: lp.filter('status') || undefined,
    from: lp.filter('from') || undefined,
    to: lp.filter('to') || undefined,
    clinicId: lp.filter('clinicId') || undefined,
    userId: lp.filter('userId') || undefined,
  };
  const list = useLogs(kind, { ...lp.params, ...filters });
  const columns = useColumns(kind);
  const [triage, setTriage] = useState<LogRow | null>(null);
  return (
    <>
      <DataTable<LogRow>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        searchable
        dense
        toolbar={
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField
              select
              size="small"
              label={t('logs.type')}
              value={lp.filter('type')}
              onChange={(e) => lp.set({ type: e.target.value || undefined, page: 1 })}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">{t('common.all')}</MenuItem>
              {TYPES[kind].map((x) => (
                <MenuItem key={x} value={x} dir="ltr">
                  {x}
                </MenuItem>
              ))}
            </TextField>
            {STATUSES[kind] && (
              <TextField
                select
                size="small"
                label={t('common.status')}
                value={lp.filter('status')}
                onChange={(e) => lp.set({ status: e.target.value || undefined, page: 1 })}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="">{t('common.all')}</MenuItem>
                {STATUSES[kind]!.map((x) => (
                  <MenuItem key={x} value={x}>
                    {t(`logStatus.${x}`)}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <DateInput
              label={t('logs.from')}
              value={lp.filter('from')}
              onChange={(v) => lp.set({ from: v || undefined, page: 1 })}
            />
            <DateInput
              label={t('logs.to')}
              value={lp.filter('to')}
              onChange={(v) => lp.set({ to: v || undefined, page: 1 })}
            />
            <Button
              startIcon={<Download size={16} />}
              onClick={() =>
                void downloadLogsCsv(kind, { q: lp.q || undefined, ...filters }).catch(notify.error)
              }
            >
              {t('logs.csv')}
            </Button>
          </Stack>
        }
        columns={columns}
        onRowClick={kind === 'issues' || kind === 'errors' ? (r) => setTriage(r) : undefined}
        empty={<EmptyState title={t('logs.empty')} />}
      />
      {triage && (kind === 'issues' || kind === 'errors') && (
        <TriageDrawer kind={kind} row={triage} onClose={() => setTriage(null)} />
      )}
    </>
  );
}

function Timeline() {
  const { t, i18n } = useTranslation('admin');
  const lp = useListParams();
  const [userId, setUserId] = useState(lp.filter('userId'));
  const params = {
    userId: lp.filter('userId') || undefined,
    sessionId: lp.filter('sessionId') || undefined,
    from: lp.filter('from') || undefined,
    to: lp.filter('to') || undefined,
  };
  const q = useTimeline(params);
  const color: Record<string, 'default' | 'info' | 'warning' | 'error'> = {
    activity: 'default',
    audit: 'info',
    issue: 'warning',
    request: 'error',
  };
  return (
    <SectionCard
      title={t('logs.timeline')}
      subtitle={t('logs.timelineHint')}
      actions={
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            label={t('logs.userId')}
            value={userId}
            onChange={(e) => setUserId(e.target.value.trim())}
            onBlur={() => lp.set({ userId: /^[a-f0-9]{24}$/i.test(userId) ? userId : undefined })}
            inputProps={{ dir: 'ltr' }}
            sx={{ minWidth: 240 }}
          />
          <DateInput
            label={t('logs.from')}
            value={lp.filter('from')}
            onChange={(v) => lp.set({ from: v || undefined })}
          />
          <DateInput
            label={t('logs.to')}
            value={lp.filter('to')}
            onChange={(v) => lp.set({ to: v || undefined })}
          />
        </Stack>
      }
    >
      {!params.userId && !params.sessionId ? (
        <EmptyState compact title={t('logs.timelinePick')} />
      ) : q.isLoading ? (
        <PageSkeleton rows={4} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data?.events.length ? (
        <EmptyState compact title={t('logs.empty')} />
      ) : (
        <Stack spacing={1}>
          {q.data.events.map((e, i) => (
            <Stack
              key={i}
              direction="row"
              spacing={2}
              alignItems="center"
              sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider' }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 150 }}>
                {formatDateTime(e.at, i18n.language)}
              </Typography>
              <Chip
                size="small"
                color={color[e.kind]}
                label={t(`logs.eventKinds.${e.kind}`)}
                sx={{ minWidth: 80 }}
              />
              <Typography variant="caption" dir="ltr" sx={{ minWidth: 110 }}>
                {e.type}
              </Typography>
              <Typography
                variant="body2"
                dir="auto"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {e.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </SectionCard>
  );
}

/** Platform logs (15 §6): one tab per log the user may read, plus the user timeline. */
export function LogsPage() {
  const { t } = useTranslation('admin');
  const { can } = usePermission();
  const lp = useListParams();
  const kinds = LOG_KINDS.filter((k) => can(LOG_PERMISSION[k]));
  const tabs = [...kinds, ...(can('platform.logs.activity.read') ? (['timeline'] as const) : [])];
  const tab = (tabs as string[]).includes(lp.filter('tab')) ? lp.filter('tab') : (tabs[0] ?? '');
  return (
    <Box>
      <PageHeader title={t('logs.title')} subtitle={t('logs.subtitle')} />
      <Tabs
        value={tab}
        onChange={(_e, v: string) =>
          lp.set({ tab: v, page: 1, q: undefined, type: undefined, status: undefined })
        }
        variant="scrollable"
        sx={{ mb: 3 }}
      >
        {tabs.map((k) => (
          <Tab key={k} value={k} label={t(`logs.kinds.${k}`)} />
        ))}
      </Tabs>
      {tab === 'timeline' ? (
        <Timeline />
      ) : tab ? (
        <LogTable key={tab} kind={tab as LogKind} />
      ) : (
        <EmptyState title={t('logs.empty')} />
      )}
    </Box>
  );
}
