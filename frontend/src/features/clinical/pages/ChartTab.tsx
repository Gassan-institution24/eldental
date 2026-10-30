import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { ClipboardPlus, Stethoscope, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClinicProcedure } from '@/features/clinic-settings/api';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { formatDateTime } from '@/lib/dates';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { MoneyText } from '@/shared/components/MoneyText';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  useChart,
  useChartMutations,
  usePlanMutations,
  usePlans,
  useProcedureMutations,
  useProcedures,
  type EntryKind,
} from '../api';
import { useConditionColors, useProcedureLookup } from '../components/shared';
import { isAnterior, ToothChart } from '../components/ToothChart';

const LAYERS: EntryKind[] = ['existing', 'finding', 'planned', 'completed'];

/** Patient workspace → Chart (07 §2). */
export function ChartTab() {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const chart = useChart(patient.id);
  const { colors, list: conditionDefs, name: conditionName } = useConditionColors();
  const muts = useChartMutations(patient.id);
  const [layers, setLayers] = useState<Set<EntryKind>>(new Set(LAYERS));
  const [tooth, setTooth] = useState<number | null>(null);
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const { can } = usePermission();

  const selectTooth = (n: number) => {
    if (n !== tooth) setSurfaces([]);
    setTooth(n);
  };
  const toggleSurface = (n: number, s: string) => {
    if (n !== tooth) return setSurfaces([s]);
    setSurfaces((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };

  if (chart.isLoading) return <PageSkeleton rows={6} />;
  if (chart.error || !chart.data)
    return <ErrorState error={chart.error} onRetry={() => void chart.refetch()} />;
  const data = chart.data;

  return (
    <Stack spacing={5}>
      <Card variant="outlined">
        <CardContent>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={3}
            justifyContent="space-between"
            alignItems={{ md: 'center' }}
            sx={{ mb: 3 }}
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {LAYERS.map((l) => {
                const on = layers.has(l);
                return (
                  <Chip
                    key={l}
                    label={t(`kinds.${l}`)}
                    color={on ? 'primary' : 'default'}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() =>
                      setLayers((cur) => {
                        const next = new Set(cur);
                        if (next.has(l)) next.delete(l);
                        else next.add(l);
                        return next;
                      })
                    }
                  />
                );
              })}
            </Stack>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={data.dentition}
              disabled={!can('clinical.chart.update') || muts.dentition.isPending}
              onChange={(_e, v: string | null) => v && muts.dentition.mutate(v)}
            >
              {(['permanent', 'mixed', 'primary'] as const).map((d) => (
                <ToggleButton key={d} value={d}>
                  {t(`dentition.${d}`)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
          <ToothChart
            teeth={data.teeth}
            colors={colors}
            layers={layers}
            dentition={data.dentition}
            selectedTooth={tooth}
            selectedSurfaces={surfaces}
            onTooth={selectTooth}
            onSurface={toggleSurface}
          />
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 3 }}>
            {conditionDefs.map((c) => (
              <Stack key={c.code} direction="row" spacing={0.75} alignItems="center">
                <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: c.color }} />
                <Typography variant="caption" color="text.secondary">
                  {conditionName(c.code)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <Grid container spacing={4}>
        <Grid item xs={12} lg={5}>
          {tooth ? (
            <ToothPanel tooth={tooth} surfaces={surfaces} setSurfaces={setSurfaces} />
          ) : (
            <Card variant="outlined" sx={{ height: '100%' }}>
              <EmptyState
                compact
                icon={<Stethoscope size={28} />}
                title={t('chart.pickTooth')}
                description={t('chart.pickToothHint')}
              />
            </Card>
          )}
        </Grid>
        <Grid item xs={12} lg={7}>
          <ProceduresCard />
        </Grid>
      </Grid>
      <Typography variant="caption" color="text.secondary">
        {t('chart.orientation')} · {formatDateTime(new Date(), i18n.language)}
      </Typography>
    </Stack>
  );
}

function ToothPanel({
  tooth,
  surfaces,
  setSurfaces,
}: {
  tooth: number;
  surfaces: string[];
  setSurfaces: (s: string[]) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const notify = useNotify();
  const confirm = useConfirm();
  const { can } = usePermission();
  const chart = useChart(patient.id);
  const muts = useChartMutations(patient.id);
  const procMuts = useProcedureMutations(patient.id);
  const planMuts = usePlanMutations(patient.id);
  const plans = usePlans(patient.id);
  const { list: conditionDefs, name: conditionName } = useConditionColors();
  const procs = useProcedureLookup();
  const [tab, setTab] = useState<'finding' | 'procedure' | 'plan'>(
    can('clinical.chart.update') ? 'finding' : 'procedure',
  );
  const [condition, setCondition] = useState('caries');
  const [kind, setKind] = useState<'finding' | 'existing'>('finding');
  const [notes, setNotes] = useState('');
  const [proc, setProc] = useState<ClinicProcedure | null>(null);
  const [planId, setPlanId] = useState<string>('new');

  const state = chart.data?.teeth[String(tooth)];
  const history = (chart.data?.entries ?? []).filter((e) => e.toothNumber === tooth);
  const allowed = isAnterior(tooth)
    ? ['M', 'D', 'I', 'F', 'L', 'P']
    : ['M', 'D', 'O', 'B', 'L', 'P'];
  const drafts = (plans.data ?? []).filter((p) => p.status === 'draft');
  const surfaceDef = conditionDefs.find((c) => c.code === condition);

  const addFinding = async () => {
    const isStatus = condition === 'missing' || condition === 'implant';
    await muts.addEntry.mutateAsync({
      toothNumber: tooth,
      surfaces: surfaceDef?.appliesTo === 'surface' ? surfaces : [],
      kind,
      ...(isStatus ? { setStatus: condition } : { conditionCode: condition }),
      ...(notes ? { notes } : {}),
    });
    notify.success(t('chart.saved'));
    setNotes('');
    setSurfaces([]);
  };

  const record = async () => {
    if (!proc) return;
    await procMuts.perform.mutateAsync({
      clinicProcedureId: proc.id,
      toothNumbers: [tooth],
      surfaces: proc.surfacesRequired || surfaces.length ? surfaces : [],
    });
    notify.success(t('procedures.recorded'));
    setProc(null);
  };

  const addToPlan = async () => {
    if (!proc) return;
    const item = { clinicProcedureId: proc.id, toothNumbers: [tooth], surfaces };
    if (planId === 'new') await planMuts.create.mutateAsync({ items: [item] });
    else {
      const p = drafts.find((d) => d.id === planId)!;
      await planMuts.update.mutateAsync({
        id: p.id,
        version: p.version,
        items: [
          ...p.items.map((i) => ({
            id: i.id,
            phaseIndex: i.phaseIndex,
            clinicProcedureId: i.clinicProcedureId,
            toothNumbers: i.toothNumbers,
            surfaces: i.surfaces,
            quantity: i.quantity,
            discount: i.discount,
            notes: i.notes,
          })),
          item,
        ],
      });
    }
    notify.success(t('plans.itemAdded'));
    setProc(null);
  };

  const run = (fn: () => Promise<void>) => () => void fn().catch(notify.error);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="h5">{t('chart.toothLabel', { n: tooth })}</Typography>
          <StatusChip
            status={state?.status ?? 'present'}
            label={t(`toothStatus.${state?.status ?? 'present'}`)}
          />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 3 }} flexWrap="wrap" useFlexGap>
          {allowed.map((s) => (
            <Chip
              key={s}
              label={t(`surfaces.${s}`)}
              size="small"
              color={surfaces.includes(s) ? 'primary' : 'default'}
              variant={surfaces.includes(s) ? 'filled' : 'outlined'}
              onClick={() =>
                setSurfaces(
                  surfaces.includes(s) ? surfaces.filter((x) => x !== s) : [...surfaces, s],
                )
              }
            />
          ))}
        </Stack>
        <Tabs
          value={tab}
          onChange={(_e, v: typeof tab) => setTab(v)}
          sx={{ mt: 3 }}
          variant="fullWidth"
        >
          {can('clinical.chart.update') && <Tab value="finding" label={t('chart.addFinding')} />}
          {can('clinical.procedure.perform') && (
            <Tab value="procedure" label={t('procedures.record')} />
          )}
          {can('clinical.treatmentPlan.create') && (
            <Tab value="plan" label={t('plans.addToPlan')} />
          )}
        </Tabs>
        <Box sx={{ pt: 3 }}>
          {tab === 'finding' && (
            <Stack spacing={3}>
              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  size="small"
                  label={t('chart.condition')}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  sx={{ flex: 1 }}
                >
                  {conditionDefs.map((c) => (
                    <MenuItem key={c.code} value={c.code}>
                      <Box
                        sx={{
                          width: 10,
                          height: 10,
                          borderRadius: 0.5,
                          bgcolor: c.color,
                          mr: 1.5,
                          display: 'inline-block',
                        }}
                      />
                      {conditionName(c.code)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label={t('chart.kind')}
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                  sx={{ width: 150 }}
                >
                  <MenuItem value="finding">{t('kinds.finding')}</MenuItem>
                  <MenuItem value="existing">{t('kinds.existing')}</MenuItem>
                </TextField>
              </Stack>
              {surfaceDef?.appliesTo === 'surface' && surfaces.length === 0 && (
                <Alert severity="info">{t('chart.pickSurfaces')}</Alert>
              )}
              <TextField
                size="small"
                label={t('chart.notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                inputProps={{ dir: 'auto' }}
              />
              <Button
                variant="contained"
                onClick={run(addFinding)}
                disabled={
                  muts.addEntry.isPending ||
                  (surfaceDef?.appliesTo === 'surface' && surfaces.length === 0)
                }
              >
                {t('chart.saveFinding')}
              </Button>
            </Stack>
          )}
          {(tab === 'procedure' || tab === 'plan') && (
            <Stack spacing={3}>
              <Autocomplete
                size="small"
                options={procs.items}
                value={proc}
                onChange={(_e, v) => setProc(v)}
                getOptionLabel={(o) => procs.label(o)}
                renderOption={(props, o) => {
                  const { key, ...rest } = props as typeof props & { key: string };
                  return (
                    <Box
                      component="li"
                      key={key}
                      {...rest}
                      sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
                    >
                      <span dir="auto">{procs.label(o)}</span>
                      <MoneyText value={o.price} />
                    </Box>
                  );
                }}
                renderInput={(p) => <TextField {...p} label={t('procedures.procedure')} />}
              />
              {proc?.surfacesRequired && surfaces.length === 0 && (
                <Alert severity="info">{t('chart.pickSurfaces')}</Alert>
              )}
              {tab === 'plan' && (
                <TextField
                  select
                  size="small"
                  label={t('plans.plan')}
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  <MenuItem value="new">{t('plans.newPlan')}</MenuItem>
                  {drafts.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.number} {p.title ? `· ${p.title}` : ''}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <Button
                variant="contained"
                startIcon={tab === 'plan' ? <ClipboardPlus size={16} /> : <Stethoscope size={16} />}
                onClick={run(tab === 'plan' ? addToPlan : record)}
                disabled={
                  !proc ||
                  (proc.surfacesRequired && surfaces.length === 0) ||
                  procMuts.perform.isPending ||
                  planMuts.create.isPending ||
                  planMuts.update.isPending
                }
              >
                {tab === 'plan' ? t('plans.addToPlan') : t('procedures.recordDone')}
              </Button>
            </Stack>
          )}
        </Box>
        <Divider sx={{ my: 4 }} />
        <Typography variant="overline" color="text.secondary">
          {t('chart.history')}
        </Typography>
        {history.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('chart.noHistory')}
          </Typography>
        ) : (
          <Stack spacing={1.5} sx={{ mt: 1 }}>
            {history.map((e) => (
              <Stack
                key={e.id}
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ opacity: e.voided ? 0.5 : 1 }}
              >
                <Chip size="small" label={t(`kinds.${e.kind}`)} variant="outlined" />
                <Typography
                  variant="body2"
                  sx={{ flex: 1, textDecoration: e.voided ? 'line-through' : 'none' }}
                  dir="auto"
                >
                  {e.voidsEntryId
                    ? t('chart.voidNote', { reason: e.notes })
                    : `${e.conditionCode ? conditionName(e.conditionCode) : e.setStatus ? t(`toothStatus.${e.setStatus}`) : ''}${e.surfaces.length ? ` (${e.surfaces.join('')})` : ''}${e.notes ? ` — ${e.notes}` : ''}`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(e.at, i18n.language)}
                </Typography>
                {!e.voided &&
                  !e.voidsEntryId &&
                  (e.kind === 'finding' || e.kind === 'existing') &&
                  can('clinical.chart.update') && (
                    <Tooltip title={t('chart.void')}>
                      <IconButton
                        size="small"
                        aria-label={t('chart.void')}
                        onClick={async () => {
                          const r = await confirm({
                            title: t('chart.voidTitle'),
                            reason: { label: t('chart.voidReason'), required: true, max: 300 },
                            destructive: true,
                          });
                          if (r.confirmed)
                            await muts.voidEntry
                              .mutateAsync({ id: e.id, reason: r.reason ?? '' })
                              .then(() => notify.success(t('chart.voided')), notify.error);
                        }}
                      >
                        <Undo2 size={14} />
                      </IconButton>
                    </Tooltip>
                  )}
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function ProceduresCard() {
  const { t, i18n } = useTranslation('clinical');
  const { patient } = usePatientContext();
  const q = useProcedures(patient.id);
  const procs = useProcedureLookup();
  const muts = useProcedureMutations(patient.id);
  const confirm = useConfirm();
  const notify = useNotify();
  const { can } = usePermission();
  const rows = useMemo(() => q.data ?? [], [q.data]);
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="h5" sx={{ mb: 3 }}>
          {t('procedures.title')}
        </Typography>
        {q.isLoading ? (
          <PageSkeleton rows={3} />
        ) : q.error ? (
          <ErrorState error={q.error} compact onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState compact title={t('procedures.empty')} />
        ) : (
          <Stack divider={<Divider flexItem />} spacing={2}>
            {rows.map((p) => (
              <Stack
                key={p.id}
                direction="row"
                spacing={2}
                alignItems="center"
                sx={{ opacity: p.status === 'voided' ? 0.55 : 1 }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={650} noWrap dir="auto">
                    {procs.label(p.clinicProcedureId) || p.code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(p.performedAt, i18n.language)}
                    {p.toothNumbers.length
                      ? ` · ${t('procedures.teeth')}: ${p.toothNumbers.join(', ')}${p.surfaces.length ? ` (${p.surfaces.join('')})` : ''}`
                      : ''}
                  </Typography>
                </Box>
                <MoneyText value={p.unitPrice * p.quantity - p.discount} />
                {p.status === 'voided' ? (
                  <StatusChip status="void" label={t('procedures.voided')} />
                ) : (
                  can('clinical.procedure.void') && (
                    <Tooltip title={t('procedures.void')}>
                      <IconButton
                        size="small"
                        aria-label={t('procedures.void')}
                        onClick={async () => {
                          const r = await confirm({
                            title: t('procedures.voidTitle'),
                            body: t('procedures.voidBody'),
                            reason: { label: t('chart.voidReason'), required: true, max: 300 },
                            destructive: true,
                          });
                          if (r.confirmed)
                            await muts.void
                              .mutateAsync({ id: p.id, reason: r.reason ?? '' })
                              .then(() => notify.success(t('procedures.voidDone')), notify.error);
                        }}
                      >
                        <Undo2 size={16} />
                      </IconButton>
                    </Tooltip>
                  )
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
