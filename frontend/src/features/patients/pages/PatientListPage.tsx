import {
  Avatar,
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { AlertTriangle, Download, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '@/lib/dates';
import { api } from '@/lib/api/axios';
import { DataTable, useListParams } from '@/shared/components/DataTable';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { Can, useFieldAccess } from '@/shared/rbac/usePermission';
import { patientsApi, type Patient } from '../api/patients';
import { ageOf, useAlertLabel } from '../utils';

export function PatientListPage() {
  const { t, i18n } = useTranslation('patients');
  const navigate = useNavigate();
  const lp = useListParams();
  const access = useFieldAccess('patients.patient');
  const alertLabel = useAlertLabel();
  const notify = useNotify();
  const list = patientsApi.useList({ ...lp.params, status: lp.filter('status') || undefined });

  const exportCsv = async () => {
    try {
      const res = await api.get<Blob>('/patients/export', {
        params: { ...lp.params, page: undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'patients.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <FieldScope value={access}>
      <PageHeader
        title={t('title')}
        subtitle={
          list.data ? t('common:pagination.count', { count: list.data.meta.total }) : t('subtitle')
        }
        primary={
          <Can perm="patients.patient.create">
            <Button
              variant="contained"
              startIcon={<UserPlus size={18} />}
              onClick={() => navigate('/clinic/patients/new')}
            >
              {t('new')}
            </Button>
          </Can>
        }
        actions={
          <Can perm="patients.patient.export">
            <Button
              variant="outlined"
              startIcon={<Download size={18} />}
              onClick={() => void exportCsv()}
            >
              {t('export')}
            </Button>
          </Can>
        }
      />
      <DataTable<Patient>
        rows={list.data?.data ?? []}
        total={list.data?.meta.total}
        loading={list.isLoading || list.isFetching}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={(r) => navigate(`/clinic/patients/${r.id}`)}
        toolbar={
          <TextField
            select
            size="small"
            label={t('fields.status')}
            value={lp.filter('status')}
            onChange={(e) => lp.set({ status: e.target.value, page: 1 })}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">{t('allStatuses')}</MenuItem>
            {(['active', 'inactive', 'deceased'] as const).map((s) => (
              <MenuItem key={s} value={s}>
                {t(`statuses.${s}`)}
              </MenuItem>
            ))}
          </TextField>
        }
        empty={
          <EmptyState
            title={t('empty')}
            description={t('emptyHint')}
            action={
              <Button
                variant="contained"
                startIcon={<UserPlus size={18} />}
                onClick={() => navigate('/clinic/patients/new')}
              >
                {t('new')}
              </Button>
            }
            compact
          />
        }
        columns={[
          {
            field: 'name',
            headerName: t('fields.fullName'),
            fieldKey: 'name',
            flex: 1.6,
            minWidth: 240,
            sortable: true,
            renderCell: (p) => (
              <Stack
                direction="row"
                spacing={3}
                alignItems="center"
                sx={{ height: '100%', minWidth: 0 }}
              >
                <Avatar
                  sx={{
                    width: 34,
                    height: 34,
                    fontSize: 14,
                    bgcolor: p.row.gender === 'female' ? 'secondary.main' : 'primary.main',
                  }}
                >
                  {p.row.fullName.slice(0, 1)}
                </Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={650} dir="auto" noWrap>
                    {p.row.fullName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" dir="ltr" component="div">
                    {p.row.fileNumber}
                  </Typography>
                </Box>
                {p.row.medicalAlerts?.length > 0 && (
                  <Tooltip title={p.row.medicalAlerts.map(alertLabel).join(' · ')}>
                    <Box
                      sx={{ color: 'error.main', display: 'flex' }}
                      aria-label={t('fields.alerts')}
                    >
                      <AlertTriangle size={16} />
                    </Box>
                  </Tooltip>
                )}
              </Stack>
            ),
          },
          {
            field: 'phone',
            headerName: t('fields.phone'),
            fieldKey: 'phone',
            width: 160,
            renderCell: (p) => <span dir="ltr">{p.row.phone ?? '—'}</span>,
          },
          {
            field: 'dateOfBirth',
            headerName: t('fields.age'),
            fieldKey: 'dateOfBirth',
            width: 100,
            sortable: true,
            renderCell: (p) =>
              ageOf(p.row.dateOfBirth) === null
                ? '—'
                : t('years', { count: ageOf(p.row.dateOfBirth) ?? 0 }),
          },
          {
            field: 'balance',
            headerName: t('fields.balance'),
            fieldKey: 'balance',
            width: 140,
            sortable: true,
            renderCell: (p) => (
              <MoneyText
                value={p.row.balance ?? 0}
                sx={{
                  color: (p.row.balance ?? 0) > 0 ? 'error.main' : 'text.primary',
                  fontWeight: 650,
                }}
              />
            ),
          },
          {
            field: 'lastVisitAt',
            headerName: t('fields.lastVisit'),
            width: 140,
            sortable: true,
            renderCell: (p) =>
              p.row.lastVisitAt
                ? formatDate(p.row.lastVisitAt, i18n.resolvedLanguage ?? 'ar', 'll')
                : '—',
          },
          {
            field: 'tags',
            headerName: t('fields.tags'),
            fieldKey: 'tags',
            width: 160,
            renderCell: (p) => (
              <Stack direction="row" spacing={0.5} sx={{ height: '100%', alignItems: 'center' }}>
                {p.row.tags.slice(0, 2).map((tag) => (
                  <Chip key={tag} size="small" label={tag} />
                ))}
              </Stack>
            ),
          },
          {
            field: 'status',
            headerName: t('fields.status'),
            fieldKey: 'status',
            width: 110,
            renderCell: (p) => (
              <StatusChip status={p.row.status} label={t(`statuses.${p.row.status}`)} />
            ),
          },
        ]}
      />
    </FieldScope>
  );
}
