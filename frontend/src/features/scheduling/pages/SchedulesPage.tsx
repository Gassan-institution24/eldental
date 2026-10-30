import {
  Avatar,
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
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { CalendarOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { formatDateTime, inClinicTz, todayLocal } from '@/lib/dates';
import {
  dateOnly,
  freeText,
  objectId,
  optional,
  timeOfDay,
} from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox, RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  useDeleteException,
  useExceptions,
  useSaveException,
  useSaveSchedule,
  type DentistSchedules,
  type ScheduleException,
} from '../api';
import { addDaysLocal, localToIso, useSchedulingLookups } from '../components/lookups';

const WEEKDAYS = [6, 0, 1, 2, 3, 4, 5];
const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Dentist weekly hours and exceptions (06 §1). */
export function SchedulesPage() {
  const { t } = useTranslation('scheduling');
  const lookups = useSchedulingLookups();
  const { can, grant, session } = usePermission();
  const [editing, setEditing] = useState<DentistSchedules | null>(null);
  const [exception, setException] = useState<Partial<ScheduleException> | null>(null);
  const manageAll =
    Boolean(session?.isOwner) || grant('scheduling.schedule.manage')?.scope === 'all';
  const canManage = (staffId: string) =>
    manageAll || (can('scheduling.schedule.manage') && staffId === session?.staff?.id);

  return (
    <Box>
      <PageHeader
        title={t('schedules.title')}
        subtitle={t('schedules.subtitle')}
        primary={
          can('scheduling.schedule.manage') && (
            <Button
              variant="contained"
              startIcon={<CalendarOff size={18} />}
              onClick={() =>
                setException({
                  type: manageAll ? 'holiday' : 'time_off',
                  staffId: manageAll ? undefined : session?.staff?.id,
                })
              }
            >
              {t('exceptions.add')}
            </Button>
          )
        }
      />
      {lookups.loading ? (
        <PageSkeleton rows={6} />
      ) : lookups.error ? (
        <ErrorState error={lookups.error} />
      ) : lookups.schedules.length === 0 ? (
        <EmptyState title={t('calendar.noDentists')} description={t('calendar.noDentistsHint')} />
      ) : (
        <Grid container spacing={4}>
          {lookups.schedules.map((s) => (
            <Grid item xs={12} md={6} xl={4} key={s.staff.id}>
              <ScheduleCard
                schedule={s}
                canEdit={canManage(s.staff.id)}
                onEdit={() => setEditing(s)}
              />
            </Grid>
          ))}
        </Grid>
      )}
      <Box sx={{ mt: 6 }}>
        <ExceptionsTable
          onEdit={(e) => setException(e)}
          canManage={canManage}
          manageAll={manageAll}
        />
      </Box>
      {editing && <ScheduleDrawer schedule={editing} onClose={() => setEditing(null)} />}
      {exception && (
        <ExceptionDialog
          initial={exception}
          manageAll={manageAll}
          onClose={() => setException(null)}
        />
      )}
    </Box>
  );
}

function ScheduleCard({
  schedule,
  canEdit,
  onEdit,
}: {
  schedule: DentistSchedules;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('scheduling');
  const cur = schedule.current;
  const hours = (cur?.weekly ?? []).reduce(
    (sum, w) => sum + w.blocks.reduce((x, b) => x + toMin(b.end) - toMin(b.start), 0),
    0,
  );
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" spacing={3} alignItems="center" sx={{ mb: 4 }}>
          <Avatar sx={{ bgcolor: schedule.staff.color }}>{schedule.staff.name.charAt(0)}</Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap dir="auto">
              {schedule.staff.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {cur
                ? t('schedules.summary', {
                    hours: Math.round(hours / 6) / 10,
                    step: cur.slotGranularityMin,
                  })
                : t('schedules.none')}
            </Typography>
          </Box>
          {schedule.staff.bookableOnline && (
            <Chip size="small" color="info" label={t('schedules.online')} />
          )}
          {canEdit && (
            <Tooltip title={t('schedules.edit')}>
              <IconButton onClick={onEdit} aria-label={t('schedules.edit')}>
                <Pencil size={18} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Stack spacing={1.5}>
          {WEEKDAYS.map((wd) => {
            const blocks = cur?.weekly.find((w) => w.weekday === wd)?.blocks ?? [];
            return (
              <Stack key={wd} direction="row" spacing={2} alignItems="center">
                <Typography variant="body2" color="text.secondary" sx={{ width: 72 }}>
                  {t(`weekdays.${wd}`)}
                </Typography>
                {blocks.length === 0 ? (
                  <Typography variant="body2" color="text.disabled">
                    {t('schedules.off')}
                  </Typography>
                ) : (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {blocks.map((b, i) => (
                      <Chip
                        key={i}
                        size="small"
                        variant="outlined"
                        label={`${b.start}–${b.end}`}
                        sx={{ direction: 'ltr' }}
                      />
                    ))}
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}

const blockSchema = z
  .object({
    start: timeOfDay(),
    end: timeOfDay(),
    chairId: optional(objectId()),
    onlineBookable: z.boolean(),
  })
  .superRefine((b, ctx) => {
    if (
      /^\d{2}:\d{2}$/.test(b.start) &&
      /^\d{2}:\d{2}$/.test(b.end) &&
      toMin(b.end) <= toMin(b.start)
    )
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'end_before_start' });
  });
const scheduleSchema = z.object({
  effectiveFrom: dateOnly(),
  slotGranularityMin: z.coerce
    .number()
    .refine((v) => [5, 10, 15, 20, 30, 60].includes(v), { message: 'invalid_option' }),
  days: z.array(
    z
      .object({ weekday: z.number(), blocks: z.array(blockSchema).max(8, { message: 'too_many' }) })
      .superRefine((d, ctx) => {
        const sorted = d.blocks
          .map((b, i) => ({ ...b, i }))
          .sort((a, b) => toMin(a.start) - toMin(b.start));
        for (let k = 1; k < sorted.length; k += 1) {
          if (toMin(sorted[k]!.start) < toMin(sorted[k - 1]!.end))
            ctx.addIssue({
              code: 'custom',
              path: ['blocks', sorted[k]!.i, 'start'],
              message: 'overlap',
            });
        }
      }),
  ),
});
type ScheduleValues = z.input<typeof scheduleSchema>;

function ScheduleDrawer({
  schedule,
  onClose,
}: {
  schedule: DentistSchedules;
  onClose: () => void;
}) {
  const { t } = useTranslation('scheduling');
  const notify = useNotify();
  const save = useSaveSchedule();
  const cur = schedule.current;
  const form = useAppForm<ScheduleValues>({
    schema: scheduleSchema,
    defaultValues: {
      effectiveFrom: todayLocal(),
      slotGranularityMin: String(cur?.slotGranularityMin ?? 15) as unknown as number,
      days: WEEKDAYS.map((weekday) => ({
        weekday,
        blocks: (cur?.weekly.find((w) => w.weekday === weekday)?.blocks ?? []).map((b) => ({
          start: b.start,
          end: b.end,
          chairId: b.chairId ?? schedule.staff.defaultChairId ?? '',
          onlineBookable: b.onlineBookable,
        })),
      })),
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('schedules.editFor', { name: schedule.staff.name })}
      subtitle={t('schedules.editHint')}
      formId="schedule-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form
        form={form}
        name="scheduling.schedule"
        id="schedule-form"
        onSubmit={async (v) => {
          await save.mutateAsync({
            staffId: schedule.staff.id,
            effectiveFrom: v.effectiveFrom,
            slotGranularityMin: Number(v.slotGranularityMin),
            weekly: v.days
              .filter((d) => d.blocks.length)
              .map((d) => ({
                weekday: d.weekday,
                blocks: d.blocks.map((b) => ({
                  start: b.start,
                  end: b.end,
                  ...(b.chairId ? { chairId: b.chairId } : {}),
                  onlineBookable: b.onlineBookable,
                })),
              })),
          });
          notify.success(t('schedules.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6}>
              <RHFDate
                name="effectiveFrom"
                label={t('schedules.effectiveFrom')}
                required
                helperText={t('schedules.effectiveHelper')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <RHFSelect
                name="slotGranularityMin"
                label={t('schedules.step')}
                options={[5, 10, 15, 20, 30, 60].map((m) => ({
                  value: String(m),
                  label: t('minutes', { count: m }),
                }))}
              />
            </Grid>
          </Grid>
          {WEEKDAYS.map((wd, i) => (
            <DayEditor
              key={wd}
              index={i}
              weekday={wd}
              defaultChairId={schedule.staff.defaultChairId}
            />
          ))}
        </Stack>
      </Form>
    </FormDrawer>
  );
}

function DayEditor({
  index,
  weekday,
  defaultChairId,
}: {
  index: number;
  weekday: number;
  defaultChairId?: string;
}) {
  const { t } = useTranslation('scheduling');
  const { control } = useFormContext<ScheduleValues>();
  const lookups = useSchedulingLookups();
  const { fields, append, remove } = useFieldArray({ control, name: `days.${index}.blocks` });
  const blocks = useWatch({ control, name: `days.${index}.blocks` });
  const last = blocks?.[blocks.length - 1];
  return (
    <Box sx={{ p: 3, borderRadius: 2, border: 1, borderColor: 'divider' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: fields.length ? 3 : 0 }}
      >
        <Typography variant="subtitle2">{t(`weekdays.${weekday}`)}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {fields.length === 0 && (
            <Typography variant="caption" color="text.disabled">
              {t('schedules.off')}
            </Typography>
          )}
          <Button
            size="small"
            startIcon={<Plus size={14} />}
            onClick={() =>
              append({
                start: last?.end ?? '09:00',
                end: last ? '18:00' : '13:00',
                chairId: defaultChairId ?? '',
                onlineBookable: true,
              })
            }
          >
            {t('schedules.addBlock')}
          </Button>
        </Stack>
      </Stack>
      <Stack spacing={2}>
        {fields.map((f, bi) => (
          <Grid container spacing={2} key={f.id} alignItems="center">
            <Grid item xs={6} sm={2.5}>
              <RHFTextField
                name={`days.${index}.blocks.${bi}.start`}
                label={t('schedules.from')}
                size="small"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={6} sm={2.5}>
              <RHFTextField
                name={`days.${index}.blocks.${bi}.end`}
                label={t('schedules.to')}
                size="small"
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={7} sm={3.5}>
              <RHFSelect
                name={`days.${index}.blocks.${bi}.chairId`}
                label={t('fields.chair')}
                clearable
                options={lookups.chairs.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Grid>
            <Grid item xs={4} sm={2.5}>
              <RHFCheckbox
                name={`days.${index}.blocks.${bi}.onlineBookable`}
                label={t('schedules.online')}
              />
            </Grid>
            <Grid item xs={1}>
              <IconButton
                size="small"
                aria-label={t('schedules.removeBlock')}
                onClick={() => remove(bi)}
              >
                <Trash2 size={16} />
              </IconButton>
            </Grid>
          </Grid>
        ))}
      </Stack>
    </Box>
  );
}

function ExceptionsTable({
  onEdit,
  canManage,
  manageAll,
}: {
  onEdit: (e: ScheduleException) => void;
  canManage: (staffId: string) => boolean;
  manageAll: boolean;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const notify = useNotify();
  const confirm = useConfirm();
  const lookups = useSchedulingLookups();
  const today = todayLocal();
  const list = useExceptions({ from: today, to: addDaysLocal(today, 365) });
  const del = useDeleteException();
  const canTouch = (e: ScheduleException) => (e.staffId ? canManage(e.staffId) : manageAll);
  return (
    <SectionCard title={t('exceptions.title')} subtitle={t('exceptions.subtitle')}>
      {list.isLoading ? (
        <PageSkeleton rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} compact />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState compact title={t('exceptions.empty')} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('exceptions.type')}</TableCell>
                <TableCell>{t('exceptions.who')}</TableCell>
                <TableCell>{t('exceptions.from')}</TableCell>
                <TableCell>{t('exceptions.to')}</TableCell>
                <TableCell>{t('exceptions.reason')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {(list.data ?? []).map((e) => (
                <TableRow key={e.id} hover>
                  <TableCell>{t(`exceptions.types.${e.type}`)}</TableCell>
                  <TableCell>
                    {e.staffId
                      ? lookups.dentistById.get(e.staffId)?.name
                      : e.chairId
                        ? lookups.chairById.get(e.chairId)?.name
                        : t('exceptions.wholeClinic')}
                  </TableCell>
                  <TableCell>{formatDateTime(e.start, i18n.language)}</TableCell>
                  <TableCell>{formatDateTime(e.end, i18n.language)}</TableCell>
                  <TableCell dir="auto">{e.reason}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {canTouch(e) && (
                      <>
                        <IconButton
                          size="small"
                          aria-label={t('schedules.edit')}
                          onClick={() => onEdit(e)}
                        >
                          <Pencil size={16} />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={t('exceptions.delete')}
                          onClick={async () => {
                            const r = await confirm({
                              title: t('exceptions.deleteTitle'),
                              destructive: true,
                            });
                            if (!r.confirmed) return;
                            await del
                              .mutateAsync(e.id)
                              .then(() => notify.success(t('exceptions.deleted')), notify.error);
                          }}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </SectionCard>
  );
}

const exceptionSchema = z
  .object({
    type: z.enum(['time_off', 'extra_hours', 'holiday', 'chair_maintenance'], {
      message: 'required',
    }),
    staffId: optional(objectId()),
    chairId: optional(objectId()),
    startDate: dateOnly(),
    startTime: timeOfDay(),
    endDate: dateOnly(),
    endTime: timeOfDay(),
    reason: optional(freeText(300)),
  })
  .superRefine((v, ctx) => {
    if ((v.type === 'time_off' || v.type === 'extra_hours') && !v.staffId)
      ctx.addIssue({ code: 'custom', path: ['staffId'], message: 'required' });
    if (v.type === 'chair_maintenance' && !v.chairId)
      ctx.addIssue({ code: 'custom', path: ['chairId'], message: 'required' });
    if (`${v.endDate} ${v.endTime}` <= `${v.startDate} ${v.startTime}`)
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'end_before_start' });
  });
type ExceptionValues = z.input<typeof exceptionSchema>;

function ExceptionDialog({
  initial,
  manageAll,
  onClose,
}: {
  initial: Partial<ScheduleException>;
  manageAll: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('scheduling');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const save = useSaveException();
  const lookups = useSchedulingLookups();
  const today = todayLocal();
  const split = (iso?: string): [string, string] =>
    iso ? [inClinicTz(iso).format('YYYY-MM-DD'), inClinicTz(iso).format('HH:mm')] : ['', ''];
  const [sd, st] = split(initial.start);
  const [ed, et] = split(initial.end);
  const form = useAppForm<ExceptionValues>({
    schema: exceptionSchema,
    defaultValues: {
      type: initial.type ?? 'time_off',
      staffId: initial.staffId ?? '',
      chairId: initial.chairId ?? '',
      startDate: sd || today,
      startTime: st || '00:00',
      endDate: ed || today,
      endTime: et || '23:59',
      reason: initial.reason ?? '',
    },
  });
  const type = useWatch({ control: form.control, name: 'type' });
  const types = useMemo(
    () =>
      manageAll
        ? (['time_off', 'extra_hours', 'holiday', 'chair_maintenance'] as const)
        : (['time_off', 'extra_hours'] as const),
    [manageAll],
  );
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{initial.id ? t('exceptions.edit') : t('exceptions.add')}</DialogTitle>
      <DialogContent>
        <Form
          form={form}
          name="scheduling.exception"
          id="exception-form"
          onSubmit={async (raw) => {
            const v = raw as z.output<typeof exceptionSchema>;
            await save.mutateAsync({
              ...(initial.id ? { id: initial.id, version: initial.version } : {}),
              type: v.type,
              ...(v.type === 'time_off' || v.type === 'extra_hours' ? { staffId: v.staffId } : {}),
              ...(v.type === 'chair_maintenance' ? { chairId: v.chairId } : {}),
              start: localToIso(v.startDate, v.startTime),
              end: localToIso(v.endDate, v.endTime),
              reason: v.reason ?? '',
            });
            notify.success(t('exceptions.saved'));
            onClose();
          }}
        >
          <Grid container spacing={3} sx={{ pt: 2 }}>
            <Grid item xs={12} sm={6}>
              <RHFSelect
                name="type"
                label={t('exceptions.type')}
                required
                options={types.map((x) => ({ value: x, label: t(`exceptions.types.${x}`) }))}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              {(type === 'time_off' || type === 'extra_hours') && (
                <RHFSelect
                  name="staffId"
                  label={t('fields.dentist')}
                  required
                  options={lookups.dentists.map((d) => ({ value: d.id, label: d.name }))}
                  disabled={!manageAll}
                />
              )}
              {type === 'chair_maintenance' && (
                <RHFSelect
                  name="chairId"
                  label={t('fields.chair')}
                  required
                  options={lookups.chairs.map((c) => ({ value: c.id, label: c.name }))}
                />
              )}
            </Grid>
            <Grid item xs={7}>
              <RHFDate name="startDate" label={t('exceptions.from')} required />
            </Grid>
            <Grid item xs={5}>
              <RHFTextField
                name="startTime"
                label={t('fields.time')}
                required
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={7}>
              <RHFDate name="endDate" label={t('exceptions.to')} required />
            </Grid>
            <Grid item xs={5}>
              <RHFTextField
                name="endTime"
                label={t('fields.time')}
                required
                inputProps={{ dir: 'ltr' }}
              />
            </Grid>
            <Grid item xs={12}>
              <RHFTextField name="reason" label={t('exceptions.reason')} maxLength={300} />
            </Grid>
          </Grid>
        </Form>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{tc('actions.cancel')}</Button>
        <Button type="submit" form="exception-form" variant="contained" disabled={save.isPending}>
          {tc('actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
