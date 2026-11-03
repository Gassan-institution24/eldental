import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Ban, Plus, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { Letterhead, PrintShell } from '@/features/billing/components/PrintDialogs';
import { usePatientContext } from '@/features/patients/pages/PatientWorkspace';
import { useSpecialtyName } from '@/features/staff/components/SpecialtyFields';
import { formatDate } from '@/lib/dates';
import { CERTIFICATE_TYPES, certificateBody, certificateDays, certificateVoidBody } from '@/shared/generated/patients';
import { FormDrawer } from '@/shared/components/FormDrawer';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { Form } from '@/shared/form/Form';
import { RHFDate } from '@/shared/form/RHFInputs';
import { RHFSelect } from '@/shared/form/RHFSelect';
import { RHFTextField } from '@/shared/form/RHFTextField';
import { useAppForm } from '@/shared/form/useAppForm';
import { useFileUrl } from '@/shared/hooks/useFileUrl';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePermission } from '@/shared/rbac/usePermission';
import {
  fetchCertificatePrint,
  useCertificates,
  useIssueCertificate,
  useVoidCertificate,
  type Certificate,
  type CertificatePrint,
  type CertificateType,
} from '../documentsApi';

const issueSchema = certificateBody();
type IssueValues = z.input<typeof issueSchema>;
const voidSchema = certificateVoidBody();
type VoidValues = z.input<typeof voidSchema>;

function Signature({ fileId, alt }: { fileId?: string; alt: string }) {
  const url = useFileUrl(fileId);
  return url.data ? <img src={url.data} alt={alt} style={{ maxHeight: 70, maxWidth: 160 }} /> : null;
}

/** Letterhead print with the dentist's name and a signature line; `fetcher` lets the portal reuse it. */
export function CertificatePrintDialog({
  id,
  onClose,
  fetcher = fetchCertificatePrint,
}: {
  id: string;
  onClose: () => void;
  fetcher?: (id: string) => Promise<CertificatePrint>;
}) {
  const { t, i18n } = useTranslation('documents');
  const specialtyName = useSpecialtyName();
  const q = useQuery({ queryKey: ['certificate-print', id], queryFn: () => fetcher(id) });
  const d = q.data;
  const c = d?.certificate;
  const lang = i18n.language;
  return (
    <PrintShell title={t('certificates.printTitle')} onClose={onClose} ready={Boolean(d)} error={q.error}>
      {c && d && (
        <Box data-testid="certificate-print">
          <Letterhead clinic={d.clinic} title={t(`certificates.types.${c.type}`)} number={c.number} date={c.issuedAt} />
          <Divider sx={{ my: 3 }} />
          {c.status === 'void' && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {t('certificates.voidBanner', { reason: c.voidReason ?? '' })}
            </Alert>
          )}
          <Typography>
            <b>{t('certificates.patient')}:</b> <span dir="auto">{d.patient.fullName}</span> · <span dir="ltr">{d.patient.fileNumber}</span>
            {d.patient.dateOfBirth ? ` · ${formatDate(d.patient.dateOfBirth, lang)}` : ''}
          </Typography>
          <Typography sx={{ mt: 1 }}>
            <b>{t('certificates.period')}:</b>{' '}
            {c.from === c.to
              ? formatDate(c.from, lang)
              : t('certificates.range', { from: formatDate(c.from, lang), to: formatDate(c.to, lang), count: c.days })}
          </Typography>
          {c.diagnosis && (
            <Typography sx={{ mt: 1 }}>
              <b>{t('certificates.diagnosis')}:</b> <span dir="auto">{c.diagnosis}</span>
            </Typography>
          )}
          <Typography sx={{ mt: 3, whiteSpace: 'pre-wrap' }} dir="auto">
            {c.body}
          </Typography>
          {c.recommendations && (
            <Box sx={{ mt: 3 }}>
              <Typography fontWeight={700}>{t('certificates.recommendations')}</Typography>
              <Typography sx={{ whiteSpace: 'pre-wrap' }} dir="auto">
                {c.recommendations}
              </Typography>
            </Box>
          )}
          <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mt: 10 }}>
            <Box>
              <Typography variant="body2">
                <b>{d.dentist?.name}</b>
              </Typography>
              {d.dentist?.primarySpecialty && (
                <Typography variant="caption" display="block">
                  {specialtyName(d.dentist.primarySpecialty)}
                </Typography>
              )}
              {d.dentist?.licenseNumber && <Typography variant="caption">{t('certificates.license', { number: d.dentist.licenseNumber })}</Typography>}
            </Box>
            <Stack alignItems="center" spacing={0.5}>
              <Stack direction="row" spacing={3} sx={{ minHeight: 70 }} alignItems="flex-end">
                <Signature fileId={d.dentist?.signatureFileId} alt={t('certificates.signature')} />
                <Signature fileId={d.dentist?.stampFileId} alt={t('certificates.stamp')} />
              </Stack>
              <Box sx={{ width: 220, borderTop: '1px solid #000' }} />
              <Typography variant="caption">{t('certificates.signature')}</Typography>
            </Stack>
          </Stack>
        </Box>
      )}
    </PrintShell>
  );
}

function IssueDrawer({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation('documents');
  const { patient: p } = usePatientContext();
  const notify = useNotify();
  const issue = useIssueCertificate(p.id);
  const today = dayjs().format('YYYY-MM-DD');
  const form = useAppForm<IssueValues>({
    schema: issueSchema,
    defaultValues: { type: 'sick_leave', from: today, to: today, diagnosis: '', body: '', recommendations: '' },
  });
  const type = useWatch({ control: form.control, name: 'type' }) as CertificateType;
  const from = useWatch({ control: form.control, name: 'from' }) as string;
  const to = useWatch({ control: form.control, name: 'to' }) as string | undefined;
  const valid = (d?: string) => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  const days = valid(from) && valid(to || from) && (to || from) >= from ? certificateDays(from, to || from) : undefined;

  // Suggested wording until the dentist edits the text themselves.
  useEffect(() => {
    if (form.getFieldState('body').isDirty) return;
    const lang = i18n.language;
    form.setValue(
      'body',
      t(`certificates.templates.${type}`, {
        name: p.fullName,
        from: valid(from) ? formatDate(from, lang) : '',
        to: valid(to || from) ? formatDate(to || from, lang) : '',
        count: days ?? 1,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, from, to, i18n.language]);

  return (
    <FormDrawer
      open
      onClose={onClose}
      title={t('certificates.issue')}
      subtitle={t('certificates.issueHint')}
      formId="certificate-form"
      submitting={form.formState.isSubmitting}
      dirty={form.formState.isDirty}
      submitLabel={t('certificates.issueAction')}
      width={640}
    >
      <Form
        form={form}
        name="clinical.certificate"
        id="certificate-form"
        onSubmit={async (values) => {
          const saved = await issue.mutateAsync(values as unknown as Record<string, unknown>);
          notify.success(t('certificates.issued', { number: saved.number }));
          onClose();
        }}
      >
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <RHFSelect name="type" label={t('certificates.type')} required options={CERTIFICATE_TYPES.map((v) => ({ value: v, label: t(`certificates.types.${v}`) }))} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFDate name="from" label={t('certificates.from')} required />
          </Grid>
          <Grid item xs={12} sm={6}>
            <RHFDate
              name="to"
              label={t('certificates.to')}
              minDate={valid(from) ? from : undefined}
              helperText={days ? t('certificates.days', { count: days }) : undefined}
            />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField name="diagnosis" label={t('certificates.diagnosis')} maxLength={300} />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField name="body" label={t('certificates.body')} required multiline minRows={4} maxLength={3000} />
          </Grid>
          <Grid item xs={12}>
            <RHFTextField name="recommendations" label={t('certificates.recommendations')} multiline minRows={2} maxLength={1000} />
          </Grid>
        </Grid>
        <Alert severity="info" sx={{ mt: 3 }}>
          {t('certificates.immutableHint')}
        </Alert>
      </Form>
    </FormDrawer>
  );
}

function VoidDialog({ cert, onClose }: { cert: Certificate; onClose: () => void }) {
  const { t } = useTranslation('documents');
  const { t: tc } = useTranslation();
  const notify = useNotify();
  const voidIt = useVoidCertificate(cert.patientId);
  const form = useAppForm<VoidValues>({ schema: voidSchema, defaultValues: { reason: '' } });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('certificates.voidTitle', { number: cert.number })}</DialogTitle>
      <Form
        form={form}
        name="clinical.certificate.void"
        onSubmit={async (v) => {
          await voidIt.mutateAsync({ id: cert.id, reason: (v as { reason: string }).reason });
          notify.success(t('certificates.voided'));
          onClose();
        }}
      >
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('certificates.voidHint')}
          </Typography>
          <RHFTextField name="reason" label={t('certificates.voidReason')} required maxLength={300} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{tc('actions.cancel')}</Button>
          <Button type="submit" color="error" variant="contained" disabled={form.formState.isSubmitting}>
            {t('certificates.void')}
          </Button>
        </DialogActions>
      </Form>
    </Dialog>
  );
}

export function CertificatesTab() {
  const { t, i18n } = useTranslation('documents');
  const { patient: p } = usePatientContext();
  const { can } = usePermission();
  const canIssue = can('clinical.certificate.issue');
  const q = useCertificates(p.id);
  const [issuing, setIssuing] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<Certificate | null>(null);
  const lang = i18n.language;

  if (q.isLoading) return <PageSkeleton rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];

  return (
    <SectionCard
      title={t('certificates.title')}
      subtitle={t('certificates.hint')}
      actions={
        canIssue && (
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setIssuing(true)}>
            {t('certificates.issue')}
          </Button>
        )
      }
    >
      {list.length === 0 ? (
        <EmptyState compact title={t('certificates.empty')} description={canIssue ? t('certificates.emptyHint') : undefined} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('certificates.number')}</TableCell>
                <TableCell>{t('certificates.type')}</TableCell>
                <TableCell>{t('certificates.period')}</TableCell>
                <TableCell>{t('certificates.dentist')}</TableCell>
                <TableCell>{t('certificates.status')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell dir="ltr">{c.number}</TableCell>
                  <TableCell>{t(`certificates.types.${c.type}`)}</TableCell>
                  <TableCell>
                    {c.from === c.to ? formatDate(c.from, lang) : t('certificates.range', { from: formatDate(c.from, lang), to: formatDate(c.to, lang), count: c.days })}
                  </TableCell>
                  <TableCell dir="auto">{c.dentistName ?? '—'}</TableCell>
                  <TableCell>
                    <StatusChip status={c.status === 'void' ? 'void' : 'issued'} label={t(`certificates.statuses.${c.status}`)} />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" startIcon={<Printer size={14} />} onClick={() => setPrinting(c.id)}>
                      {t('certificates.print')}
                    </Button>
                    {canIssue && c.status === 'issued' && (
                      <Button size="small" color="error" startIcon={<Ban size={14} />} onClick={() => setVoiding(c)}>
                        {t('certificates.void')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {issuing && <IssueDrawer onClose={() => setIssuing(false)} />}
      {printing && <CertificatePrintDialog id={printing} onClose={() => setPrinting(null)} />}
      {voiding && <VoidDialog cert={voiding} onClose={() => setVoiding(null)} />}
    </SectionCard>
  );
}
