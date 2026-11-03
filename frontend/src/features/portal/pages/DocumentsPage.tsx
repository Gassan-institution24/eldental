import { Box, Button, Card, Stack, Tab, Tabs, Typography } from '@mui/material';
import { FileHeart, NotebookText, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CertificatePrintDialog } from '@/features/clinical/pages/CertificatesTab';
import { InstructionPrintDialog } from '@/features/clinical/pages/InstructionsPages';
import { formatDate } from '@/lib/dates';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { fetchPortalCertificatePrint, fetchPortalInstructionPrint, usePortalDocuments, usePortalMe } from '../api';
import { LinkFilePrompt, PortalHeader } from '../components';

function Row({ title, lines, status, onPrint }: { title: string; lines: string[]; status?: React.ReactNode; onPrint: () => void }) {
  const { t } = useTranslation('patient');
  return (
    <Card sx={{ p: { xs: 4, md: 5 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Typography fontWeight={800} dir="auto">
              {title}
            </Typography>
            {status}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} dir="auto">
            {lines.filter(Boolean).join(' · ')}
          </Typography>
        </Box>
        <Button variant="outlined" size="small" startIcon={<Printer size={16} />} onClick={onPrint}>
          {t('portal.documents.print')}
        </Button>
      </Stack>
    </Card>
  );
}

/** Certificates and post-treatment instructions across the account's files (07 §14–15). */
export function DocumentsPage() {
  const { t, i18n } = useTranslation('patient');
  const { t: td } = useTranslation('documents');
  const lang = i18n.language;
  const me = usePortalMe();
  const q = usePortalDocuments();
  const [tab, setTab] = useState<'certificates' | 'instructions'>('certificates');
  const [printing, setPrinting] = useState<{ kind: 'certificate' | 'instruction'; id: string } | null>(null);
  const d = q.data;

  return (
    <>
      <PortalHeader title={t('portal.documents.title')} subtitle={t('portal.documents.subtitle')} />
      {q.isLoading || me.isLoading ? (
        <PageSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !me.data?.patients.length || !d ? (
        <LinkFilePrompt />
      ) : (
        <>
          <Tabs value={tab} onChange={(_e, v: 'certificates' | 'instructions') => setTab(v)} sx={{ mb: 4, borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="certificates" label={`${t('portal.documents.certificates')} (${d.certificates.length})`} />
            <Tab value="instructions" label={`${t('portal.documents.instructions')} (${d.instructions.length})`} />
          </Tabs>
          {tab === 'certificates' ? (
            d.certificates.length === 0 ? (
              <Card>
                <EmptyState icon={<FileHeart size={30} />} title={t('portal.documents.emptyCertificates')} />
              </Card>
            ) : (
              <Stack spacing={3}>
                {d.certificates.map((c) => (
                  <Row
                    key={c.id}
                    title={td(`certificates.types.${c.type}`)}
                    status={<StatusChip status={c.status} label={td(`certificates.statuses.${c.status}`)} />}
                    lines={[
                      c.number,
                      c.from === c.to ? formatDate(c.from, lang) : td('certificates.range', { from: formatDate(c.from, lang), to: formatDate(c.to, lang), count: c.days }),
                      c.patient?.fullName ?? '',
                      c.dentistName ?? '',
                      c.clinic?.name ?? '',
                    ]}
                    onPrint={() => setPrinting({ kind: 'certificate', id: c.id })}
                  />
                ))}
              </Stack>
            )
          ) : d.instructions.length === 0 ? (
            <Card>
              <EmptyState icon={<NotebookText size={30} />} title={t('portal.documents.emptyInstructions')} />
            </Card>
          ) : (
            <Stack spacing={3}>
              {d.instructions.map((i) => (
                <Row
                  key={i.id}
                  title={i.title}
                  lines={[formatDate(i.givenAt, lang), i.patient?.fullName ?? '', i.givenByName ?? '', i.clinic?.name ?? '']}
                  onPrint={() => setPrinting({ kind: 'instruction', id: i.id })}
                />
              ))}
            </Stack>
          )}
        </>
      )}
      {printing?.kind === 'certificate' && (
        <CertificatePrintDialog id={printing.id} onClose={() => setPrinting(null)} fetcher={fetchPortalCertificatePrint} />
      )}
      {printing?.kind === 'instruction' && (
        <InstructionPrintDialog id={printing.id} onClose={() => setPrinting(null)} fetcher={fetchPortalInstructionPrint} />
      )}
    </>
  );
}
