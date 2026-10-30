import { Alert, Button, Chip, Grid, Stack } from '@mui/material';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PROCEDURE_CATEGORIES } from '@/features/clinic-settings/api';
import { entityName, freeText, optional, requiredText } from '@/shared/generated/validation/fields';
import { DataTable } from '@/shared/components/DataTable';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFCheckbox } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import {
  consentTemplatesApi,
  noteTemplatesApi,
  type ConsentTemplate,
  type NoteTemplate,
} from '../api';
import { Controller } from 'react-hook-form';

/* ---------------- consent templates (07 §10) ---------------- */

/** Shows template placeholders literally instead of letting i18next fill them in. */
const PH = {
  patient: { name: '{{patient.name}}', file: '{{patient.file}}' },
  date: '{{date}}',
  clinic: '{{clinic}}',
  procedure: '{{procedure}}',
  tooth: '{{tooth}}',
  risks: '{{risks}}',
};

const consentSchema = z.object({
  title: entityName({ max: 120 }),
  body: requiredText(20000),
  procedureCategories: z.array(z.string()),
  isActive: z.boolean(),
});
type ConsentValues = z.input<typeof consentSchema>;

export function ConsentTemplatesPage() {
  const { t } = useTranslation('clinical');
  const list = consentTemplatesApi.useAll({ includeInactive: 'true' });
  const [editing, setEditing] = useState<ConsentTemplate | 'new' | null>(null);
  return (
    <SectionCard
      title={t('templates.consentTitle')}
      subtitle={t('templates.consentSubtitle')}
      noPadding
      actions={
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={() => setEditing('new')}
        >
          {t('templates.add')}
        </Button>
      }
    >
      <DataTable<ConsentTemplate>
        clientSide
        searchable={false}
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState compact title={t('templates.empty')} />}
        columns={[
          { field: 'title', headerName: t('templates.name'), flex: 1, minWidth: 200 },
          {
            field: 'procedureCategories',
            headerName: t('templates.categories'),
            flex: 1,
            minWidth: 200,
            sortable: false,
            valueGetter: (_v, row) =>
              row.procedureCategories
                .map((c) => t(`category.${c}`, { ns: 'seed', defaultValue: c }))
                .join(', '),
          },
          {
            field: 'isActive',
            headerName: t('templates.status'),
            width: 120,
            renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} />,
          },
        ]}
      />
      {editing && (
        <ConsentTemplateDrawer
          tpl={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionCard>
  );
}

function ConsentTemplateDrawer({
  tpl,
  onClose,
}: {
  tpl: ConsentTemplate | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('clinical');
  const { t: ts } = useTranslation('seed');
  const notify = useNotify();
  const create = consentTemplatesApi.useCreate();
  const update = consentTemplatesApi.useUpdate();
  const form = useAppForm<ConsentValues>({
    schema: consentSchema,
    defaultValues: {
      title: tpl?.title ?? '',
      body: tpl?.body ?? t('templates.consentSample', PH),
      procedureCategories: tpl?.procedureCategories ?? [],
      isActive: tpl?.isActive ?? true,
    },
  });
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={tpl ? t('templates.edit') : t('templates.add')}
      formId="consent-tpl"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form
        form={form}
        name="clinical.consentTemplate"
        id="consent-tpl"
        onSubmit={async (v) => {
          if (tpl)
            await update.mutateAsync({
              id: tpl.id,
              version: tpl.version,
              ...(v as Partial<ConsentTemplate>),
            });
          else await create.mutateAsync(v as Partial<ConsentTemplate>);
          notify.success(t('templates.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFTextField name="title" label={t('templates.name')} required maxLength={120} />
          <Alert severity="info">{t('templates.placeholders', PH)}</Alert>
          <RHFTextField
            name="body"
            label={t('templates.body')}
            required
            multiline
            minRows={10}
            maxLength={20000}
          />
          <Controller
            name="procedureCategories"
            control={form.control}
            render={({ field }) => (
              <Stack spacing={1}>
                <span>{t('templates.requiredFor')}</span>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {PROCEDURE_CATEGORIES.map((c) => {
                    const on = field.value.includes(c);
                    return (
                      <Chip
                        key={c}
                        label={ts(`category.${c}`, { defaultValue: c })}
                        color={on ? 'primary' : 'default'}
                        variant={on ? 'filled' : 'outlined'}
                        onClick={() =>
                          field.onChange(
                            on ? field.value.filter((x) => x !== c) : [...field.value, c],
                          )
                        }
                      />
                    );
                  })}
                </Stack>
              </Stack>
            )}
          />
          <RHFCheckbox name="isActive" label={t('templates.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}

/* ---------------- note templates (07 §5) ---------------- */

const noteSchema = z.object({
  name: entityName({ max: 80 }),
  format: z.enum(['soap', 'free']),
  subjective: optional(freeText(5000)),
  objective: optional(freeText(5000)),
  assessment: optional(freeText(5000)),
  plan: optional(freeText(5000)),
  text: optional(freeText(10000)),
  isActive: z.boolean(),
});
type NoteValues = z.input<typeof noteSchema>;

export function NoteTemplatesPage() {
  const { t } = useTranslation('clinical');
  const list = noteTemplatesApi.useAll({ includeInactive: 'true' });
  const [editing, setEditing] = useState<NoteTemplate | 'new' | null>(null);
  return (
    <SectionCard
      title={t('templates.noteTitle')}
      subtitle={t('templates.noteSubtitle')}
      noPadding
      actions={
        <Button
          variant="contained"
          startIcon={<Plus size={18} />}
          onClick={() => setEditing('new')}
        >
          {t('templates.add')}
        </Button>
      }
    >
      <DataTable<NoteTemplate>
        clientSide
        searchable={false}
        rows={list.data ?? []}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => setEditing(r)}
        empty={<EmptyState compact title={t('templates.empty')} />}
        columns={[
          { field: 'name', headerName: t('templates.name'), flex: 1, minWidth: 200 },
          {
            field: 'format',
            headerName: t('templates.format'),
            width: 140,
            valueGetter: (_v, row) =>
              row.format === 'soap' ? t('notes.soapFormat') : t('notes.freeFormat'),
          },
          {
            field: 'isActive',
            headerName: t('templates.status'),
            width: 120,
            renderCell: ({ row }) => <StatusChip status={row.isActive ? 'active' : 'inactive'} />,
          },
        ]}
      />
      {editing && (
        <NoteTemplateDrawer
          tpl={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </SectionCard>
  );
}

function NoteTemplateDrawer({ tpl, onClose }: { tpl: NoteTemplate | null; onClose: () => void }) {
  const { t } = useTranslation('clinical');
  const notify = useNotify();
  const create = noteTemplatesApi.useCreate();
  const update = noteTemplatesApi.useUpdate();
  const form = useAppForm<NoteValues>({
    schema: noteSchema,
    defaultValues: {
      name: tpl?.name ?? '',
      format: tpl?.format ?? 'soap',
      subjective: tpl?.content?.subjective ?? '',
      objective: tpl?.content?.objective ?? '',
      assessment: tpl?.content?.assessment ?? '',
      plan: tpl?.content?.plan ?? '',
      text: tpl?.text ?? '',
      isActive: tpl?.isActive ?? true,
    },
  });
  const format = form.watch('format');
  return (
    <FormDrawer
      open
      onClose={onClose}
      title={tpl ? t('templates.edit') : t('templates.add')}
      formId="note-tpl"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={640}
    >
      <Form
        form={form}
        name="clinical.noteTemplate"
        id="note-tpl"
        onSubmit={async (v) => {
          const body = {
            name: v.name,
            format: v.format,
            isActive: v.isActive,
            ...(v.format === 'free'
              ? { text: v.text ?? '' }
              : {
                  content: {
                    subjective: v.subjective ?? '',
                    objective: v.objective ?? '',
                    assessment: v.assessment ?? '',
                    plan: v.plan ?? '',
                  },
                }),
          };
          if (tpl)
            await update.mutateAsync({
              id: tpl.id,
              version: tpl.version,
              ...(body as Partial<NoteTemplate>),
            });
          else await create.mutateAsync(body as Partial<NoteTemplate>);
          notify.success(t('templates.saved'));
          onClose();
        }}
      >
        <Stack spacing={4}>
          <RHFTextField name="name" label={t('templates.name')} required maxLength={80} />
          <RHFSelect
            name="format"
            label={t('templates.format')}
            options={[
              { value: 'soap', label: t('notes.soapFormat') },
              { value: 'free', label: t('notes.freeFormat') },
            ]}
          />
          <Alert severity="info">{t('templates.notePlaceholders', PH)}</Alert>
          {format === 'free' ? (
            <RHFTextField
              name="text"
              label={t('notes.text')}
              multiline
              minRows={8}
              maxLength={10000}
            />
          ) : (
            <Grid container spacing={3}>
              {(['subjective', 'objective', 'assessment', 'plan'] as const).map((k) => (
                <Grid item xs={12} key={k}>
                  <RHFTextField
                    name={k}
                    label={t(`notes.soap.${k}`)}
                    multiline
                    minRows={2}
                    maxLength={5000}
                  />
                </Grid>
              ))}
            </Grid>
          )}
          <RHFCheckbox name="isActive" label={t('templates.active')} asSwitch />
        </Stack>
      </Form>
    </FormDrawer>
  );
}
