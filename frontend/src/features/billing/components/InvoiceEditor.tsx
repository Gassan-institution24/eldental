import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Divider,
  Grid,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Controller, useFieldArray, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { taxRatesApi } from '@/features/clinic-settings/api';
import { useProcedureLookup } from '@/features/clinical/components/shared';
import { usePolicies } from '@/features/patients/api/patients';
import { PatientPicker } from '@/features/patients/components/PatientPicker';
import { dateOnly, freeText, objectId, optional } from '@/shared/generated/validation/fields';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { MoneyText, useCurrency } from '@/shared/components/MoneyText';
import { Form } from '@/shared/form/Form';
import { RHFDate, RHFMoney } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useNotify } from '@/shared/hooks/useNotify';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { usePermission } from '@/shared/rbac/usePermission';
import { useInvoiceMutations, type Invoice } from '../api';

const amount = z
  .number({ invalid_type_error: 'invalid_amount' })
  .int({ message: 'too_many_decimals' })
  .min(0, { message: 'invalid_amount' });
const lineSchema = z
  .object({
    id: optional(objectId()),
    performedProcedureId: optional(objectId()),
    clinicProcedureId: optional(objectId()),
    description: optional(freeText(200)),
    quantity: z.coerce
      .number({ invalid_type_error: 'invalid_type' })
      .int({ message: 'invalid_quantity' })
      .min(1, { message: 'too_small' })
      .max(100, { message: 'too_big' }),
    unitPrice: amount,
    discount: amount,
    taxRateId: optional(objectId()),
  })
  .superRefine((l, ctx) => {
    if (!l.clinicProcedureId && !l.performedProcedureId && !l.description)
      ctx.addIssue({ code: 'custom', path: ['description'], message: 'required' });
    if (l.discount > l.unitPrice * (Number(l.quantity) || 1))
      ctx.addIssue({ code: 'custom', path: ['discount'], message: 'exceeds_line' });
  });
const schema = z.object({
  patient: z
    .object({ id: objectId(), fullName: z.string() })
    .nullable()
    .refine((v) => v !== null, { message: 'required' }),
  insurancePolicyId: optional(objectId()),
  dueDate: optional(dateOnly()),
  invoiceDiscount: amount,
  discountReason: optional(freeText(200)),
  notes: optional(freeText(1000)),
  lines: z.array(lineSchema).min(1, { message: 'too_few' }).max(100),
});
type Values = z.input<typeof schema>;

/** New/edit draft invoice (09 §3.1). Totals are recomputed by the server on save. */
export function InvoiceEditor({
  invoice,
  patient,
  onClose,
}: {
  invoice?: Invoice;
  patient?: { id: string; fullName: string };
  onClose: () => void;
}) {
  const { t } = useTranslation('billing');
  const notify = useNotify();
  const navigate = useNavigate();
  const { can } = usePermission();
  const currency = useCurrency();
  const muts = useInvoiceMutations();
  const procs = useProcedureLookup();
  const taxes = taxRatesApi.useAll();
  const taxName = useSeedName('taxRate');
  const canPrice = can('billing.invoice.discount');
  const form = useAppForm<Values>({
    schema,
    defaultValues: {
      patient: invoice
        ? { id: invoice.patientId, fullName: invoice.patient?.fullName ?? '' }
        : (patient ?? null),
      insurancePolicyId: invoice?.insurancePolicyId ?? '',
      dueDate: invoice?.dueDate ?? '',
      invoiceDiscount: invoice?.invoiceDiscount ?? 0,
      discountReason: invoice?.discountReason ?? '',
      notes: invoice?.notes ?? '',
      lines: invoice?.lines.map((l) => ({
        id: l.id,
        performedProcedureId: l.performedProcedureId ?? '',
        clinicProcedureId: l.clinicProcedureId ?? '',
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: invoice.invoiceDiscount ? 0 : l.discount,
        taxRateId: l.taxRateId ?? '',
      })) ?? [
        {
          clinicProcedureId: '',
          description: '',
          quantity: 1,
          unitPrice: 0,
          discount: 0,
          taxRateId: '',
        },
      ],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  const chosen = useWatch({ control: form.control, name: 'patient' });
  const policies = usePolicies(chosen?.id ?? '');
  const invoiceDiscount = useWatch({ control: form.control, name: 'invoiceDiscount' });
  const estimate = useMemo(
    () =>
      (lines ?? []).reduce(
        (s, l) =>
          s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 0) - (Number(l.discount) || 0),
        0,
      ) - (Number(invoiceDiscount) || 0),
    [lines, invoiceDiscount],
  );

  const onSubmit = async (raw: Values) => {
    const v = raw as z.output<typeof schema>;
    const body = {
      insurancePolicyId: v.insurancePolicyId || null,
      ...(v.dueDate ? { dueDate: v.dueDate } : {}),
      invoiceDiscount: v.invoiceDiscount,
      discountReason: v.discountReason ?? '',
      notes: v.notes ?? '',
      lines: v.lines.map((l) => ({
        ...(l.id ? { id: l.id } : {}),
        ...(l.performedProcedureId ? { performedProcedureId: l.performedProcedureId } : {}),
        ...(l.clinicProcedureId ? { clinicProcedureId: l.clinicProcedureId } : {}),
        ...(l.description ? { description: l.description } : {}),
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRateId: l.taxRateId || null,
      })),
    };
    const saved = invoice
      ? await muts.update.mutateAsync({ id: invoice.id, version: invoice.version, ...body })
      : await muts.create.mutateAsync({ patientId: v.patient!.id, ...body });
    notify.success(t('invoices.saved'));
    onClose();
    if (!invoice) navigate(`/clinic/billing/invoices/${saved.id}`);
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={invoice ? t('invoices.editDraft') : t('invoices.new')}
      subtitle={t('invoices.editorHint')}
      formId="invoice-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      width={900}
    >
      <Form form={form} name="billing.invoice" id="invoice-form" onSubmit={onSubmit}>
        <Stack spacing={4}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <Controller
                name="patient"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Box data-field="patient">
                    <PatientPicker
                      name="patient"
                      value={field.value ?? null}
                      onChange={field.onChange}
                      required
                      error={Boolean(fieldState.error)}
                      helperText={fieldState.error ? t('invoices.patientRequired') : undefined}
                    />
                  </Box>
                )}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <RHFSelect
                name="insurancePolicyId"
                label={t('invoices.policy')}
                clearable
                options={(policies.data ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.insuranceCompanyName} · ${p.memberNumber}`,
                }))}
                disabled={!chosen}
              />
            </Grid>
          </Grid>
          <Divider />
          {fields.map((f, i) => {
            const proc = procs.byId.get(String(lines?.[i]?.clinicProcedureId ?? ''));
            const locked = Boolean(lines?.[i]?.performedProcedureId);
            return (
              <Box key={f.id} sx={{ p: 3, border: 1, borderColor: 'divider', borderRadius: 2 }}>
                <Grid container spacing={2} alignItems="flex-start">
                  <Grid item xs={12} md={5}>
                    <Controller
                      name={`lines.${i}.clinicProcedureId`}
                      control={form.control}
                      render={({ field }) => (
                        <Autocomplete
                          size="small"
                          options={procs.items}
                          value={procs.byId.get(String(field.value ?? '')) ?? null}
                          disabled={locked}
                          onChange={(_e, v) => {
                            field.onChange(v?.id ?? '');
                            if (v) {
                              form.setValue(`lines.${i}.unitPrice`, v.price, { shouldDirty: true });
                              if (v.taxRateId) form.setValue(`lines.${i}.taxRateId`, v.taxRateId);
                            }
                          }}
                          getOptionLabel={(o) => procs.label(o)}
                          renderInput={(p) => (
                            <TextField
                              {...p}
                              label={t('invoices.procedure')}
                              helperText={locked ? t('invoices.fromVisit') : undefined}
                            />
                          )}
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={7}>
                    <RHFTextField
                      name={`lines.${i}.description`}
                      label={proc ? t('invoices.descriptionOptional') : t('invoices.description')}
                      size="small"
                      maxLength={200}
                    />
                  </Grid>
                  <Grid item xs={4} md={1.5}>
                    <RHFTextField
                      name={`lines.${i}.quantity`}
                      label={t('invoices.qty')}
                      type="number"
                      size="small"
                      inputProps={{ dir: 'ltr', min: 1 }}
                      disabled={locked}
                    />
                  </Grid>
                  <Grid item xs={8} md={3}>
                    <RHFMoney
                      currency={currency}
                      name={`lines.${i}.unitPrice`}
                      label={t('invoices.unitPrice')}
                      disabled={(Boolean(proc) || locked) && !canPrice}
                    />
                  </Grid>
                  <Grid item xs={6} md={3}>
                    <RHFMoney
                      currency={currency}
                      name={`lines.${i}.discount`}
                      label={t('invoices.discount')}
                    />
                  </Grid>
                  <Grid item xs={6} md={3.5}>
                    <RHFSelect
                      name={`lines.${i}.taxRateId`}
                      label={t('invoices.tax')}
                      clearable
                      options={(taxes.data ?? [])
                        .filter((x) => x.isActive)
                        .map((x) => ({ value: x.id, label: `${taxName(x)} (${x.rate / 100}%)` }))}
                    />
                  </Grid>
                  <Grid item xs={12} md={1} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <IconButton
                      aria-label={t('invoices.removeLine')}
                      onClick={() => remove(i)}
                      disabled={fields.length === 1}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </Grid>
                </Grid>
              </Box>
            );
          })}
          <Button
            variant="outlined"
            startIcon={<Plus size={16} />}
            onClick={() =>
              append({
                clinicProcedureId: '',
                description: '',
                quantity: 1,
                unitPrice: 0,
                discount: 0,
                taxRateId: '',
              })
            }
            sx={{ alignSelf: 'flex-start' }}
          >
            {t('invoices.addLine')}
          </Button>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <RHFMoney
                currency={currency}
                name="invoiceDiscount"
                label={t('invoices.invoiceDiscount')}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFTextField
                name="discountReason"
                label={t('invoices.discountReason')}
                maxLength={200}
              />
            </Grid>
            <Grid item xs={12} md={4}>
              <RHFDate name="dueDate" label={t('invoices.dueDate')} />
            </Grid>
          </Grid>
          <RHFTextField
            name="notes"
            label={t('invoices.notes')}
            multiline
            minRows={2}
            maxLength={1000}
          />
          {!canPrice && <Alert severity="info">{t('invoices.discountLimitHint')}</Alert>}
          <Stack direction="row" justifyContent="flex-end" spacing={2} alignItems="baseline">
            <Typography variant="body2" color="text.secondary">
              {t('invoices.estimate')}
            </Typography>
            <Typography variant="h5">
              <MoneyText value={Math.max(0, estimate)} />
            </Typography>
          </Stack>
        </Stack>
      </Form>
    </FormDrawer>
  );
}
