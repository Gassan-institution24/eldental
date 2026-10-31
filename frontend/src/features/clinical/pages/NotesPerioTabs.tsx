import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { FilePen, Lock, Plus, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { useSchedulingLookups } from '@/features/scheduling/components/lookups';
import { formatDate, formatDateTime, todayLocal } from '@/lib/dates';
import { freeText, optional } from '@/shared/generated/validation/fields';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { Form } from '@/shared/form/Form';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  noteTemplatesApi,
  useNoteMutations,
  useNotes,
  usePerio,
  usePerioMutations,
  type ClinicalNote,
  type PerioExam,
  type PerioTooth,
} from '../api';
import { LOWER_PERMANENT, UPPER_PERMANENT } from '../components/odontogram/teeth';

/* ---------------- notes (07 §5) ---------------- */

const SOAP = ['subjective', 'objective', 'assessment', 'plan'] as const;
const noteSchema = z
  .object({
    format: z.enum(['soap', 'free']),
    subjective: optional(freeText(5000)),
    objective: optional(freeText(5000)),
    assessment: optional(freeText(5000)),
    plan: optional(freeText(5000)),
    text: optional(freeText(10000)),
  })
  .superRefine((v, ctx) => {
    const filled = v.format === 'free' ? Boolean(v.text) : SOAP.some((k) => Boolean(v[k]));
    if (!filled)
      ctx.addIssue({
        code: 'custom',
        path: [v.format === 'free' ? 'text' : 'subjective'],
        message: 'required',
      });
  });
type NoteValues = z.input<typeof noteSchema>;

export function NotesTab() {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const notes = useNotes(patient.id);
  const muts = useNoteMutations(patient.id);
  const sched = useSchedulingLookups();
  const notify = useNotify();
  const confirm = useConfirm();
  const { can, session } = usePermission();
  const [editing, setEditing] = useState<{ note?: ClinicalNote; amend?: boolean } | null>(null);

  if (notes.isLoading) return <PageSkeleton rows={4} />;
  if (notes.error) return <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />;
  const list = notes.data ?? [];
  const mine = (n: ClinicalNote) => n.authorId === session?.staff?.id;

  return (
    <Stack spacing={4}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5">{t('notes.title')}</Typography>
        {can('clinical.note.write') && !editing && (
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setEditing({})}>
            {t('notes.new')}
          </Button>
        )}
      </Stack>
      {editing && (
        <NoteEditor note={editing.note} amend={editing.amend} onDone={() => setEditing(null)} />
      )}
      {list.length === 0 && !editing ? (
        <EmptyState title={t('notes.empty')} />
      ) : (
        list.map((n) => (
          <Card key={n.id} variant="outlined" sx={{ opacity: n.amendedById ? 0.6 : 1 }}>
            <CardContent>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={2}
                flexWrap="wrap"
                useFlexGap
              >
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Typography variant="subtitle2">
                    {sched.dentistById.get(n.authorId)?.name ?? t('notes.author')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(n.createdAt, i18n.language)}
                  </Typography>
                  {n.signedAt ? (
                    <Chip
                      size="small"
                      color="success"
                      icon={<Lock size={12} />}
                      label={t('notes.signed')}
                    />
                  ) : (
                    <Chip size="small" color="warning" label={t('notes.draft')} />
                  )}
                  {n.amendsNoteId && (
                    <Chip size="small" variant="outlined" label={t('notes.amendment')} />
                  )}
                  {n.amendedById && (
                    <Chip size="small" variant="outlined" label={t('notes.superseded')} />
                  )}
                </Stack>
                <Stack direction="row" spacing={1}>
                  {!n.signedAt && mine(n) && can('clinical.note.write') && (
                    <Button
                      size="small"
                      startIcon={<FilePen size={14} />}
                      onClick={() => setEditing({ note: n })}
                    >
                      {t('notes.edit')}
                    </Button>
                  )}
                  {!n.signedAt && mine(n) && can('clinical.note.sign') && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<Lock size={14} />}
                      onClick={async () => {
                        const r = await confirm({
                          title: t('notes.signTitle'),
                          body: t('notes.signBody'),
                        });
                        if (r.confirmed)
                          await muts.sign
                            .mutateAsync(n.id)
                            .then(() => notify.success(t('notes.signedDone')), notify.error);
                      }}
                    >
                      {t('notes.sign')}
                    </Button>
                  )}
                  {n.signedAt && !n.amendedById && can('clinical.note.write') && (
                    <Button size="small" onClick={() => setEditing({ note: n, amend: true })}>
                      {t('notes.amend')}
                    </Button>
                  )}
                </Stack>
              </Stack>
              <Box sx={{ mt: 2 }}>
                {n.format === 'free' ? (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }} dir="auto">
                    {n.text}
                  </Typography>
                ) : (
                  <Grid container spacing={2}>
                    {SOAP.filter((k) => n.content[k]).map((k) => (
                      <Grid item xs={12} md={6} key={k}>
                        <Typography variant="overline" color="text.secondary">
                          {t(`notes.soap.${k}`)}
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }} dir="auto">
                          {n.content[k]}
                        </Typography>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </Box>
            </CardContent>
          </Card>
        ))
      )}
      {list.some(
        (n) => !n.signedAt && mine(n) && Date.now() - new Date(n.createdAt).getTime() > 86_400_000,
      ) && <Alert severity="warning">{t('notes.unsignedOld')}</Alert>}
    </Stack>
  );
}

function NoteEditor({
  note,
  amend,
  onDone,
}: {
  note?: ClinicalNote;
  amend?: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation('clinical');
  const { t: tc } = useTranslation();
  const { patient } = usePatientContext();
  const notify = useNotify();
  const muts = useNoteMutations(patient.id);
  const templates = noteTemplatesApi.useAll();
  const form = useAppForm<NoteValues>({
    schema: noteSchema,
    defaultValues: {
      format: note?.format ?? 'soap',
      subjective: note?.content.subjective ?? '',
      objective: note?.content.objective ?? '',
      assessment: note?.content.assessment ?? '',
      plan: note?.content.plan ?? '',
      text: note?.text ?? '',
    },
  });
  const format = form.watch('format');
  const fill = (s?: string) => (s ?? '').replace(/\{\{\s*patient\.name\s*\}\}/g, patient.fullName);
  const applyTemplate = (id: string) => {
    const tpl = (templates.data ?? []).find((x) => x.id === id);
    if (!tpl) return;
    form.reset(
      {
        format: tpl.format,
        subjective: fill(tpl.content?.subjective),
        objective: fill(tpl.content?.objective),
        assessment: fill(tpl.content?.assessment),
        plan: fill(tpl.content?.plan),
        text: fill(tpl.text),
      },
      { keepDefaultValues: true },
    );
  };
  const onSubmit = async (v: NoteValues) => {
    const body =
      v.format === 'free'
        ? { text: v.text }
        : { content: Object.fromEntries(SOAP.map((k) => [k, v[k] ?? ''])) };
    if (note && amend) await muts.amend.mutateAsync({ id: note.id, ...body });
    else if (note) await muts.update.mutateAsync({ id: note.id, version: note.version, ...body });
    else await muts.create.mutateAsync({ format: v.format, ...body });
    notify.success(t('notes.saved'));
    onDone();
  };
  return (
    <Card variant="outlined" sx={{ borderColor: 'primary.main' }}>
      <CardContent>
        <Form form={form} name="clinical.note" id="note-form" onSubmit={onSubmit}>
          <Stack spacing={3}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              justifyContent="space-between"
            >
              <Typography variant="h6">
                {amend ? t('notes.amendTitle') : note ? t('notes.edit') : t('notes.new')}
              </Typography>
              <Stack direction="row" spacing={2}>
                {!note && (templates.data ?? []).length > 0 && (
                  <TextField
                    select
                    size="small"
                    label={t('notes.template')}
                    value=""
                    onChange={(e) => applyTemplate(e.target.value)}
                    sx={{ minWidth: 200 }}
                  >
                    {(templates.data ?? [])
                      .filter((x) => x.isActive)
                      .map((x) => (
                        <MenuItem key={x.id} value={x.id}>
                          {x.name}
                        </MenuItem>
                      ))}
                  </TextField>
                )}
                {!note && (
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={format}
                    onChange={(_e, v: 'soap' | 'free' | null) => v && form.setValue('format', v)}
                  >
                    <ToggleButton value="soap">{t('notes.soapFormat')}</ToggleButton>
                    <ToggleButton value="free">{t('notes.freeFormat')}</ToggleButton>
                  </ToggleButtonGroup>
                )}
              </Stack>
            </Stack>
            {format === 'free' ? (
              <RHFTextField
                name="text"
                label={t('notes.text')}
                multiline
                minRows={6}
                maxLength={10000}
                required
              />
            ) : (
              <Grid container spacing={3}>
                {SOAP.map((k) => (
                  <Grid item xs={12} md={6} key={k}>
                    <RHFTextField
                      name={k}
                      label={t(`notes.soap.${k}`)}
                      multiline
                      minRows={3}
                      maxLength={5000}
                    />
                  </Grid>
                ))}
              </Grid>
            )}
            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Button onClick={onDone}>{tc('actions.cancel')}</Button>
              <Button
                type="submit"
                variant="contained"
                startIcon={<Save size={16} />}
                disabled={form.formState.isSubmitting}
              >
                {tc('actions.save')}
              </Button>
            </Stack>
          </Stack>
        </Form>
      </CardContent>
    </Card>
  );
}

/* ---------------- perio (07 §6) ---------------- */

const SITES_B = ['DB', 'B', 'MB'];
const SITES_L = ['DL', 'L', 'ML'];
const blankTooth = (): PerioTooth => ({
  pocketDepth: [0, 0, 0, 0, 0, 0],
  recession: [0, 0, 0, 0, 0, 0],
  bleeding: Array(6).fill(false) as boolean[],
  suppuration: Array(6).fill(false) as boolean[],
  mobility: 0,
  furcation: 0,
});

export function PerioTab() {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const exams = usePerio(patient.id);
  const muts = usePerioMutations(patient.id);
  const notify = useNotify();
  const { can } = usePermission();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const list = useMemo(() => exams.data ?? [], [exams.data]);
  const current =
    selected === 'new' ? null : (list.find((e) => e.id === selected) ?? list[0] ?? null);
  const [teeth, setTeeth] = useState<Record<string, PerioTooth>>({});
  const [date, setDate] = useState(todayLocal());
  useEffect(() => {
    setTeeth(current ? structuredClone(current.teeth) : {});
    setDate(current?.examDate ?? todayLocal());
  }, [current]);
  const editable = can('clinical.perio.write') && (selected === 'new' || current !== null);
  const previous = current ? list[list.indexOf(current) + 1] : list[0];

  const save = async () => {
    if (selected === 'new' || !current) {
      const created = await muts.create.mutateAsync({ examDate: date, teeth });
      setSelected(created.id);
    } else
      await muts.update.mutateAsync({
        id: current.id,
        version: current.version,
        teeth,
        examDate: date,
      });
    notify.success(t('perio.saved'));
  };

  if (exams.isLoading) return <PageSkeleton rows={5} />;
  if (exams.error) return <ErrorState error={exams.error} onRetry={() => void exams.refetch()} />;

  return (
    <Stack spacing={4}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
        <Typography variant="h5">{t('perio.title')}</Typography>
        <Stack direction="row" spacing={2}>
          {list.length > 0 && (
            <TextField
              select
              size="small"
              label={t('perio.exam')}
              value={selected ?? current?.id ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              {list.map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {formatDate(e.examDate, i18n.language)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {can('clinical.perio.write') && (
            <Button
              variant="outlined"
              startIcon={<Plus size={16} />}
              onClick={() => setSelected('new')}
            >
              {t('perio.new')}
            </Button>
          )}
        </Stack>
      </Stack>
      {!current && selected !== 'new' ? (
        <EmptyState title={t('perio.empty')} description={t('perio.emptyHint')} />
      ) : (
        <>
          <Summary exam={current} teeth={teeth} previous={previous} />
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
                <TextField
                  type="date"
                  size="small"
                  label={t('perio.date')}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ dir: 'ltr' }}
                  disabled={!editable}
                />
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {t('perio.keyboardHint')}
                </Typography>
                {editable && (
                  <Button
                    variant="contained"
                    startIcon={<Save size={16} />}
                    onClick={() => void save().catch(notify.error)}
                    disabled={muts.create.isPending || muts.update.isPending}
                  >
                    {t('perio.save')}
                  </Button>
                )}
              </Stack>
              <PerioGrid teeth={teeth} setTeeth={setTeeth} editable={editable} />
            </CardContent>
          </Card>
        </>
      )}
    </Stack>
  );
}

function stats(teeth: Record<string, PerioTooth>) {
  const sites = Object.values(teeth)
    .filter((x) => !x.missing)
    .flatMap((x) =>
      x.pocketDepth.map((pd, i) => ({ pd, bop: x.bleeding[i], cal: pd + (x.recession[i] ?? 0) })),
    );
  const n = sites.length || 1;
  return {
    sites: sites.length,
    bop: Math.round((sites.filter((s) => s.bop).length / n) * 1000) / 10,
    s4: sites.filter((s) => s.pd >= 4).length,
    s6: sites.filter((s) => s.pd >= 6).length,
    cal: Math.round((sites.reduce((a, s) => a + s.cal, 0) / n) * 10) / 10,
  };
}

function Summary({
  teeth,
  previous,
}: {
  exam: PerioExam | null;
  teeth: Record<string, PerioTooth>;
  previous?: PerioExam;
}) {
  const { t } = useTranslation('clinical');
  const s = stats(teeth);
  const p = previous ? stats(previous.teeth) : null;
  const delta = (a: number, b?: number) =>
    b === undefined ? '' : ` (${a - b > 0 ? '+' : ''}${Math.round((a - b) * 10) / 10})`;
  const items = [
    { k: 'bop', v: `${s.bop}%${delta(s.bop, p?.bop)}` },
    { k: 'sites4', v: `${s.s4}${delta(s.s4, p?.s4)}` },
    { k: 'sites6', v: `${s.s6}${delta(s.s6, p?.s6)}` },
    { k: 'meanCal', v: `${s.cal}${delta(s.cal, p?.cal)}` },
  ];
  return (
    <Grid container spacing={3}>
      {items.map((i) => (
        <Grid item xs={6} md={3} key={i.k}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary">
                {t(`perio.stats.${i.k}`)}
              </Typography>
              <Typography variant="h5" dir="ltr" sx={{ textAlign: 'start' }}>
                {i.v}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      ))}
      {p && (
        <Grid item xs={12}>
          <Typography variant="caption" color="text.secondary">
            {t('perio.comparedTo')}
          </Typography>
        </Grid>
      )}
    </Grid>
  );
}

/** 6 sites per tooth; typing a digit fills the depth and jumps to the next site (07 §6). */
function PerioGrid({
  teeth,
  setTeeth,
  editable,
}: {
  teeth: Record<string, PerioTooth>;
  setTeeth: (fn: (t: Record<string, PerioTooth>) => Record<string, PerioTooth>) => void;
  editable: boolean;
}) {
  const { t } = useTranslation('clinical');
  const theme = useTheme();
  const refs = useRef<Map<string, HTMLInputElement>>(new Map());
  const order = useMemo(
    () =>
      [...UPPER_PERMANENT, ...LOWER_PERMANENT].flatMap((n) =>
        [0, 1, 2, 3, 4, 5].map((s) => `${n}:${s}`),
      ),
    [],
  );
  const update = (tooth: number, fn: (x: PerioTooth) => void) =>
    setTeeth((cur) => {
      const next = { ...cur };
      const x = structuredClone(next[String(tooth)] ?? blankTooth());
      fn(x);
      next[String(tooth)] = x;
      return next;
    });
  const focusNext = (key: string) => {
    const i = order.indexOf(key);
    refs.current.get(order[i + 1] ?? '')?.focus();
  };
  const cell = (tooth: number, site: number) => {
    const x = teeth[String(tooth)];
    const pd = x?.pocketDepth[site] ?? 0;
    const bop = x?.bleeding[site] ?? false;
    const key = `${tooth}:${site}`;
    return (
      <Box key={site} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <input
          ref={(el) => {
            if (el) refs.current.set(key, el);
          }}
          aria-label={t('perio.siteLabel', {
            tooth,
            site: site < 3 ? SITES_B[site] : SITES_L[site - 3],
          })}
          value={pd || ''}
          disabled={!editable || x?.missing}
          inputMode="numeric"
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, '').slice(-2);
            const v = Math.min(20, Number(d || 0));
            update(tooth, (y) => {
              y.pocketDepth[site] = v;
            });
            if (d.length === 1 && v < 10) focusNext(key);
          }}
          onKeyDown={(e) => {
            if (e.key === 'b' || e.key === 'B') {
              e.preventDefault();
              update(tooth, (y) => {
                y.bleeding[site] = !y.bleeding[site];
              });
            }
          }}
          style={{
            width: 22,
            height: 22,
            textAlign: 'center',
            fontSize: 12,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 4,
            background:
              pd >= 6
                ? alpha(theme.palette.error.main, 0.25)
                : pd >= 4
                  ? alpha(theme.palette.warning.main, 0.25)
                  : theme.palette.background.paper,
            color: theme.palette.text.primary,
          }}
        />
        <Box
          role="checkbox"
          aria-checked={bop}
          aria-label={t('perio.bleeding')}
          tabIndex={-1}
          onClick={() =>
            editable &&
            update(tooth, (y) => {
              y.bleeding[site] = !y.bleeding[site];
            })
          }
          sx={{
            width: 10,
            height: 10,
            mt: 0.5,
            borderRadius: '50%',
            cursor: editable ? 'pointer' : 'default',
            bgcolor: bop ? 'error.main' : 'transparent',
            border: 1,
            borderColor: bop ? 'error.main' : 'divider',
          }}
        />
      </Box>
    );
  };
  const row = (list: number[], label: string) => (
    <TableRow>
      <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</TableCell>
      {list.map((n) => (
        <TableCell key={n} sx={{ px: 0.5, opacity: teeth[String(n)]?.missing ? 0.4 : 1 }}>
          <Stack spacing={0.5} alignItems="center">
            <Typography variant="caption" fontWeight={700}>
              {n}
            </Typography>
            <Stack direction="row" spacing={0.25}>
              {[0, 1, 2].map((s) => cell(n, s))}
            </Stack>
            <Stack direction="row" spacing={0.25}>
              {[3, 4, 5].map((s) => cell(n, s))}
            </Stack>
            {editable && (
              <Chip
                size="small"
                variant="outlined"
                label={
                  teeth[String(n)]?.missing
                    ? t('perio.missing')
                    : `M${teeth[String(n)]?.mobility ?? 0}`
                }
                onClick={() =>
                  update(n, (y) => {
                    if (y.missing) {
                      y.missing = false;
                      y.mobility = 0;
                    } else if (y.mobility >= 3) y.missing = true;
                    else y.mobility += 1;
                  })
                }
                sx={{ height: 18, fontSize: 10 }}
              />
            )}
          </Stack>
        </TableCell>
      ))}
    </TableRow>
  );
  return (
    <Box dir="ltr" sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td': { borderBottom: 0 } }}>
        <TableHead>
          <TableRow>
            <TableCell colSpan={17}>
              <Typography variant="caption" color="text.secondary">
                {t('perio.legend')}
              </Typography>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {row(UPPER_PERMANENT, t('perio.upper'))}
          {row(LOWER_PERMANENT, t('perio.lower'))}
        </TableBody>
      </Table>
    </Box>
  );
}
