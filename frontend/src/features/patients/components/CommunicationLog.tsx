import { Box, Button, Card, Chip, Grid, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { BellRing, Check, Mail, MessageCircle, MessageSquare, Pencil, Phone, Plus, Undo2, UserRound, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { z } from 'zod';
import { formatDate, formatDateTime } from '@/lib/dates';
import { COMM_CHANNELS, COMM_DIRECTIONS, COMM_OUTCOMES } from '@/shared/generated/patients';
import { dateOnly, enumOf, optional, requiredText } from '@/shared/generated/validation/fields';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import { useCommunications, useSaveCommunication, type Communication, type Patient } from '../api/patients';
import { usePatientContext } from '../pages/PatientWorkspace';

const ICON: Record<Communication['channel'], LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  email: Mail,
  in_person: UserRound,
  other: MessageSquare,
};

/** The server's rules (shared/patients); the follow-up is picked as a day and sent as 09:00 that day. */
const schema = z
  .object({
    channel: enumOf([...COMM_CHANNELS]),
    direction: enumOf([...COMM_DIRECTIONS]),
    summary: requiredText(1000),
    outcome: enumOf([...COMM_OUTCOMES]),
    followUpOn: optional(dateOnly()),
  })
  .superRefine((v, ctx) => {
    if (v.followUpOn && v.followUpOn < dayjs().format('YYYY-MM-DD'))
      ctx.addIssue({ code: 'custom', path: ['followUpOn'], message: 'date_in_past' });
  });
type Values = z.input<typeof schema>;

function CommunicationDrawer({ patientId, entry, onClose }: { patientId: string; entry?: Communication; onClose: () => void }) {
  const { t } = useTranslation('patients');
  const notify = useNotify();
  const save = useSaveCommunication(patientId);
  const form = useAppForm<Values>({
    schema,
    defaultValues: {
      channel: entry?.channel ?? 'call',
      direction: entry?.direction ?? 'out',
      summary: entry?.summary ?? '',
      outcome: entry?.outcome ?? 'reached',
      followUpOn: entry?.followUpAt ? dayjs(entry.followUpAt).format('YYYY-MM-DD') : '',
    },
  });
  const opts = <T extends string>(list: readonly T[], ns: string) => list.map((v) => ({ value: v, label: t(`communication.${ns}.${v}`) }));

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={entry ? t('communication.edit') : t('communication.add')}
      subtitle={entry ? t('communication.editHint') : undefined}
      formId="communication-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
    >
      <Form
        form={form}
        name="patient.communication"
        id="communication-form"
        onSubmit={async (values) => {
          const v = values as unknown as z.output<typeof schema>;
          const followUpAt = v.followUpOn ? dayjs(v.followUpOn).hour(9).toISOString() : entry ? null : undefined;
          await save.mutateAsync({
            ...(entry ? { id: entry.id } : {}),
            channel: v.channel,
            direction: v.direction,
            summary: v.summary,
            outcome: v.outcome,
            ...(followUpAt !== undefined ? { followUpAt } : {}),
          });
          notify.success(t('communication.saved'));
          onClose();
        }}
      >
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <RHFSelect name="channel" label={t('communication.channel')} required options={opts(COMM_CHANNELS, 'channels')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect name="direction" label={t('communication.direction')} required options={opts(COMM_DIRECTIONS, 'directions')} />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField name="summary" label={t('communication.summary')} required multiline minRows={3} maxLength={1000} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFSelect name="outcome" label={t('communication.outcome')} required options={opts(COMM_OUTCOMES, 'outcomes')} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFDate name="followUpOn" label={t('communication.followUpOn')} helperText={t('communication.followUpHint')} minDate={dayjs().format('YYYY-MM-DD')} />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

function Entry({ c, canWrite, onEdit }: { c: Communication; canWrite: boolean; onEdit: () => void }) {
  const { t, i18n } = useTranslation('patients');
  const lang = i18n.resolvedLanguage ?? 'ar';
  const notify = useNotify();
  const save = useSaveCommunication(c.patientId);
  const Icon = ICON[c.channel];
  const due = c.followUpAt && !c.followUpDoneAt && dayjs(c.followUpAt).isBefore(dayjs());
  const toggle = (done: boolean) =>
    save.mutateAsync({ id: c.id, followUpDone: done }).then(() => notify.success(t(done ? 'communication.doneToast' : 'communication.reopenedToast')), notify.error);
  return (
    <Card variant="outlined" sx={{ p: 3 }} data-testid={`communication-${c.id}`}>
      <Stack direction="row" spacing={2} alignItems="flex-start">
        <Box sx={{ color: 'primary.main', pt: 0.5 }}>
          <Icon size={18} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography fontWeight={650}>
              {t(`communication.channels.${c.channel}`)} · {t(`communication.directions.${c.direction}`)}
            </Typography>
            <Chip size="small" variant="outlined" label={t(`communication.outcomes.${c.outcome}`)} />
            <Typography variant="caption" color="text.secondary">
              {formatDateTime(c.at, lang)}
              {c.staffName ? ` · ${c.staffName}` : ''}
            </Typography>
          </Stack>
          <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }} dir="auto">
            {c.summary}
          </Typography>
          {c.followUpAt && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
              <Chip
                size="small"
                icon={c.followUpDoneAt ? <Check size={14} /> : <BellRing size={14} />}
                color={c.followUpDoneAt ? 'success' : due ? 'warning' : 'default'}
                variant={due ? 'filled' : 'outlined'}
                label={
                  c.followUpDoneAt
                    ? t('communication.followUpDone', { date: formatDate(c.followUpDoneAt, lang), name: c.followUpDoneByName ?? '—' })
                    : t(due ? 'communication.followUpDue' : 'communication.followUpOnValue', { date: formatDate(c.followUpAt, lang) })
                }
              />
              {canWrite &&
                (c.followUpDoneAt ? (
                  <Button size="small" startIcon={<Undo2 size={14} />} onClick={() => void toggle(false)} disabled={save.isPending}>
                    {t('communication.reopen')}
                  </Button>
                ) : (
                  <Button size="small" startIcon={<Check size={14} />} onClick={() => void toggle(true)} disabled={save.isPending}>
                    {t('communication.markDone')}
                  </Button>
                ))}
            </Stack>
          )}
        </Box>
        {canWrite && c.editable && (
          <Tooltip title={t('communication.edit')}>
            <IconButton size="small" onClick={onEdit} aria-label={t('communication.edit')}>
              <Pencil size={16} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Card>
  );
}

/** "Communication" tab: everything said to or by the patient, newest first, with follow-ups. */
export function CommunicationTab() {
  const { t } = useTranslation('patients');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const canWrite = can('patients.communication.write');
  const [limit, setLimit] = useState(50);
  const q = useCommunications(p.id, true, limit);
  const [drawer, setDrawer] = useState<{ entry?: Communication } | null>(null);

  if (q.isLoading) return <PageSkeleton rows={4} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { data, meta } = q.data;

  return (
    <SectionCard
      title={t('communication.title')}
      subtitle={meta.dueCount ? t('communication.dueCount', { count: meta.dueCount }) : t('communication.hint')}
      actions={
        canWrite && (
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setDrawer({})}>
            {t('communication.add')}
          </Button>
        )
      }
    >
      {data.length === 0 ? (
        <EmptyState
          compact
          title={t('communication.empty')}
          description={t('communication.emptyHint')}
          action={
            canWrite ? (
              <Button startIcon={<Plus size={16} />} onClick={() => setDrawer({})}>
                {t('communication.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Stack spacing={2}>
          {data.map((c) => (
            <Entry key={c.id} c={c} canWrite={canWrite} onEdit={() => setDrawer({ entry: c })} />
          ))}
          {meta.total > data.length && (
            <Box sx={{ textAlign: 'center' }}>
              <Button onClick={() => setLimit((l) => Math.min(l + 50, 100))} disabled={limit >= 100}>
                {t('communication.more', { count: meta.total - data.length })}
              </Button>
            </Box>
          )}
        </Stack>
      )}
      {drawer && <CommunicationDrawer patientId={p.id} entry={drawer.entry} onClose={() => setDrawer(null)} />}
    </SectionCard>
  );
}

/** Header chip when follow-ups are due; opens the Communication tab. */
export function FollowUpDueChip({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation('patients');
  const { can } = usePermission();
  const q = useCommunications(p.id, can('patients.communication.read'), 1);
  const due = q.data?.meta.dueCount ?? 0;
  if (!due) return null;
  return (
    <Chip
      size="small"
      color="warning"
      icon={<BellRing size={14} />}
      label={t('communication.dueCount', { count: due })}
      component={RouterLink}
      to={`/clinic/patients/${p.id}/communication`}
      clickable
      data-testid="follow-up-due"
    />
  );
}
