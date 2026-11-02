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
import { AlertTriangle, Download, FilterX, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { staffApi } from '@/features/staff/api';
import { formatDate } from '@/lib/dates';
import { api } from '@/lib/api/axios';
import { DataTable, useListParams } from '@/shared/components/DataTable';
import { MoneyText } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { FieldScope } from '@/shared/rbac/fieldAccess';
import { Can, useFieldAccess, usePermission } from '@/shared/rbac/usePermission';
import { patientsApi, type Patient } from '../api/patients';
import { ageOf, useAlertLabel } from '../utils';

export function PatientListPage() {
  const { t, i18n } = useTranslation('patients');
  const navigate = useNavigate();
  const lp = useListParams();
  const access = useFieldAccess('patients.patient');
  const alertLabel = useAlertLabel();
  const notify = useNotify();
  const { can } = usePermission();
  // Filters live in the URL (shareable, 16 §3); tag/dentist only when the field is visible.
  const filters = {
    status: lp.filter('status') || undefined,
    tag: lp.filter('tag') || undefined,
    dentistId: lp.filter('dentistId') || undefined,
  };
  const filtered = Boolean(filters.status || filters.tag || filters.dentistId);
  const list = patientsApi.useList({ ...lp.params, ...filters });
  const showDentist = access.canSee('preferredDentist') && can('staff.member.read', 'all');
  const dentists = staffApi.useList(
    { limit: 100, bookable: 'true', status: 'active' },
    { enabled: showDentist },
  );
  const [tag, setTag] = useState(filters.tag ?? '');
  useEffect(() => setTag(filters.tag ?? ''), [filters.tag]);
  const applyTag = () => {
    if (tag.trim() !== (filters.tag ?? '')) lp.set({ tag: tag.trim(), page: 1 });
  };

  const exportCsv = async () => {
    try {
      const res = await api.get<Blob>('/patients/export', {
        params: { ...lp.params, ...filters, page: undefined },
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
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {access.canSee('tags') && (
              <TextField
                size="small"
                label={t('fields.tags')}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onBlur={applyTag}
                onKeyDown={(e) => e.key === 'Enter' && applyTag()}
                inputProps={{ dir: 'auto', maxLength: 30 }}
                sx={{ minWidth: 140 }}
              />
            )}
            {showDentist && (
              <TextField
                select
                size="small"
                label={t('fields.preferredDentist')}
                value={filters.dentistId ?? ''}
                onChange={(e) => lp.set({ dentistId: e.target.value, page: 1 })}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">{t('allDentists')}</MenuItem>
                {(dentists.data?.data ?? []).map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    <span dir="auto">{d.name}</span>
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              size="small"
              label={t('fields.status')}
              value={filters.status ?? ''}
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
          </Stack>
        }
        empty={
          filtered ? (
            <EmptyState
              icon={<FilterX size={32} />}
              title={t('noMatches')}
              action={
                <Button
                  variant="outlined"
                  onClick={() => lp.set({ status: '', tag: '', dentistId: '', page: 1 })}
                >
                  {t('common:actions.clearFilters')}
                </Button>
              }
              compact
            />
          ) : (
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
          )
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
