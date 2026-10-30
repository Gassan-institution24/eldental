import { Alert, AlertTitle, Box, Link, List, ListItem, Typography } from '@mui/material';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FormProvider,
  type FieldErrors,
  type FieldValues,
  type UseFormReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useBlocker } from 'react-router-dom';
import { getErrorMessage, isApiError } from '@/lib/api/apiError';
import { reportIssue } from '@/lib/telemetry';
import { useConfirm } from '../components/ConfirmDialog';
import { applyServerErrors } from './applyServerErrors';
import { decodeError } from './resolver';
import { FieldLabelsContext, useFieldLabelRegistry } from './fieldLabels';

type Props<T extends FieldValues> = {
  form: UseFormReturn<T>;
  /** Stable form name for telemetry (`patient.create`). */
  name: string;
  onSubmit: (values: T) => Promise<unknown> | unknown;
  children: ReactNode;
  /** Show the "* required" legend (long forms). */
  requiredLegend?: boolean;
  /** Warn before leaving with unsaved changes. */
  guardUnsaved?: boolean;
  id?: string;
};

type Flat = { path: string; code: string };

function flatten(errors: FieldErrors, prefix = ''): Flat[] {
  const out: Flat[] = [];
  for (const [k, v] of Object.entries(errors)) {
    if (!v || typeof v !== 'object') continue;
    const path = prefix ? `${prefix}.${k}` : k;
    const e = v as { message?: string; type?: string };
    if (typeof e.message === 'string' || typeof e.type === 'string') {
      out.push({ path, code: decodeError(e.message)?.code ?? e.type ?? 'invalid' });
    } else out.push(...flatten(v as FieldErrors, path));
  }
  return out;
}

const attr = (v: string) => v.replace(/["\\]/g, '\\$&');

function elementFor(path: string): HTMLElement | null {
  return (
    document.getElementById(`field-${path.replace(/\./g, '-')}`) ??
    document.querySelector<HTMLElement>(
      `[name="${attr(path)}"], [data-field="${attr(path)}"] input`,
    )
  );
}

/** Errors are listed and focused in the order the fields appear on screen. */
function inDomOrder(list: Flat[]): Flat[] {
  return [...list].sort((a, b) => {
    const ea = elementFor(a.path);
    const eb = elementFor(b.path);
    if (!ea || !eb) return ea ? -1 : eb ? 1 : 0;
    return ea.compareDocumentPosition(eb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
}

function focusField(path: string): void {
  const el =
    document.getElementById(`field-${path.replace(/\./g, '-')}`) ??
    document.querySelector<HTMLElement>(
      `[name="${attr(path)}"], [data-field="${attr(path)}"] input`,
    );
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * Form wrapper: error summary + focus on the first invalid field on submit, server 422 mapping,
 * business-rule alert at the top, validation telemetry (field + rule, never values), unsaved guard.
 */
export function Form<T extends FieldValues>({
  form,
  name,
  onSubmit,
  children,
  requiredLegend,
  guardUnsaved,
  id,
}: Props<T>) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [summary, setSummary] = useState<Flat[]>([]);
  const [businessError, setBusinessError] = useState<unknown>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const labels = useFieldLabelRegistry();

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      Boolean(guardUnsaved) &&
      form.formState.isDirty &&
      !form.formState.isSubmitSuccessful &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: t('states.unsavedTitle'),
      body: t('states.unsavedBody'),
      confirmLabel: t('actions.leave'),
      destructive: true,
    }).then((r) => (r.confirmed ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm, t]);

  const onInvalid = (errors: FieldErrors<T>) => {
    const flat = inDomOrder(flatten(errors as FieldErrors));
    setSummary(flat);
    reportIssue({
      kind: 'validation_error',
      severity: 'low',
      message: 'client validation',
      validation: { form: name, fields: flat.map((f) => ({ field: f.path, rule: f.code })) },
    });
    const first = flat[0];
    if (first) requestAnimationFrame(() => focusField(first.path));
  };

  const submit = form.handleSubmit(async (values) => {
    setSummary([]);
    setBusinessError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      const { mapped } = applyServerErrors(form, err);
      if (isApiError(err) && (err.code === 'VALIDATION_ERROR' || err.code === 'FIELD_FORBIDDEN')) {
        const flat = err.fields.map((f) => ({ path: f.path.replace(/^body\./, ''), code: f.code }));
        reportIssue({
          kind: 'validation_error',
          severity: 'low',
          message: 'server validation',
          validation: { form: name, fields: flat.map((f) => ({ field: f.path, rule: f.code })) },
        });
        if (mapped.length) {
          setSummary(inDomOrder(flat.filter((f) => mapped.includes(f.path))));
          return;
        }
      }
      setBusinessError(err);
      requestAnimationFrame(() => summaryRef.current?.focus());
      // Rethrow for callers that need to know (they rarely do).
    }
  }, onInvalid);

  return (
    <FieldLabelsContext.Provider value={labels}>
      <FormProvider {...form}>
        <Box
          component="form"
          id={id}
          noValidate
          onSubmit={submit}
          aria-describedby={summary.length ? `${name}-summary` : undefined}
        >
          <Box ref={summaryRef} tabIndex={-1} sx={{ outline: 'none' }}>
            {businessError !== null && (
              <Alert severity="error" sx={{ mb: 4 }} role="alert">
                {getErrorMessage(businessError, t)}
                {isApiError(businessError) && businessError.requestId && (
                  <Typography
                    variant="caption"
                    display="block"
                    sx={{ mt: 1, fontFamily: 'monospace' }}
                    dir="ltr"
                  >
                    {t('errors:referenceCode', { code: businessError.requestId })}
                  </Typography>
                )}
              </Alert>
            )}
            {summary.length > 0 && (
              <Alert severity="warning" sx={{ mb: 4 }} id={`${name}-summary`} role="alert">
                <AlertTitle>{t('validation:summary', { count: summary.length })}</AlertTitle>
                <List dense disablePadding>
                  {summary.map((s) => (
                    <ListItem key={s.path} disableGutters sx={{ py: 0 }}>
                      <Link
                        component="button"
                        type="button"
                        onClick={() => focusField(s.path)}
                        underline="hover"
                      >
                        {labels.get(s.path) ?? s.path}
                      </Link>
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}
          </Box>
          {requiredLegend && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 3 }}>
              {t('validation:requiredLegend')}
            </Typography>
          )}
          {children}
        </Box>
      </FormProvider>
    </FieldLabelsContext.Provider>
  );
}
