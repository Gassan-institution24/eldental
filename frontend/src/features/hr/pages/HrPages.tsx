import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { CalendarOff, Clock, LogIn, LogOut, Plus, Printer, QrCode, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAccountLookup } from '@/features/accounting/api';
import { PrintArea } from '@/features/clinical/components/shared';
import { staffApi } from '@/features/staff/api';
import { postData } from '@/lib/api/axios';
import { formatDate, formatTime, todayLocal } from '@/lib/dates';
import {
  dateOnly,
  entityName,
  freeText,
  optional,
  timeOfDay,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { DataTable, type Column } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency, useFormatMoney } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { MoneyInput } from '@/shared/form/MoneyInput';
import { RHFCheckbox, RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  leaveTypesApi,
  shiftsApi,
  useAcknowledgePayslip,
  useAttendance,
  useAttendanceMutations,
  useAttendanceQr,
  useLeaveBalances,
  useLeaveMutations,
  useLeaveRequests,
  useMyPayslips,
  useMyToday,
  usePayrollMutations,
  usePayrollRun,
  usePayrollRuns,
  usePayslip,
  type AttendanceRow,
  type LeaveRequest,
  type Payslip,
  type Shift,
} from '../api';

const mins = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
const useStaffOptions = (enabled = true) => {
  const list = staffApi.useList({ limit: 100, status: 'active' }, { enabled });
  return useMemo(
    () => (list.data?.data ?? []).map((s) => ({ value: s.id, label: s.name })),
    [list.data],
  );
};

/* ---------------- attendance ---------------- */

/** Check-in/out card for the signed-in staff member (also on the dashboard). */
export function AttendanceWidget() {
  const { t, i18n } = useTranslation('hr');
  const notify = useNotify();
  const { can } = usePermission();
  const q = useMyToday(can('hr.attendance.checkin'));
  const muts = useAttendanceMutations();
  if (!can('hr.attendance.checkin') || !q.data) return null;
  const a = q.data.attendance;
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => (notify.success(msg), void q.refetch()), notify.error);
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={3}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={2} alignItems="center">
            <Clock size={22} />
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {t('attendance.today')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {q.data.expected
                  ? t('attendance.shift', {
                      start: q.data.expected.start,
                      end: q.data.expected.end,
                    })
                  : t('attendance.noShift')}
                {a?.checkIn
                  ? ` · ${t('attendance.in', { time: formatTime(a.checkIn.at, i18n.language) })}`
                  : ''}
                {a?.checkOut
                  ? ` · ${t('attendance.out', { time: formatTime(a.checkOut.at, i18n.language) })}`
                  : ''}
                {a?.lateMinutes ? ` · ${t('attendance.late', { count: a.lateMinutes })}` : ''}
              </Typography>
            </Box>
          </Stack>
          {!a?.checkIn ? (
            <Button
              variant="contained"
              startIcon={<LogIn size={16} />}
              onClick={() => run(muts.checkIn.mutateAsync(), t('attendance.checkedIn'))}
              disabled={muts.checkIn.isPending}
            >
              {t('attendance.checkIn')}
            </Button>
          ) : !a.checkOut ? (
            <Button
              variant="outlined"
              startIcon={<LogOut size={16} />}
              onClick={() => run(muts.checkOut.mutateAsync(), t('attendance.checkedOut'))}
              disabled={muts.checkOut.isPending}
            >
              {t('attendance.checkOut')}
            </Button>
          ) : (
            <Chip color="success" label={t('attendance.done', { worked: mins(a.workedMinutes) })} />
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export function AttendancePage() {
  const { t, i18n } = useTranslation('hr');
  const notify = useNotify();
  const { can, grant, session } = usePermission();
  const [sp, setSp] = useSearchParams();
  const all = session?.isOwner || grant('hr.attendance.read')?.scope === 'all';
  const staffOptions = useStaffOptions(Boolean(all));
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [staffId, setStaffId] = useState('');
  const range = monthRange(month);
  const list = useAttendance({ ...range, ...(staffId ? { staffId } : {}) });
  const [adjusting, setAdjusting] = useState<Partial<AttendanceRow> | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const names = useMemo(() => new Map(staffOptions.map((o) => [o.value, o.label])), [staffOptions]);
  // Scanned the reception QR: check in (or out) right away.
  const scanned = sp.get('qr');
  const handled = useRef(false);
  useEffect(() => {
    if (!scanned || handled.current) return;
    handled.current = true;
    void postData('/attendance/qr', { token: scanned, kind: 'in' })
      .catch(() => postData('/attendance/qr', { token: scanned, kind: 'out' }))
      .then(() => notify.success(t('attendance.qrDone')), notify.error)
      .finally(() => setSp({}, { replace: true }));
  }, [scanned, notify, t, setSp]);
  const totals = useMemo(() => {
    const rows = list.data ?? [];
    return {
      present: rows.filter((r) => r.status === 'present').length,
      absent: rows.filter((r) => r.status === 'absent').length,
      late: rows.reduce((s, r) => s + r.lateMinutes, 0),
      overtime: rows.reduce((s, r) => s + (r.overtimeApproved ? r.overtimeMinutes : 0), 0),
    };
  }, [list.data]);
  const columns: Column<AttendanceRow>[] = [
    {
      field: 'date',
      headerName: t('attendance.date'),
      width: 130,
      valueGetter: (_v, r) => formatDate(r.date, i18n.language, 'ddd ll'),
    },
    ...(all
      ? [
          {
            field: 'staffId',
            headerName: t('attendance.staff'),
            flex: 1,
            minWidth: 160,
            valueGetter: (_v: unknown, r: AttendanceRow) => names.get(r.staffId) ?? '',
          } as Column<AttendanceRow>,
        ]
      : []),
    {
      field: 'checkIn',
      headerName: t('attendance.inCol'),
      width: 100,
      valueGetter: (_v, r) => (r.checkIn ? formatTime(r.checkIn.at, 'en') : '—'),
    },
    {
      field: 'checkOut',
      headerName: t('attendance.outCol'),
      width: 100,
      valueGetter: (_v, r) => (r.checkOut ? formatTime(r.checkOut.at, 'en') : '—'),
    },
    {
      field: 'workedMinutes',
      headerName: t('attendance.worked'),
      width: 100,
      valueGetter: (_v, r) => mins(r.workedMinutes),
    },
    { field: 'lateMinutes', headerName: t('attendance.lateCol'), width: 90 },
    {
      field: 'overtimeMinutes',
      headerName: t('attendance.overtime'),
      width: 110,
      valueGetter: (_v, r) =>
        r.overtimeMinutes ? `${mins(r.overtimeMinutes)}${r.overtimeApproved ? '' : ' ?'}` : '—',
    },
    {
      field: 'status',
      headerName: t('attendance.status'),
      width: 130,
      renderCell: ({ row }) => (
        <StatusChip status={row.status} label={t(`attendance.statuses.${row.status}`)} />
      ),
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('attendance.title')}
        subtitle={t('attendance.subtitle')}
        actions={
          can('hr.attendance.adjust') && (
            <Stack direction="row" spacing={1}>
              <Button startIcon={<QrCode size={16} />} onClick={() => setQrOpen(true)}>
                {t('attendance.showQr')}
              </Button>
              <Button
                variant="contained"
                startIcon={<Plus size={16} />}
                onClick={() => setAdjusting({ date: todayLocal() })}
              >
                {t('attendance.adjust')}
              </Button>
            </Stack>
          )
        }
      />
      <Stack spacing={4}>
        <AttendanceWidget />
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <TextField
            type="month"
            size="small"
            label={t('attendance.month')}
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ dir: 'ltr' }}
          />
          {all && (
            <TextField
              select
              size="small"
              label={t('attendance.staff')}
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">{t('attendance.everyone')}</MenuItem>
              {staffOptions.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Chip label={t('attendance.presentDays', { count: totals.present })} />
          <Chip
            color={totals.absent ? 'error' : 'default'}
            label={t('attendance.absentDays', { count: totals.absent })}
          />
          <Chip label={t('attendance.lateTotal', { time: mins(totals.late) })} />
          <Chip label={t('attendance.overtimeTotal', { time: mins(totals.overtime) })} />
        </Stack>
        <DataTable<AttendanceRow>
          clientSide
          rows={list.data ?? []}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          columns={columns}
          onRowClick={(r) => can('hr.attendance.adjust') && !r.locked && setAdjusting(r)}
          empty={<EmptyState compact title={t('attendance.empty')} />}
        />
      </Stack>
      {adjusting && (
        <AdjustDialog
          row={adjusting}
          staffOptions={staffOptions}
          onClose={() => setAdjusting(null)}
        />
      )}
      {qrOpen && <QrDialog onClose={() => setQrOpen(false)} />}
    </Box>
  );
}

function QrDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('hr');
  const q = useAttendanceQr(true);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('attendance.qrTitle')}</DialogTitle>
      <DialogContent sx={{ textAlign: 'center' }}>
        {q.data ? (
          <img
            src={(q.data as { image?: string }).image}
            alt={t('attendance.qrTitle')}
            style={{ width: 280, height: 280 }}
          />
        ) : (
          <PageSkeleton rows={3} />
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('attendance.qrHint')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

const adjustSchema = z.object({
  staffId: z.string().min(1, { message: 'required' }),
  date: dateOnly(),
  checkIn: optional(timeOfDay()),
  checkOut: optional(timeOfDay()),
  status: z.enum(['present', 'absent', 'on_leave', 'holiday', 'weekend']),
  overtimeApproved: z.boolean(),
  reason: freeText(300).refine((v) => Boolean(v), { message: 'required' }),
});
type AdjustValues = z.input<typeof adjustSchema>;

function AdjustDialog({
  row,
  staffOptions,
  onClose,
}: {
  row: Partial<AttendanceRow>;
  staffOptions: { value: string; label: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslation('hr');
  const notify = useNotify();
  const muts = useAttendanceMutations();
  const form = useAppForm<AdjustValues>({
    schema: adjustSchema,
    defaultValues: {
      staffId: row.staffId ?? '',
      date: row.date ?? todayLocal(),
      checkIn: row.checkIn ? formatTime(row.checkIn.at, 'en') : '',
      checkOut: row.checkOut ? formatTime(row.checkOut.at, 'en') : '',
      status: row.status ?? 'present',
      overtimeApproved: row.overtimeApproved ?? false,
      reason: '',
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('attendance.adjustTitle')}
      formId="adjust-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="hr.attendanceAdjust"
        id="adjust-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof adjustSchema>;
          await muts.adjust.mutateAsync({
            staffId: v.staffId,
            date: v.date,
            checkIn: v.checkIn || null,
            checkOut: v.checkOut || null,
            status: v.status,
            overtimeApproved: v.overtimeApproved,
            reason: v.reason,
          });
          notify.success(t('attendance.adjusted'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFSelect
            name="staffId"
            label={t('attendance.staff')}
            required
            options={staffOptions}
            disabled={Boolean(row.staffId)}
          />
          <RHFDate name="date" label={t('attendance.date')} required disableFuture />
          <Grid container spacing={2}>
            <Grid item xs={6}>
              <RHFTextField
                name="checkIn"
                label={t('attendance.inCol')}
                inputProps={{ dir: 'ltr' }}
                placeholder="09:00"
              />
            </Grid>
            <Grid item xs={6}>
              <RHFTextField
                name="checkOut"
                label={t('attendance.outCol')}
                inputProps={{ dir: 'ltr' }}
                placeholder="17:00"
              />
            </Grid>
          </Grid>
          <RHFSelect
            name="status"
            label={t('attendance.status')}
            options={(['present', 'absent', 'on_leave', 'holiday', 'weekend'] as const).map(
              (s) => ({ value: s, label: t(`attendance.statuses.${s}`) }),
            )}
          />
          <RHFCheckbox name="overtimeApproved" label={t('attendance.approveOvertime')} />
          <RHFTextField name="reason" label={t('attendance.reason')} required maxLength={300} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- leave ---------------- */

export function LeavePage() {
  const { t, i18n } = useTranslation('hr');
  const notify = useNotify();
  const confirm = useConfirm();
  const { can, session } = usePermission();
  const seedName = useSeedName('leaveType');
  const types = leaveTypesApi.useAll();
  const typeName = (id: string) => seedName((types.data ?? []).find((x) => x.id === id));
  const approver = can('hr.leave.approve');
  const [tab, setTab] = useState<'mine' | 'approvals' | 'all' | 'types'>(
    approver ? 'approvals' : 'mine',
  );
  const balances = useLeaveBalances();
  const reqs = useLeaveRequests(
    tab === 'approvals'
      ? { status: 'pending' }
      : tab === 'mine'
        ? { staffId: session?.staff?.id }
        : {},
  );
  const muts = useLeaveMutations();
  const [requesting, setRequesting] = useState(false);
  const rows = (reqs.data ?? []).filter((r) => tab !== 'mine' || r.staffId === session?.staff?.id);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const approve = async (r: LeaveRequest) => {
    try {
      await muts.approve.mutateAsync({ id: r.id });
      notify.success(t('leave.approved'));
    } catch (err) {
      const e = err as { code?: string; details?: { appointments?: { number: string }[] } };
      if (e.code === 'LEAVE_OVERLAP' && e.details?.appointments?.length) {
        const ok = await confirm({
          title: t('leave.conflictsTitle'),
          body: t('leave.conflictsBody', {
            list: e.details.appointments.map((a) => a.number).join(', '),
          }),
        });
        if (ok.confirmed)
          run(muts.approve.mutateAsync({ id: r.id, confirmConflicts: true }), t('leave.approved'));
      } else notify.error(err);
    }
  };
  const columns: Column<LeaveRequest>[] = [
    ...(tab !== 'mine'
      ? [
          {
            field: 'staffName',
            headerName: t('leave.staff'),
            flex: 1,
            minWidth: 160,
          } as Column<LeaveRequest>,
        ]
      : []),
    {
      field: 'leaveTypeId',
      headerName: t('leave.type'),
      width: 140,
      valueGetter: (_v, r) => typeName(r.leaveTypeId),
    },
    {
      field: 'startDate',
      headerName: t('leave.dates'),
      flex: 1,
      minWidth: 200,
      valueGetter: (_v, r) =>
        `${formatDate(r.startDate, i18n.language, 'll')} – ${formatDate(r.endDate, i18n.language, 'll')}`,
    },
    { field: 'days', headerName: t('leave.days'), width: 80 },
    {
      field: 'status',
      headerName: t('leave.status'),
      width: 130,
      renderCell: ({ row }) => <StatusChip status={row.status} />,
    },
    {
      field: 'actions',
      headerName: '',
      width: 220,
      sortable: false,
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={1}>
          {row.status === 'pending' && approver && row.staffId !== session?.staff?.id && (
            <>
              <Button size="small" variant="contained" onClick={() => void approve(row)}>
                {t('leave.approve')}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={async () => {
                  const r = await confirm({
                    title: t('leave.rejectTitle'),
                    reason: { label: t('leave.comment'), max: 300 },
                  });
                  if (r.confirmed)
                    run(
                      muts.reject.mutateAsync({
                        id: row.id,
                        ...(r.reason ? { comment: r.reason } : {}),
                      }),
                      t('leave.rejected'),
                    );
                }}
              >
                {t('leave.reject')}
              </Button>
            </>
          )}
          {['pending', 'approved'].includes(row.status) &&
            (row.staffId === session?.staff?.id || approver) && (
              <Button
                size="small"
                onClick={() => run(muts.cancel.mutateAsync(row.id), t('leave.cancelled'))}
              >
                {t('leave.cancel')}
              </Button>
            )}
        </Stack>
      ),
    },
  ];
  return (
    <Box>
      <PageHeader
        title={t('leave.title')}
        subtitle={t('leave.subtitle')}
        primary={
          can('hr.leave.request') && (
            <Button
              variant="contained"
              startIcon={<CalendarOff size={18} />}
              onClick={() => setRequesting(true)}
            >
              {t('leave.request')}
            </Button>
          )
        }
      />
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {(balances.data ?? [])
          .filter((b) => b.paid)
          .map((b) => (
            <Grid item xs={6} md={3} key={b.leaveTypeId}>
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="caption" color="text.secondary">
                    {seedName({ name: b.name, systemKey: b.systemKey ?? b.code })}
                  </Typography>
                  <Typography variant="h4">{b.remaining}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('leave.balanceLine', {
                      entitled: b.entitled + b.carriedOver,
                      taken: b.taken,
                      pending: b.pending,
                    })}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
      </Grid>
      <Tabs value={tab} onChange={(_e, v: typeof tab) => setTab(v)} sx={{ mb: 3 }}>
        {approver && <Tab value="approvals" label={t('leave.tabs.approvals')} />}
        <Tab value="mine" label={t('leave.tabs.mine')} />
        {approver && <Tab value="all" label={t('leave.tabs.all')} />}
        {can('hr.leaveType.manage') && <Tab value="types" label={t('leave.tabs.types')} />}
      </Tabs>
      {tab === 'types' ? (
        <LeaveTypesTable />
      ) : (
        <DataTable<LeaveRequest>
          clientSide
          rows={rows}
          loading={reqs.isLoading}
          error={reqs.error}
          onRetry={() => void reqs.refetch()}
          columns={columns}
          empty={<EmptyState compact title={t('leave.empty')} />}
        />
      )}
      {requesting && <LeaveDialog onClose={() => setRequesting(false)} />}
    </Box>
  );
}

const leaveSchema = z
  .object({
    leaveTypeId: z.string().min(1, { message: 'required' }),
    startDate: dateOnly(),
    endDate: dateOnly(),
    halfDay: z.boolean(),
    reason: optional(freeText(500)),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'end_before_start' });
  });
type LeaveValues = z.input<typeof leaveSchema>;

function LeaveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('hr');
  const notify = useNotify();
  const seedName = useSeedName('leaveType');
  const types = leaveTypesApi.useAll();
  const muts = useLeaveMutations();
  const form = useAppForm<LeaveValues>({
    schema: leaveSchema,
    defaultValues: {
      leaveTypeId: '',
      startDate: todayLocal(),
      endDate: todayLocal(),
      halfDay: false,
      reason: '',
    },
  });
  const [start, end] = useWatch({ control: form.control, name: ['startDate', 'endDate'] });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('leave.request')}
      subtitle={t('leave.requestHint')}
      formId="leave-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="hr.leaveRequest"
        id="leave-form"
        onSubmit={async (v) => {
          const r = await muts.request.mutateAsync({
            ...v,
            ...(v.reason ? {} : { reason: undefined }),
          });
          notify.success(t('leave.requested', { count: r.days }));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFSelect
            name="leaveTypeId"
            label={t('leave.type')}
            required
            options={(types.data ?? [])
              .filter((x) => x.isActive)
              .map((x) => ({ value: x.id, label: seedName(x) }))}
          />
          <RHFDate name="startDate" label={t('leave.from')} required />
          <RHFDate name="endDate" label={t('leave.to')} required minDate={String(start ?? '')} />
          {start === end && <RHFCheckbox name="halfDay" label={t('leave.halfDay')} />}
          <RHFTextField
            name="reason"
            label={t('leave.reason')}
            multiline
            minRows={2}
            maxLength={500}
          />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

function LeaveTypesTable() {
  const { t } = useTranslation('hr');
  const seedName = useSeedName('leaveType');
  const list = leaveTypesApi.useAll({ includeInactive: 'true' });
  return (
    <DataTable
      clientSide
      rows={list.data ?? []}
      loading={list.isLoading}
      error={list.error}
      columns={[
        {
          field: 'name',
          headerName: t('leave.type'),
          flex: 1,
          minWidth: 160,
          valueGetter: (_v, r) => seedName(r),
        },
        {
          field: 'paid',
          headerName: t('leave.paid'),
          width: 100,
          valueGetter: (_v, r) => (r.paid ? t('leave.yes') : t('leave.no')),
        },
        { field: 'annualEntitlementDays', headerName: t('leave.entitlement'), width: 140 },
        {
          field: 'accrual',
          headerName: t('leave.accrual'),
          width: 130,
          valueGetter: (_v, r) => t(`leave.accruals.${r.accrual}`),
        },
        { field: 'carryOverMaxDays', headerName: t('leave.carryOver'), width: 130 },
      ]}
    />
  );
}

/* ---------------- shifts ---------------- */

const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];
const shiftSchema = z.object({
  name: entityName({ max: 60 }),
  graceMinutes: z.coerce
    .number()
    .int()
    .min(0, { message: 'too_small' })
    .max(120, { message: 'too_big' }),
  isDefault: z.boolean(),
  weekly: z
    .array(
      z.object({
        weekday: z.coerce.number(),
        start: timeOfDay(),
        end: timeOfDay(),
        breakMinutes: z.coerce.number().int().min(0).max(240),
      }),
    )
    .max(7),
});
type ShiftValues = z.input<typeof shiftSchema>;

export function ShiftsPage() {
  const { t } = useTranslation('hr');
  const list = shiftsApi.useAll();
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);
  return (
    <Box>
      <PageHeader
        title={t('shifts.title')}
        subtitle={t('shifts.subtitle')}
        primary={
          <Button
            variant="contained"
            startIcon={<Plus size={18} />}
            onClick={() => setEditing('new')}
          >
            {t('shifts.add')}
          </Button>
        }
      />
      <DataTable<Shift>
        clientSide
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState title={t('shifts.empty')} />}
        columns={[
          { field: 'name', headerName: t('shifts.name'), flex: 1, minWidth: 160 },
          {
            field: 'weekly',
            headerName: t('shifts.days'),
            flex: 2,
            minWidth: 260,
            sortable: false,
            valueGetter: (_v, r) =>
              r.weekly.map((w) => `${t(`weekdays.${w.weekday}`)} ${w.start}–${w.end}`).join(' · '),
          },
          { field: 'graceMinutes', headerName: t('shifts.grace'), width: 120 },
          {
            field: 'isDefault',
            headerName: '',
            width: 120,
            renderCell: ({ row }) =>
              row.isDefault ? <Chip size="small" label={t('shifts.default')} /> : null,
          },
        ]}
      />
      {editing && (
        <ShiftDrawer shift={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </Box>
  );
}

function ShiftDrawer({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const { t } = useTranslation('hr');
  const notify = useNotify();
  const create = shiftsApi.useCreate();
  const update = shiftsApi.useUpdate();
  const staffOptions = useStaffOptions();
  const [assign, setAssign] = useState<string[]>([]);
  const form = useAppForm<ShiftValues>({
    schema: shiftSchema,
    defaultValues: {
      name: shift?.name ?? '',
      graceMinutes: shift?.graceMinutes ?? 10,
      isDefault: shift?.isDefault ?? false,
      weekly:
        shift?.weekly.map((w) => ({ ...w, weekday: String(w.weekday) as unknown as number })) ??
        WEEKDAYS.filter((d) => d !== 5).map((weekday) => ({
          weekday: String(weekday) as unknown as number,
          start: '09:00',
          end: '17:00',
          breakMinutes: 30,
        })),
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'weekly' });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={shift ? t('shifts.edit') : t('shifts.add')}
      formId="shift-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form
        form={form}
        name="hr.shift"
        id="shift-form"
        onSubmit={async (raw) => {
          const v = raw as z.output<typeof shiftSchema>;
          const saved = shift
            ? await update.mutateAsync({
                id: shift.id,
                version: shift.version,
                ...(v as Partial<Shift>),
              })
            : await create.mutateAsync(v as Partial<Shift>);
          if (assign.length) await postData(`/shifts/${saved.id}/assign`, { staffIds: assign });
          notify.success(t('shifts.saved'));
          onClose();
        }}
      >
        <Stack spacing={3}>
          <RHFTextField name="name" label={t('shifts.name')} required maxLength={60} />
          <RHFTextField
            name="graceMinutes"
            label={t('shifts.grace')}
            type="number"
            inputProps={{ dir: 'ltr' }}
          />
          <RHFCheckbox name="isDefault" label={t('shifts.makeDefault')} />
          <Divider />
          {fields.map((f, i) => (
            <Grid container spacing={2} key={f.id} alignItems="center">
              <Grid item xs={12} sm={3.5}>
                <RHFSelect
                  name={`weekly.${i}.weekday`}
                  label={t('shifts.day')}
                  options={WEEKDAYS.map((d) => ({ value: String(d), label: t(`weekdays.${d}`) }))}
                />
              </Grid>
              <Grid item xs={4} sm={2.5}>
                <RHFTextField
                  name={`weekly.${i}.start`}
                  label={t('shifts.start')}
                  size="small"
                  inputProps={{ dir: 'ltr' }}
                />
              </Grid>
              <Grid item xs={4} sm={2.5}>
                <RHFTextField
                  name={`weekly.${i}.end`}
                  label={t('shifts.end')}
                  size="small"
                  inputProps={{ dir: 'ltr' }}
                />
              </Grid>
              <Grid item xs={3} sm={2.5}>
                <RHFTextField
                  name={`weekly.${i}.breakMinutes`}
                  label={t('shifts.break')}
                  size="small"
                  type="number"
                  inputProps={{ dir: 'ltr' }}
                />
              </Grid>
              <Grid item xs={1}>
                <IconButton aria-label={t('shifts.removeDay')} onClick={() => remove(i)}>
                  <Trash2 size={16} />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          <Button
            startIcon={<Plus size={16} />}
            onClick={() =>
              append({
                weekday: '0' as unknown as number,
                start: '09:00',
                end: '17:00',
                breakMinutes: 30,
              })
            }
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('shifts.addDay')}
          </Button>
          <Divider />
          <TextField
            select
            SelectProps={{ multiple: true }}
            label={t('shifts.assign')}
            value={assign}
            onChange={(e) => setAssign(e.target.value as unknown as string[])}
          >
            {staffOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- payroll ---------------- */

export function PayrollPage() {
  const { t, i18n } = useTranslation('hr');
  const notify = useNotify();
  const navigate = useNavigate();
  const runs = usePayrollRuns();
  const muts = usePayrollMutations();
  const now = new Date();
  const [ym, setYm] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  return (
    <Box>
      <PageHeader title={t('payroll.title')} subtitle={t('payroll.subtitle')} />
      <Stack direction="row" spacing={2} sx={{ mb: 4 }}>
        <TextField
          type="month"
          size="small"
          label={t('payroll.month')}
          value={ym}
          onChange={(e) => e.target.value && setYm(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{ dir: 'ltr' }}
        />
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          disabled={muts.create.isPending}
          onClick={() => {
            const [y, m] = ym.split('-').map(Number) as [number, number];
            void muts.create
              .mutateAsync({ year: y, month: m })
              .then(
                (r) =>
                  muts.calculate
                    .mutateAsync(r.id)
                    .then(() => navigate(`/clinic/hr/payroll/${r.id}`)),
                notify.error,
              );
          }}
        >
          {t('payroll.new')}
        </Button>
      </Stack>
      {runs.isLoading ? (
        <PageSkeleton rows={4} />
      ) : (runs.data ?? []).length === 0 ? (
        <EmptyState title={t('payroll.empty')} />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('payroll.period')}</TableCell>
              <TableCell align="right">{t('payroll.gross')}</TableCell>
              <TableCell align="right">{t('payroll.net')}</TableCell>
              <TableCell>{t('payroll.status')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(runs.data ?? []).map((r) => (
              <TableRow
                key={r.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => navigate(`/clinic/hr/payroll/${r.id}`)}
              >
                <TableCell>
                  {formatDate(
                    `${r.year}-${String(r.month).padStart(2, '0')}-01`,
                    i18n.language,
                    'MMMM YYYY',
                  )}
                </TableCell>
                <TableCell align="right">
                  <MoneyText value={r.totals.gross} />
                </TableCell>
                <TableCell align="right">
                  <MoneyText value={r.totals.net} />
                </TableCell>
                <TableCell>
                  <StatusChip status={r.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
}

export function PayrollRunPage() {
  const { t, i18n } = useTranslation('hr');
  const { id } = useParams();
  const notify = useNotify();
  const confirm = useConfirm();
  const currency = useCurrency();
  const { can } = usePermission();
  const q = usePayrollRun(id);
  const muts = usePayrollMutations();
  const accounts = useAccountLookup(can('hr.payroll.approve'));
  const [line, setLine] = useState<{
    staffId: string;
    kind: 'earning' | 'deduction';
    name: string;
    amount: number;
    reason: string;
  } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [payFrom, setPayFrom] = useState('');
  if (q.isLoading) return <PageSkeleton rows={8} />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const editable = ['draft', 'calculated'].includes(r.status);
  const run = (p: Promise<unknown>, msg: string) =>
    void p.then(() => notify.success(msg), notify.error);
  const sources = accounts.postable.filter((a) => ['cash', 'bank'].includes(a.subtype));
  return (
    <Box>
      <PageHeader
        title={t('payroll.runTitle', {
          period: formatDate(
            `${r.year}-${String(r.month).padStart(2, '0')}-01`,
            i18n.language,
            'MMMM YYYY',
          ),
        })}
        breadcrumbs={[
          { label: t('payroll.title'), to: '/clinic/hr/payroll' },
          { label: `${r.year}-${r.month}` },
        ]}
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <StatusChip status={r.status} />
            {editable && (
              <Button
                onClick={() => run(muts.calculate.mutateAsync(r.id), t('payroll.calculated'))}
                disabled={muts.calculate.isPending}
              >
                {t('payroll.recalculate')}
              </Button>
            )}
            {r.status === 'calculated' && can('hr.payroll.approve') && (
              <Button
                variant="contained"
                onClick={async () => {
                  const c = await confirm({
                    title: t('payroll.approveTitle'),
                    body: t('payroll.approveBody'),
                  });
                  if (c.confirmed) run(muts.approve.mutateAsync(r.id), t('payroll.approved'));
                }}
              >
                {t('payroll.approve')}
              </Button>
            )}
            {editable && (
              <Button
                color="error"
                onClick={() => run(muts.cancel.mutateAsync(r.id), t('payroll.cancelled'))}
              >
                {t('payroll.cancel')}
              </Button>
            )}
          </Stack>
        }
      />
      <Grid container spacing={3} sx={{ mb: 4 }}>
        {(['gross', 'deductions', 'employerContributions', 'net'] as const).map((k) => (
          <Grid item xs={6} md={3} key={k}>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="caption" color="text.secondary">
                  {t(`payroll.totals.${k}`)}
                </Typography>
                <Typography variant="h5">
                  <MoneyText value={r.totals[k]} />
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      {r.status === 'approved' && can('hr.payroll.approve') && (
        <Alert
          severity="info"
          sx={{ mb: 4 }}
          action={
            <Stack direction="row" spacing={1}>
              <TextField
                select
                size="small"
                value={payFrom}
                onChange={(e) => setPayFrom(e.target.value)}
                label={t('payroll.payFrom')}
                sx={{ minWidth: 220 }}
              >
                {sources.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {accounts.label(a)}
                  </MenuItem>
                ))}
              </TextField>
              <Button
                variant="contained"
                disabled={!payFrom}
                onClick={() =>
                  run(
                    muts.pay.mutateAsync({ id: r.id, paidFromAccountId: payFrom }),
                    t('payroll.paid'),
                  )
                }
              >
                {t('payroll.markPaid')}
              </Button>
            </Stack>
          }
        >
          {t('payroll.readyToPay')}
        </Alert>
      )}
      <Card variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('payroll.staff')}</TableCell>
              <TableCell align="right">{t('payroll.basic')}</TableCell>
              <TableCell align="right">{t('payroll.additions')}</TableCell>
              <TableCell align="right">{t('payroll.absence')}</TableCell>
              <TableCell align="right">{t('payroll.ssc')}</TableCell>
              <TableCell align="right">{t('payroll.gross')}</TableCell>
              <TableCell align="right">{t('payroll.net')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(r.payslips ?? []).map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>{p.staffName}</TableCell>
                <TableCell align="right">
                  {p.basic !== undefined ? <MoneyText value={p.basic} /> : '•••'}
                </TableCell>
                <TableCell align="right">
                  {p.overtime ? (
                    <MoneyText
                      value={
                        (p.overtime?.amount ?? 0) +
                        (p.commission?.amount ?? 0) +
                        (p.earnings ?? []).reduce((s, e) => s + e.amount, 0)
                      }
                    />
                  ) : (
                    '•••'
                  )}
                </TableCell>
                <TableCell align="right">
                  {p.absenceDeduction !== undefined ? (
                    <MoneyText value={(p.absenceDeduction ?? 0) + (p.unpaidLeaveDeduction ?? 0)} />
                  ) : (
                    '•••'
                  )}
                </TableCell>
                <TableCell align="right">
                  {p.socialSecurity ? <MoneyText value={p.socialSecurity.employee} /> : '•••'}
                </TableCell>
                <TableCell align="right">
                  {p.gross !== undefined ? <MoneyText value={p.gross} /> : '•••'}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 800 }}>
                  {p.net !== undefined ? <MoneyText value={p.net} /> : '•••'}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Button size="small" onClick={() => setViewing(p.id)}>
                    {t('payroll.view')}
                  </Button>
                  {editable && (
                    <Button
                      size="small"
                      onClick={() =>
                        setLine({
                          staffId: p.staffId,
                          kind: 'earning',
                          name: '',
                          amount: 0,
                          reason: '',
                        })
                      }
                    >
                      {t('payroll.addLine')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {r.oneOffLines.length > 0 && (
        <Card variant="outlined" sx={{ mt: 4 }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ mb: 2 }}>
              {t('payroll.oneOffs')}
            </Typography>
            {r.oneOffLines.map((l) => (
              <Stack key={l._id} direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="body2">
                  {(r.payslips ?? []).find((p) => p.staffId === l.staffId)?.staffName} · {l.name} (
                  {t(`payroll.kinds.${l.kind}`)}) — {l.reason}
                </Typography>
                <Stack direction="row" alignItems="center">
                  <MoneyText value={l.kind === 'deduction' ? -l.amount : l.amount} />
                  {editable && (
                    <IconButton
                      size="small"
                      aria-label={t('payroll.removeLine')}
                      onClick={() =>
                        run(
                          muts.removeLine.mutateAsync({ id: r.id, lineId: l._id }),
                          t('payroll.lineRemoved'),
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  )}
                </Stack>
              </Stack>
            ))}
          </CardContent>
        </Card>
      )}
      {line && (
        <Dialog open onClose={() => setLine(null)} fullWidth maxWidth="xs">
          <DialogTitle>{t('payroll.addLine')}</DialogTitle>
          <DialogContent>
            <Stack spacing={3} sx={{ pt: 1 }}>
              <TextField
                select
                label={t('payroll.kind')}
                value={line.kind}
                onChange={(e) => setLine({ ...line, kind: e.target.value as 'earning' })}
              >
                <MenuItem value="earning">{t('payroll.kinds.earning')}</MenuItem>
                <MenuItem value="deduction">{t('payroll.kinds.deduction')}</MenuItem>
              </TextField>
              <TextField
                label={t('payroll.lineName')}
                value={line.name}
                onChange={(e) => setLine({ ...line, name: e.target.value.slice(0, 60) })}
                required
              />
              <MoneyInput
                label={t('payroll.amount')}
                value={line.amount}
                currency={currency}
                onChange={(v) => setLine({ ...line, amount: typeof v === 'number' ? v : 0 })}
              />
              <TextField
                label={t('payroll.reason')}
                value={line.reason}
                onChange={(e) => setLine({ ...line, reason: e.target.value.slice(0, 300) })}
                required
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setLine(null)}>{t('payroll.close')}</Button>
            <Button
              variant="contained"
              disabled={!line.name.trim() || !line.reason.trim() || line.amount <= 0}
              onClick={() =>
                void muts.addLine
                  .mutateAsync({ id: r.id, ...line })
                  .then(() => (notify.success(t('payroll.lineAdded')), setLine(null)), notify.error)
              }
            >
              {t('payroll.save')}
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {viewing && <PayslipDialog id={viewing} onClose={() => setViewing(null)} />}
    </Box>
  );
}

function PayslipDialog({
  id,
  onClose,
  canAck,
}: {
  id: string;
  onClose: () => void;
  canAck?: boolean;
}) {
  const { t, i18n } = useTranslation('hr');
  const fmt = useFormatMoney();
  const notify = useNotify();
  const q = usePayslip(id);
  const ack = useAcknowledgePayslip();
  const d = q.data;
  const p = d?.payslip;
  const row = (label: string, v?: number) =>
    v ? (
      <Stack direction="row" justifyContent="space-between" key={label}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2">{fmt(v)}</Typography>
      </Stack>
    ) : null;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogContent>
        {!p ? (
          q.error ? (
            <ErrorState error={q.error} compact />
          ) : (
            <PageSkeleton rows={5} />
          )
        ) : (
          <PrintArea>
            <Typography variant="h5">{d.clinic?.name}</Typography>
            <Typography variant="subtitle1" sx={{ mt: 1 }}>
              {t('payslip.title', {
                period: formatDate(
                  `${p.year}-${String(p.month).padStart(2, '0')}-01`,
                  i18n.language,
                  'MMMM YYYY',
                ),
              })}
            </Typography>
            <Typography variant="body2">
              {d.staff.name} {d.staff.jobTitle ? `· ${d.staff.jobTitle}` : ''} ·{' '}
              {t('payslip.days', { worked: p.workedDays, total: p.daysInMonth })}
            </Typography>
            <Divider sx={{ my: 2 }} />
            <Typography variant="overline">{t('payslip.earnings')}</Typography>
            {row(t('payslip.basic'), p.basic)}
            {(p.earnings ?? []).map((e) => row(e.name, e.amount))}
            {row(t('payslip.overtime'), p.overtime?.amount)}
            {row(t('payslip.commission'), p.commission?.amount)}
            {row(
              t('payslip.absence', { count: p.absentDays }),
              p.absenceDeduction ? -p.absenceDeduction : 0,
            )}
            {row(
              t('payslip.unpaidLeave', { count: p.unpaidLeaveDays }),
              p.unpaidLeaveDeduction ? -p.unpaidLeaveDeduction : 0,
            )}
            {row(t('payslip.gross'), p.gross)}
            <Typography variant="overline" sx={{ display: 'block', mt: 2 }}>
              {t('payslip.deductions')}
            </Typography>
            {row(t('payslip.ssc'), p.socialSecurity?.employee)}
            {row(t('payslip.tax'), p.incomeTax)}
            {(p.deductions ?? []).map((e) => row(e.name, e.amount))}
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="h6">{t('payslip.net')}</Typography>
              <Typography variant="h6">{fmt(p.net ?? 0)}</Typography>
            </Stack>
            {p.acknowledgedAt && (
              <Typography variant="caption" color="text.secondary">
                {t('payslip.acknowledgedOn', {
                  date: formatDate(p.acknowledgedAt, i18n.language, 'lll'),
                })}
              </Typography>
            )}
          </PrintArea>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('payroll.close')}</Button>
        <Button startIcon={<Printer size={16} />} onClick={() => window.print()} disabled={!p}>
          {t('payslip.print')}
        </Button>
        {canAck && p && !p.acknowledgedAt && (
          <Button
            variant="contained"
            onClick={() =>
              void ack
                .mutateAsync(p.id)
                .then(() => notify.success(t('payslip.acknowledged')), notify.error)
            }
          >
            {t('payslip.acknowledge')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function MyPayslipsPage() {
  const { t, i18n } = useTranslation('hr');
  const list = useMyPayslips();
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <Box>
      <PageHeader title={t('payslip.mine')} subtitle={t('payslip.mineSubtitle')} />
      {list.isLoading ? (
        <PageSkeleton rows={4} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t('payslip.none')} />
      ) : (
        <Stack spacing={2}>
          {(list.data ?? []).map((p: Payslip) => (
            <Card
              key={p.id}
              variant="outlined"
              sx={{ cursor: 'pointer' }}
              onClick={() => setViewing(p.id)}
            >
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="subtitle1">
                    {formatDate(
                      `${p.year}-${String(p.month).padStart(2, '0')}-01`,
                      i18n.language,
                      'MMMM YYYY',
                    )}
                  </Typography>
                  <Stack direction="row" spacing={2} alignItems="center">
                    {p.net !== undefined && <MoneyText value={p.net} />}
                    <Chip
                      size="small"
                      color={p.acknowledgedAt ? 'success' : 'warning'}
                      label={p.acknowledgedAt ? t('payslip.acknowledgedShort') : t('payslip.new')}
                    />
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
      {viewing && <PayslipDialog id={viewing} canAck onClose={() => setViewing(null)} />}
    </Box>
  );
}
