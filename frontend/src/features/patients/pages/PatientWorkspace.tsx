import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
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
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import { useQuickBook } from '@/features/scheduling/components/quickBookStore';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { useFieldAccess, usePermission } from '@/shared/rbac/usePermission';
import { patientsApi, useMergePatient, type Patient } from '../api/patients';
import { PatientPicker } from '../components/PatientPicker';
import { ageOf, useAlertLabel } from '../utils';

export type WorkspaceTab = { key: string; path: string; perm?: string; label?: string };

/** Clinical/billing modules append their tabs here (chart, plans, notes, perio, imaging, billing). */
export const PATIENT_TABS: WorkspaceTab[] = [
  { key: 'overview', path: '' },
  { key: 'appointments', path: 'appointments', perm: 'scheduling.appointment.read' },
  { key: 'chart', path: 'chart', perm: 'clinical.chart.read' },
  { key: 'plans', path: 'plans', perm: 'clinical.treatmentPlan.read' },
  { key: 'notes', path: 'notes', perm: 'clinical.note.read' },
  { key: 'perio', path: 'perio', perm: 'clinical.perio.read' },
  { key: 'imaging', path: 'imaging', perm: 'clinical.imaging.read' },
  { key: 'prescriptions', path: 'prescriptions', perm: 'clinical.prescription.read' },
  { key: 'lab', path: 'lab', perm: 'clinical.labOrder.read' },
  { key: 'consents', path: 'consents', perm: 'clinical.chart.read' },
  { key: 'billing', path: 'billing', perm: 'billing.invoice.read' },
  { key: 'medical', path: 'medical', perm: 'patients.medicalHistory.read' },
  { key: 'insurance', path: 'insurance' },
  { key: 'documents', path: 'documents', perm: 'patients.document.read' },
  { key: 'history', path: 'history' },
];

export function usePatientContext() {
  return useOutletContext<{ patient: Patient }>();
}

function MergeDialog({
  patient,
  open,
  onClose,
}: {
  patient: Patient;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('patients');
  const merge = useMergePatient();
  const notify = useNotify();
  const [source, setSource] = useState<{ id: string; fullName: string } | null>(null);
  const [reason, setReason] = useState('');
  const run = async () => {
    if (!source) return;
    try {
      await merge.mutateAsync({ id: patient.id, sourceId: source.id, reason });
      notify.success(t('merge.done'));
      onClose();
    } catch (err) {
      notify.error(err);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('merge.title', { name: patient.fullName })}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 4 }}>
          {t('merge.body')}
        </Alert>
        <Stack spacing={4}>
          <PatientPicker
            label={t('merge.source')}
            value={source}
            onChange={setSource}
            excludeId={patient.id}
          />
          <TextField
            label={t('merge.reason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            inputProps={{ dir: 'auto', maxLength: 500 }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          color="error"
          variant="contained"
          disabled={!source || merge.isPending}
          onClick={() => void run()}
        >
          {t('merge.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

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

/** Patient workspace: sticky header + tabs (16 §3). */
export function PatientWorkspace() {
  const { t } = useTranslation('patients');
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const q = patientsApi.useItem(id);
  const access = useFieldAccess('patients.patient');
  const { can } = usePermission();
  const alertLabel = useAlertLabel();
  const openQuickBook = useQuickBook((s) => s.open);
  const remove = patientsApi.useRemove();
  const confirm = useConfirm();
  const notify = useNotify();
  const [merging, setMerging] = useState(false);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  if (
    p.status === 'merged' &&
    p.id === id &&
    (p as Patient & { mergedIntoId?: string }).mergedIntoId
  ) {
    return (
      <Navigate
        to={`/clinic/patients/${(p as Patient & { mergedIntoId?: string }).mergedIntoId}`}
        replace
      />
    );
  }

  const tabs = PATIENT_TABS.filter((tab) => !tab.perm || can(tab.perm));
  const base = `/clinic/patients/${p.id}`;
  const sub = location.pathname.slice(base.length + 1).split('/')[0] ?? '';
  const current = tabs.find((tab) => tab.path === sub)?.path ?? '';
  const age = ageOf(p.dateOfBirth);

  const del = async () => {
    const r = await confirm({
      title: t('deleteTitle', { name: p.fullName }),
      body: t('deleteBody'),
      destructive: true,
      confirmLabel: t('header.delete'),
    });
    if (!r.confirmed) return;
    try {
      await remove.mutateAsync(p.id);
      notify.success(t('deleted'));
      navigate('/clinic/patients');
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <FieldScope value={access}>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/clinic/patients' }, { label: p.fullName }]}
        title={
          <Stack direction="row" spacing={3} alignItems="center">
            <Avatar
              sx={{
                width: 56,
                height: 56,
                fontSize: 22,
                bgcolor: p.gender === 'female' ? 'secondary.main' : 'primary.main',
              }}
            >
              {p.fullName.slice(0, 1)}
            </Avatar>
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
                </Typography>
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
                  <Chip key={tag} size="small" label={tag} />
                ))}
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
            onClick: () => setMerging(true),
          },
          {
            label: t('header.delete'),
            icon: <Trash2 size={16} />,
            hidden: !can('patients.patient.delete'),
            onClick: () => void del(),
          },
        ]}
      />

      {p.medicalAlerts.length > 0 && (
        <Alert
          severity="error"
          icon={<AlertTriangle size={20} />}
          sx={(th) => ({
            mb: 5,
            border: `1px solid ${alpha(th.palette.error.main, 0.4)}`,
            '& .MuiAlert-message': { width: '100%' },
          })}
          role="alert"
        >
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <Typography fontWeight={800}>{t('header.alertsTitle')}</Typography>
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
        </Alert>
      )}

      <Card sx={{ mb: 5, p: 4 }}>
        <Stack direction="row" spacing={{ xs: 4, md: 10 }} sx={{ flexWrap: 'wrap', rowGap: 3 }}>
          {access.canSee('phone') || access.isMasked('phone') ? (
            <HeaderStat label={t('fields.phone')}>
              <span dir="ltr">{p.phone ?? '—'}</span>
            </HeaderStat>
          ) : null}
          {access.canSee('balance') && (
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
          <HeaderStat label={t('fields.lastVisit')}>
            {p.lastVisitAt ? new Date(p.lastVisitAt).toLocaleDateString() : '—'}
          </HeaderStat>
          {p.guardian && (
            <HeaderStat label={t('sections.guardian')}>
              <span dir="auto">{p.guardian.name}</span>
            </HeaderStat>
          )}
        </Stack>
      </Card>

      <Tabs
        value={current}
        onChange={(_e, v: string) => navigate(v ? `${base}/${v}` : base)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 6, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabs.map((tab) => (
          <Tab key={tab.key} value={tab.path} label={tab.label ?? t(`tabs.${tab.key}`)} />
        ))}
      </Tabs>
      <Outlet context={{ patient: p }} />
      {merging && <MergeDialog patient={p} open onClose={() => setMerging(false)} />}
    </FieldScope>
  );
}
