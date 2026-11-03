import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  TextField,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { ErrorState, PageSkeleton } from '@/shared/components/States';
import { useNotify } from '@/shared/hooks/useNotify';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { useFieldAccess, usePermission } from '@/shared/rbac/usePermission';
import { patientsApi, useMergePatient, useRestorePatient, type Patient } from '../api/patients';
import { PatientHeader } from '../components/PatientHeader';
import { PatientPicker } from '../components/PatientPicker';

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
  { key: 'certificates', path: 'certificates', perm: 'clinical.certificate.read' },
  { key: 'lab', path: 'lab', perm: 'clinical.labOrder.read' },
  { key: 'consents', path: 'consents', perm: 'clinical.chart.read' },
  { key: 'billing', path: 'billing', perm: 'billing.invoice.read' },
  { key: 'medical', path: 'medical', perm: 'patients.medicalHistory.read' },
  { key: 'communication', path: 'communication', perm: 'patients.communication.read' },
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

/** Patient workspace: sticky header + tabs (16 §3). */
export function PatientWorkspace() {
  const { t } = useTranslation('patients');
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const q = patientsApi.useItem(id);
  const access = useFieldAccess('patients.patient');
  const { can } = usePermission();
  const remove = patientsApi.useRemove();
  const restore = useRestorePatient();
  const confirm = useConfirm();
  const notify = useNotify();
  const [merging, setMerging] = useState(false);

  if (q.isLoading) return <PageSkeleton />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;
  if (p.status === 'merged' && p.id === id && p.mergedIntoId) {
    return <Navigate to={`/clinic/patients/${p.mergedIntoId}`} replace />;
  }

  const tabs = PATIENT_TABS.filter((tab) => !tab.perm || can(tab.perm));
  const base = `/clinic/patients/${p.id}`;
  const sub = location.pathname.slice(base.length + 1).split('/')[0] ?? '';
  const current = tabs.find((tab) => tab.path === sub)?.path ?? '';

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
      notify.success(t('deleted'), {
        undo: async () => {
          try {
            await restore.mutateAsync(p.id);
            navigate(`/clinic/patients/${p.id}`);
          } catch (err) {
            notify.error(err);
          }
        },
      });
      navigate('/clinic/patients');
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <FieldScope value={access}>
      <PatientHeader patient={p} onMerge={() => setMerging(true)} onDelete={() => void del()}>
        <Tabs
          value={current}
          onChange={(_e, v: string) => navigate(v ? `${base}/${v}` : base)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((tab) => (
            <Tab key={tab.key} value={tab.path} label={tab.label ?? t(`tabs.${tab.key}`)} />
          ))}
        </Tabs>
      </PatientHeader>
      <Outlet context={{ patient: p }} />
      {merging && <MergeDialog patient={p} open onClose={() => setMerging(false)} />}
    </FieldScope>
  );
}
