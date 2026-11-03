import { Avatar, Box, Button, Chip, Link, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { BadgeCheck, Camera, Flag, Trash2 } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { formatDate } from '@/lib/dates';
import { useCountries } from '@/lib/countries';
import { useConfirm } from '@/shared/components/ConfirmDialog';
import { SectionCard } from '@/shared/components/SectionCard';
import { EmptyState } from '@/shared/components/States';
import { useFileUrl } from '@/shared/hooks/useFileUrl';
import { useNotify } from '@/shared/hooks/useNotify';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { useFieldAccess, usePermission } from '@/shared/rbac/usePermission';
import { usePatientPhoto, useReferrals, useVerifyId, type Patient } from '../api/patients';

/** Avatar with the profile photo when there is one (served through the authorised file endpoint). */
export function PatientAvatar({ patient: p, size }: { patient: Patient; size: number }) {
  const photo = useFileUrl(p.photoFileId);
  return (
    <Avatar
      src={photo.data}
      alt={p.fullName}
      data-testid="patient-avatar"
      sx={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        bgcolor: p.gender === 'female' ? 'secondary.main' : 'primary.main',
      }}
    >
      {p.fullName.slice(0, 1)}
    </Avatar>
  );
}

/** Non-medical flags: outlined, neutral-warning chips so they never read as red medical alerts. */
export function PatientFlags({ patient: p }: { patient: Patient }) {
  const { t } = useTranslation('patients');
  const scope = useFieldScope();
  if (!scope.canSee('flags') || !p.flags?.length) return null;
  return (
    <>
      {p.flags.map((f) => (
        <Tooltip key={f.code} title={f.note ?? ''} disableHoverListener={!f.note}>
          <Chip
            size="small"
            variant="outlined"
            icon={<Flag size={12} />}
            data-testid={`flag-${f.code}`}
            label={<span dir="auto">{f.code === 'other' && f.note ? f.note : t(`flags.${f.code}`)}</span>}
            sx={(th) => ({
              borderStyle: 'dashed',
              color: th.palette.warning.dark,
              borderColor: alpha(th.palette.warning.main, 0.6),
              bgcolor: alpha(th.palette.warning.main, 0.06),
              '& .MuiChip-icon': { color: 'inherit' },
            })}
          />
        </Tooltip>
      ))}
    </>
  );
}

export function IdVerifiedBadge({ patient: p }: { patient: Patient }) {
  const { t, i18n } = useTranslation('patients');
  if (!p.idVerifiedAt) return null;
  return (
    <Tooltip title={t('identity.verifiedBy', { name: p.idVerifiedByName ?? '—', date: formatDate(p.idVerifiedAt, i18n.language, 'll') })}>
      <Chip size="small" color="success" variant="outlined" icon={<BadgeCheck size={14} />} label={t('identity.verified')} data-testid="id-verified" />
    </Tooltip>
  );
}

function Row({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} textAlign="end" component="div">
        {value ?? '—'}
      </Typography>
    </Stack>
  );
}

/** Overview card: photo, identity, blood type, height/weight/BMI, legacy file number, ID check. */
export function IdentityHealthCard({ patient: p }: { patient: Patient }) {
  const { t, i18n } = useTranslation('patients');
  const scope = useFieldScope();
  const write = useFieldAccess('patients.patient', 'write');
  const { can } = usePermission();
  const countries = useCountries();
  const notify = useNotify();
  const confirm = useConfirm();
  const photo = usePatientPhoto(p.id);
  const verify = useVerifyId(p.id);
  const input = useRef<HTMLInputElement>(null);
  const canEditPhoto = can('patients.patient.update') && write.canEdit('photo');
  const canVerify = can('patients.patient.update') && write.canEdit('idVerification');

  return (
    <SectionCard title={t('identity.title')}>
      <Stack direction="row" spacing={3} alignItems="center" sx={{ mb: 2 }}>
        {scope.canSee('photo') && <PatientAvatar patient={p} size={72} />}
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          {canEditPhoto && (
            <Stack direction="row" spacing={1}>
              <Button size="small" startIcon={<Camera size={14} />} onClick={() => input.current?.click()} disabled={photo.upload.isPending}>
                {p.photoFileId ? t('identity.changePhoto') : t('identity.addPhoto')}
              </Button>
              {p.photoFileId && (
                <Button
                  size="small"
                  color="error"
                  startIcon={<Trash2 size={14} />}
                  onClick={async () => {
                    const r = await confirm({ title: t('identity.removePhotoTitle'), destructive: true });
                    if (r.confirmed) await photo.remove.mutateAsync().then(() => notify.success(t('identity.photoRemoved')), notify.error);
                  }}
                >
                  {t('identity.removePhoto')}
                </Button>
              )}
              <input
                ref={input}
                type="file"
                hidden
                accept="image/jpeg,image/png,image/webp"
                data-testid="photo-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void photo.upload.mutateAsync(file).then(() => notify.success(t('identity.photoSaved')), notify.error);
                }}
              />
            </Stack>
          )}
          {scope.canSee('idVerification') && (
            <Stack direction="row" spacing={1} alignItems="center">
              {p.idVerifiedAt ? (
                <IdVerifiedBadge patient={p} />
              ) : (
                <>
                  <Chip size="small" variant="outlined" label={t('identity.notVerified')} />
                  {canVerify && (
                    <Button size="small" onClick={() => void verify.mutateAsync().then(() => notify.success(t('identity.verifiedToast')), notify.error)}>
                      {t('identity.verify')}
                    </Button>
                  )}
                </>
              )}
            </Stack>
          )}
        </Stack>
      </Stack>
      {scope.canSee('nationality') && <Row label={t('fields.nationality')} value={p.nationality && countries.name(p.nationality)} />}
      {scope.canSee('maritalStatus') && <Row label={t('fields.maritalStatus')} value={p.maritalStatus && t(`maritalStatuses.${p.maritalStatus}`)} />}
      {scope.canSee('occupation') && <Row label={t('fields.occupation')} value={p.occupation && <span dir="auto">{p.occupation}</span>} />}
      {scope.canSee('bloodType') && <Row label={t('fields.bloodType')} value={p.bloodType && <span dir="ltr">{p.bloodType}</span>} />}
      {scope.canSee('vitals') && (
        <Row
          label={t('identity.vitals')}
          value={
            p.heightCm || p.weightKg ? (
              <span>
                {p.heightCm ? t('identity.heightValue', { v: p.heightCm }) : '—'} · {p.weightKg ? t('identity.weightValue', { v: p.weightKg.toLocaleString(i18n.language) }) : '—'}
                {p.bmi ? ` · ${t('fields.bmiValue', { bmi: p.bmi })}` : ''}
              </span>
            ) : undefined
          }
        />
      )}
      {scope.canSee('legacyFileNumber') && <Row label={t('fields.legacyFileNumber')} value={p.legacyFileNumber && <span dir="ltr">{p.legacyFileNumber}</span>} />}
    </SectionCard>
  );
}

/** Overview card: who referred this patient, and whom they referred. */
export function ReferralsCard({ patient: p }: { patient: Patient }) {
  const { t, i18n } = useTranslation('patients');
  const scope = useFieldScope();
  const referrals = useReferrals(p.id, scope.canSee('referredBy'));
  if (!scope.canSee('referredBy')) return null;
  const r = p.referredBy;
  return (
    <SectionCard title={t('referrals.title')}>
      <Row
        label={t('fields.referredBy')}
        value={
          r ? (
            <Stack alignItems="flex-end" spacing={0.25}>
              <span>
                {t(`referralTypes.${r.type}`)}
                {': '}
                {r.type === 'patient' && r.patientId ? (
                  <Link component={RouterLink} to={`/clinic/patients/${r.patientId}`} dir="auto">
                    {r.patientName || r.patientFileNumber}
                  </Link>
                ) : (
                  <span dir="auto">{r.name ?? '—'}</span>
                )}
              </span>
              {r.note && (
                <Typography variant="caption" color="text.secondary" dir="auto">
                  {r.note}
                </Typography>
              )}
            </Stack>
          ) : undefined
        }
      />
      {scope.canSee('referralSource') && p.referralSource && <Row label={t('fields.referralSource')} value={<span dir="auto">{p.referralSource}</span>} />}
      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
        {t('referrals.referredByThem', { count: referrals.data?.length ?? 0 })}
      </Typography>
      {referrals.data?.length ? (
        <Stack spacing={0.5}>
          {referrals.data.map((x) => (
            <Stack key={x.id} direction="row" justifyContent="space-between">
              <Link component={RouterLink} to={`/clinic/patients/${x.id}`} variant="body2" dir="auto">
                {x.fullName} <span dir="ltr">({x.fileNumber})</span>
              </Link>
              <Typography variant="caption" color="text.secondary">
                {formatDate(x.createdAt, i18n.language, 'll')}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Box>
          <EmptyState compact title={t('referrals.none')} />
        </Box>
      )}
    </SectionCard>
  );
}
