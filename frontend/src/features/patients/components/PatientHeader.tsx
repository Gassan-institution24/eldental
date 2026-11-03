import { Box, Button, Card, Chip, Link, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AlertTriangle,
  CalendarPlus,
  CreditCard,
  GitMerge,
  Pencil,
  ReceiptText,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppointmentPanel, useQuickBook } from '@/features/scheduling/components/quickBookStore';
import { formatDate, formatTime } from '@/lib/dates';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { StatusChip } from '@/shared/components/StatusChip';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { usePermission } from '@/shared/rbac/usePermission';
import type { Patient } from '../api/patients';
import { ageOf, useAlertLabel, useNextAppointment } from '../utils';
import { IdVerifiedBadge, PatientAvatar, PatientFlags } from './PatientDetailsCards';

/** Height of the clinic AppBar toolbar (AppShell); the strip sticks right below it. */
const APP_BAR = 72;

function HeaderStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography fontWeight={700} component="div">
        {children}
      </Typography>
    </Box>
  );
}

/** Next visit with a link that opens the appointment panel. */
function NextVisit({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('patients');
  const next = useNextAppointment(patientId);
  const show = useAppointmentPanel((s) => s.show);
  if (next.isLoading) return <Skeleton width={120} />;
  if (!next.next) return <>{t('header.none')}</>;
  const a = next.next;
  return (
    <Link component="button" type="button" onClick={() => show(a.id)} fontWeight={700}>
      {formatDate(a.start, i18n.language, 'ddd ll')} ·{' '}
      <span dir="ltr">{formatTime(a.start, i18n.language)}</span>
    </Link>
  );
}

type Props = {
  patient: Patient;
  onMerge: () => void;
  onDelete: () => void;
  /** Workspace tabs; they stick with the summary strip. */
  children: ReactNode;
};

/**
 * Patient header (16 §3): identity and actions, then a sticky strip with medical alerts,
 * contact, balance, next and last visit. When the title scrolls away the strip shows the name.
 */
export function PatientHeader({ patient: p, onMerge, onDelete, children }: Props) {
  const { t, i18n } = useTranslation('patients');
  const navigate = useNavigate();
  const scope = useFieldScope();
  const { can } = usePermission();
  const alertLabel = useAlertLabel();
  const openQuickBook = useQuickBook((s) => s.open);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const age = ageOf(p.dateOfBirth);
  const base = `/clinic/patients/${p.id}`;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e?.isIntersecting), {
      rootMargin: `-${APP_BAR}px 0px 0px 0px`,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/clinic/patients' }, { label: p.fullName }]}
        title={
          <Stack direction="row" spacing={3} alignItems="center">
            <PatientAvatar patient={p} size={56} />
            <Box sx={{ minWidth: 0 }}>
              <span dir="auto">{p.fullName}</span>
              <Stack
                direction="row"
                spacing={1.5}
                alignItems="center"
                sx={{ mt: 1, flexWrap: 'wrap', rowGap: 1 }}
              >
                <Typography variant="body2" color="text.secondary" dir="ltr">
                  {p.fileNumber}
                  {p.legacyFileNumber && scope.canSee('legacyFileNumber') ? ` · ${p.legacyFileNumber}` : ''}
                </Typography>
                {scope.canSee('idVerification') && <IdVerifiedBadge patient={p} />}
                {age !== null && (
                  <Chip size="small" variant="outlined" label={t('years', { count: age })} />
                )}
                {p.gender && (
                  <Chip size="small" variant="outlined" label={t(`genders.${p.gender}`)} />
                )}
                {p.status !== 'active' && (
                  <StatusChip status={p.status} label={t(`statuses.${p.status}`)} />
                )}
                {p.tags.map((tag) => (
                  <Chip key={tag} size="small" label={<span dir="auto">{tag}</span>} />
                ))}
                <PatientFlags patient={p} />
              </Stack>
            </Box>
          </Stack>
        }
        actions={
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {can('billing.payment.create') && (
              <Button
                variant="outlined"
                startIcon={<CreditCard size={16} />}
                onClick={() => navigate(`/clinic/billing/payments?new=1&patientId=${p.id}`)}
              >
                {t('header.pay')}
              </Button>
            )}
            {can('billing.invoice.create') && (
              <Button
                variant="outlined"
                startIcon={<ReceiptText size={16} />}
                onClick={() => navigate(`/clinic/billing/invoices/new?patientId=${p.id}`)}
              >
                {t('header.invoice')}
              </Button>
            )}
          </Stack>
        }
        primary={
          can('scheduling.appointment.book') && (
            <Button
              variant="contained"
              startIcon={<CalendarPlus size={18} />}
              onClick={() => openQuickBook({ patientId: p.id })}
            >
              {t('header.book')}
            </Button>
          )
        }
        secondary={[
          {
            label: t('header.edit'),
            icon: <Pencil size={16} />,
            hidden: !can('patients.patient.update'),
            onClick: () => navigate(`${base}/edit`),
          },
          {
            label: t('header.merge'),
            icon: <GitMerge size={16} />,
            hidden: !can('patients.patient.delete'),
            onClick: onMerge,
          },
          {
            label: t('header.delete'),
            icon: <Trash2 size={16} />,
            hidden: !can('patients.patient.delete'),
            onClick: onDelete,
          },
        ]}
      />

      <div ref={sentinel} />
      <Box
        data-testid="patient-sticky"
        sx={{
          position: { md: 'sticky' },
          top: APP_BAR,
          zIndex: (th) => th.zIndex.appBar - 1,
          bgcolor: 'background.default',
          pt: 1,
          mb: 6,
        }}
      >
        <Card sx={{ p: 4, mb: 2 }}>
          {stuck && (
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 3 }}>
              <PatientAvatar patient={p} size={32} />
              <Typography fontWeight={800} dir="auto" noWrap>
                {p.fullName}
              </Typography>
              <Typography variant="body2" color="text.secondary" dir="ltr">
                {p.fileNumber}
              </Typography>
            </Stack>
          )}
          {p.medicalAlerts.length > 0 && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ sm: 'center' }}
              role="alert"
              sx={(th) => ({
                mb: 3,
                px: 3,
                py: 2,
                borderRadius: '10px',
                color: 'error.main',
                bgcolor: alpha(th.palette.error.main, 0.08),
                border: `1px solid ${alpha(th.palette.error.main, 0.4)}`,
              })}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <AlertTriangle size={18} />
                <Typography fontWeight={800}>{t('header.alertsTitle')}</Typography>
              </Stack>
              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                {p.medicalAlerts.map((a) => (
                  <Chip
                    key={a}
                    size="small"
                    color="error"
                    label={<span dir="auto">{alertLabel(a)}</span>}
                  />
                ))}
              </Stack>
            </Stack>
          )}
          <Stack direction="row" spacing={{ xs: 4, md: 10 }} sx={{ flexWrap: 'wrap', rowGap: 3 }}>
            {(scope.canSee('phone') || scope.isMasked('phone')) && (
              <HeaderStat label={t('fields.phone')}>
                <span dir="ltr">{p.phone ?? '—'}</span>
              </HeaderStat>
            )}
            {scope.canSee('balance') && (
              <HeaderStat label={t('header.balance')}>
                {(p.balance ?? 0) === 0 ? (
                  <Typography component="span" color="success.main" fontWeight={700}>
                    {t('header.noBalance')}
                  </Typography>
                ) : (
                  <MoneyText
                    value={p.balance ?? 0}
                    sx={{ color: (p.balance ?? 0) > 0 ? 'error.main' : 'success.main' }}
                  />
                )}
              </HeaderStat>
            )}
            {can('scheduling.appointment.read') && (
              <HeaderStat label={t('header.nextAppointment')}>
                <NextVisit patientId={p.id} />
              </HeaderStat>
            )}
            <HeaderStat label={t('fields.lastVisit')}>
              {p.lastVisitAt ? formatDate(p.lastVisitAt, i18n.language, 'll') : '—'}
            </HeaderStat>
            {p.guardian && (
              <HeaderStat label={t('sections.guardian')}>
                <span dir="auto">{p.guardian.name}</span>
              </HeaderStat>
            )}
          </Stack>
        </Card>
        {children}
      </Box>
    </>
  );
}
