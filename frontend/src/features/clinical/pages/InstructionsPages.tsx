import { Autocomplete, Box, Button, Card, Chip, Grid, Stack, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Plus, Printer, Sparkles } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Letterhead, PrintShell } from '@/features/billing/components/PrintDialogs';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { formatDate, formatDateTime } from '@/lib/dates';
import { instructionGiveBody, instructionTemplateBody } from '@/shared/generated/patients';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  fetchInstructionPrint,
  instructionTemplatesApi,
  useGiveInstruction,
  useInstructions,
  useInstructionSuggestions,
  type InstructionPrint,
  type InstructionTemplate,
} from '../documentsApi';

/** Seeded templates have no name/body until the clinic edits them: show them in the UI language. */
export function useInstructionText() {
  const { t } = useTranslation('seed');
  return useCallback(
    (tpl: Pick<InstructionTemplate, 'name' | 'body' | 'systemKey'>) => ({
      name: tpl.name ?? (tpl.systemKey ? t(`instruction.${tpl.systemKey}.name`, { defaultValue: tpl.systemKey }) : ''),
      body: tpl.body ?? (tpl.systemKey ? t(`instruction.${tpl.systemKey}.body`, { defaultValue: '' }) : ''),
    }),
    [t],
  );
}

/* ---------------- print ---------------- */

export function InstructionPrintDialog({
  id,
  onClose,
  fetcher = fetchInstructionPrint,
}: {
  id: string;
  onClose: () => void;
  fetcher?: (id: string) => Promise<InstructionPrint>;
}) {
  const { t, i18n } = useTranslation('documents');
  const q = useQuery({ queryKey: ['instruction-print', id], queryFn: () => fetcher(id) });
  const d = q.data;
  return (
    <PrintShell title={t('instructions.printTitle')} onClose={onClose} ready={Boolean(d)} error={q.error}>
      {d && (
        <Box data-testid="instruction-print">
          <Letterhead clinic={d.clinic} title={t('instructions.printTitle')} date={d.instruction.givenAt} />
          <Typography sx={{ mt: 3 }}>
            <b>{t('instructions.patient')}:</b> <span dir="auto">{d.patient.fullName}</span> · <span dir="ltr">{d.patient.fileNumber}</span>
          </Typography>
          <Typography variant="h5" sx={{ mt: 3 }} dir="auto">
            {d.instruction.title}
          </Typography>
          <Typography sx={{ mt: 2, whiteSpace: 'pre-wrap' }} dir="auto">
            {d.instruction.body}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 6 }}>
            {t('instructions.givenBy', { name: d.instruction.givenByName ?? '—', date: formatDate(d.instruction.givenAt, i18n.language) })}
          </Typography>
        </Box>
      )}
    </PrintShell>
  );
}

/* ---------------- patient tab ---------------- */

const giveSchema = instructionGiveBody();
type GiveValues = z.input<typeof giveSchema>;

function GiveDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('documents');
  const { patient: p } = usePatientContext();
  const notify = useNotify();
  const give = useGiveInstruction(p.id);
  const text = useInstructionText();
  const templates = instructionTemplatesApi.useAll();
  const suggestions = useInstructionSuggestions(p.id, true);
  const suggested = new Set(suggestions.data?.templateIds ?? []);
  const active = (templates.data ?? []).filter((x) => x.isActive);
  const ordered = [...active.filter((x) => suggested.has(x.id)), ...active.filter((x) => !suggested.has(x.id))];
  const form = useAppForm<GiveValues>({ schema: giveSchema, defaultValues: { templateId: '', title: '', body: '' } });

  const pick = (id: string) => {
    form.setValue('templateId', id, { shouldDirty: true });
    const tpl = active.find((x) => x.id === id);
    if (!tpl) return;
    const tx = text(tpl);
    form.setValue('title', tx.name, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
    form.setValue('body', tx.body, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('instructions.give')}
      subtitle={t('instructions.giveHint')}
      formId="instruction-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      submitLabel={t('instructions.giveAction')}
      width={640}
    >
      <Form
        form={form}
        name="clinical.instruction"
        id="instruction-form"
        onSubmit={async (v) => {
          await give.mutateAsync(v as unknown as Record<string, unknown>);
          notify.success(t('instructions.given'));
          onClose();
        }}
      >
        <Stack spacing={3}>
          {suggested.size > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('instructions.suggestedHint')}
              </Typography>
              <Stack direction="row" flexWrap="wrap" useFlexGap gap={1}>
                {ordered
                  .filter((x) => suggested.has(x.id))
                  .map((x) => (
                    <Chip key={x.id} color="primary" icon={<Sparkles size={14} />} label={text(x).name} onClick={() => pick(x.id)} data-testid={`suggested-${x.id}`} />
                  ))}
              </Stack>
            </Box>
          )}
          <Controller
            name="templateId"
            control={form.control}
            render={({ field }) => (
              <TextField
                select
                label={t('instructions.template')}
                value={(field.value as string | undefined) ?? ''}
                onChange={(e) => pick(e.target.value)}
                SelectProps={{ native: true }}
                InputLabelProps={{ shrink: true }}
                inputProps={{ 'data-testid': 'template-select' }}
              >
                <option value="">{t('instructions.noTemplate')}</option>
                {ordered.map((x) => (
                  <option key={x.id} value={x.id}>
                    {suggested.has(x.id) ? `★ ${text(x).name}` : text(x).name}
                  </option>
                ))}
              </TextField>
            )}
          />
          <RHFTextField name="title" label={t('instructions.title')} required maxLength={120} />
          <RHFTextField name="body" label={t('instructions.body')} required multiline minRows={8} maxLength={4000} />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

export function InstructionsTab() {
  const { t, i18n } = useTranslation('documents');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const canGive = can('clinical.instruction.give');
  const q = useInstructions(p.id);
  const [giving, setGiving] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);

  if (q.isLoading) return <PageSkeleton rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];

  return (
    <SectionCard
      title={t('instructions.tabTitle')}
      subtitle={t('instructions.hint')}
      actions={
        canGive && (
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setGiving(true)}>
            {t('instructions.give')}
          </Button>
        )
      }
    >
      {list.length === 0 ? (
        <EmptyState compact title={t('instructions.empty')} description={canGive ? t('instructions.emptyHint') : undefined} />
      ) : (
        <Stack spacing={2}>
          {list.map((i) => (
            <Card key={i.id} variant="outlined" sx={{ p: 3 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography fontWeight={650} dir="auto">
                    {i.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(i.givenAt, i18n.language)}
                    {i.givenByName ? ` · ${i.givenByName}` : ''}
                  </Typography>
                </Box>
                <Button size="small" startIcon={<Printer size={14} />} onClick={() => setPrinting(i.id)}>
                  {t('instructions.print')}
                </Button>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      {giving && <GiveDrawer onClose={() => setGiving(false)} />}
      {printing && <InstructionPrintDialog id={printing} onClose={() => setPrinting(null)} />}
    </SectionCard>
  );
}

/* ---------------- settings: templates ---------------- */

const templateSchema = instructionTemplateBody();
type TemplateValues = z.input<typeof templateSchema>;

function TemplateDrawer({ tpl, onClose }: { tpl: InstructionTemplate | null; onClose: () => void }) {
  const { t } = useTranslation('documents');
  const notify = useNotify();
  const text = useInstructionText();
  const create = instructionTemplatesApi.useCreate();
  const update = instructionTemplatesApi.useUpdate();
  const tx = tpl ? text(tpl) : { name: '', body: '' };
  const form = useAppForm<TemplateValues>({
    schema: templateSchema,
    defaultValues: { name: tx.name, body: tx.body, procedureCodes: tpl?.procedureCodes ?? [], isActive: tpl?.isActive ?? true },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={tpl ? t('instructions.editTemplate') : t('instructions.addTemplate')}
      subtitle={tpl?.systemKey && !tpl.name ? t('instructions.seededHint') : undefined}
      formId="instruction-tpl"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form
        form={form}
        name="clinical.instructionTemplate"
        id="instruction-tpl"
        onSubmit={async (v) => {
          const b = v as unknown as Record<string, unknown>;
          if (tpl) await update.mutateAsync({ id: tpl.id, version: tpl.version, ...b });
          else await create.mutateAsync(b);
          notify.success(t('instructions.templateSaved'));
          onClose();
        }}
      >
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <RHFTextField name="name" label={t('instructions.templateName')} required maxLength={120} />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField name="body" label={t('instructions.body')} required multiline minRows={8} maxLength={4000} />
          </Grid>
          <Grid item xs={12}>
            <Controller
              name="procedureCodes"
              control={form.control}
              render={({ field }) => (
                <Autocomplete
                  multiple
                  freeSolo
                  options={[]}
                  value={(field.value as string[] | undefined) ?? []}
                  onChange={(_e, v) => field.onChange(v.map((x) => String(x).trim().toUpperCase()).filter(Boolean))}
                  renderTags={(value, getTagProps) => value.map((code, i) => <Chip {...getTagProps({ index: i })} key={code} label={code} size="small" />)}
                  renderInput={(params) => (
                    <TextField {...params} label={t('instructions.procedureCodes')} helperText={t('instructions.procedureCodesHint')} inputProps={{ ...params.inputProps, dir: 'ltr' }} />
                  )}
                />
              )}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFCheckbox name="isActive" label={t('instructions.active')} />
          </Grid>
        </Grid>
      </Form>
    </FormDrawer>
  );
}

export function InstructionTemplatesPage() {
  const { t } = useTranslation('documents');
  const text = useInstructionText();
  const list = instructionTemplatesApi.useAll({ includeInactive: 'true' });
  const [editing, setEditing] = useState<InstructionTemplate | 'new' | null>(null);
  return (
    <SectionCard
      title={t('instructions.templatesTitle')}
      subtitle={t('instructions.templatesHint')}
      noPadding
      actions={
        <Button variant="contained" startIcon={<Plus size={18} />} onClick={() => setEditing('new')}>
          {t('instructions.addTemplate')}
        </Button>
      }
    >
      <DataTable<InstructionTemplate & { id: string }>
        clientSide
        searchable={false}
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState compact title={t('instructions.templatesEmpty')} />}
        columns={[
          { field: 'name', headerName: t('instructions.templateName'), flex: 1, minWidth: 200, valueGetter: (_v, row) => text(row).name },
          {
            field: 'procedureCodes',
            headerName: t('instructions.procedureCodes'),
            flex: 1,
            minWidth: 200,
            sortable: false,
            valueGetter: (_v, row) => row.procedureCodes.join(', '),
          },
          { field: 'isActive', headerName: t('instructions.status'), width: 120, renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} /> },
        ]}
      />
      {editing && <TemplateDrawer tpl={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </SectionCard>
  );
}

