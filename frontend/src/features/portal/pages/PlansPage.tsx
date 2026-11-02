import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ClipboardList, PenLine } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SignaturePad } from '@/features/clinical/components/shared';
import { formatDate } from '@/lib/dates';
import { MoneyText } from '@/shared/components/MoneyText';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { StatusChip } from '@/shared/components/StatusChip';
import { useNotify } from '@/shared/hooks/useNotify';
import { useAcceptPlan, usePortalMe, usePortalPlans, type PortalPlan } from '../api';
import { LinkFilePrompt, PortalHeader, useSeedLabel } from '../components';
import { patientCta } from './PatientAuthPages';

function AcceptDialog({ plan, onClose }: { plan: PortalPlan; onClose: () => void }) {
  const { t } = useTranslation('patient');
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const label = useSeedLabel('procedure');
  const me = usePortalMe();
  const accept = useAcceptPlan();
  const notify = useNotify();
  const [chosen, setChosen] = useState<Set<string>>(new Set(plan.items.map((i) => i.id)));
  const [signerName, setSignerName] = useState(me.data?.user.displayName ?? '');
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const share = plan.items
    .filter((i) => chosen.has(i.id))
    .reduce((s, i) => s + i.patientEstimate, 0);
  const nameError = signerName.trim().length > 0 && signerName.trim().length < 2;
  const ready = chosen.size > 0 && signature && agreed && signerName.trim().length >= 2;

  const run = async () => {
    if (!ready || !signature) return;
    try {
      await accept.mutateAsync({
        id: plan.id,
        signature,
        signerName: signerName.trim(),
        ...(chosen.size < plan.items.length ? { itemIds: [...chosen] } : {}),
      });
      notify.success(t('portal.plans.accepted'));
      onClose();
    } catch (err) {
      notify.error(err);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth fullScreen={phone}>
      <DialogTitle>{t('portal.plans.acceptTitle', { number: plan.number })}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {t('portal.plans.acceptBody')}
        </Typography>
        <Typography fontWeight={700} sx={{ mb: 1 }}>
          {t('portal.plans.choose')}
        </Typography>
        <Stack sx={{ mb: 4 }}>
          {plan.items.map((i) => (
            <FormControlLabel
              key={i.id}
              control={
                <Checkbox
                  checked={chosen.has(i.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(i.id);
                    else next.delete(i.id);
                    setChosen(next);
                  }}
                />
              }
              label={
                <Stack direction="row" spacing={2} sx={{ width: '100%' }}>
                  <span>
                    {label(i)}
                    {i.toothNumbers.length
                      ? ` · ${t('portal.plans.tooth', { n: i.toothNumbers.join(', ') })}`
                      : ''}
                  </span>
                  <MoneyText value={i.patientEstimate} sx={{ marginInlineStart: 'auto' }} />
                </Stack>
              }
              sx={{ mx: 0, '& .MuiFormControlLabel-label': { flex: 1 } }}
            />
          ))}
        </Stack>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 4 }}>
          <Typography fontWeight={700}>{t('portal.plans.yourShare')}</Typography>
          <MoneyText value={share} sx={{ fontWeight: 800 }} />
        </Stack>
        <TextField
          label={t('portal.plans.signerName')}
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          error={nameError}
          helperText={
            nameError
              ? t('validation:too_short', { min: 2, field: t('portal.plans.signerName') })
              : undefined
          }
          fullWidth
          required
          inputProps={{ maxLength: 120, dir: 'auto' }}
          sx={{ mb: 3 }}
        />
        <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
          {t('portal.plans.signature')}
        </Typography>
        <SignaturePad onChange={setSignature} height={160} />
        <FormControlLabel
          sx={{ mt: 2, alignItems: 'flex-start' }}
          control={
            <Checkbox
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              sx={{ pt: 0.5 }}
            />
          }
          label={<Typography variant="body2">{t('portal.plans.consent')}</Typography>}
        />
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          sx={patientCta}
          disabled={!ready || accept.isPending}
          onClick={() => void run()}
        >
          {t('portal.plans.acceptConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function PlanCard({ plan, onAccept }: { plan: PortalPlan; onAccept: () => void }) {
  const { t, i18n } = useTranslation('patient');
  const label = useSeedLabel('procedure');
  const lang = i18n.language;
  return (
    <Card sx={{ p: { xs: 4, md: 6 } }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        justifyContent="space-between"
        alignItems={{ md: 'flex-start' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ flexWrap: 'wrap', rowGap: 1 }}
          >
            <Typography variant="h5" component="h2" dir="auto">
              {plan.title || plan.number}
            </Typography>
            <StatusChip status={plan.status} />
            {plan.canAccept && (
              <Chip size="small" color="warning" label={t('portal.plans.waiting')} />
            )}
            {plan.expired && plan.status === 'presented' && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={t('portal.plans.expired')}
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {[plan.patient.fullName, plan.dentist, plan.clinic?.name, plan.number]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          {plan.validUntil && plan.status === 'presented' && (
            <Typography variant="caption" color="text.secondary">
              {t('portal.plans.validUntil', { date: formatDate(plan.validUntil, lang) })}
            </Typography>
          )}
        </Box>
        {plan.canAccept && (
          <Button
            variant="contained"
            startIcon={<PenLine size={18} />}
            sx={{ ...patientCta, flexShrink: 0 }}
            onClick={onAccept}
          >
            {t('portal.plans.review')}
          </Button>
        )}
      </Stack>

      <Divider sx={{ my: 4 }} />
      <Stack divider={<Divider flexItem />} spacing={2}>
        {plan.items.map((i) => (
          <Stack
            key={i.id}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 0.5, sm: 3 }}
            alignItems={{ sm: 'center' }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={650}>{label(i)}</Typography>
              <Typography variant="caption" color="text.secondary">
                {[
                  i.code,
                  i.toothNumbers.length
                    ? t('portal.plans.tooth', { n: i.toothNumbers.join(', ') })
                    : '',
                  plan.phases.length > 1 ? plan.phases[i.phaseIndex]?.name : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Typography>
            </Box>
            {i.status !== 'proposed' && <StatusChip status={i.status} />}
            <MoneyText
              value={i.patientEstimate}
              sx={{ fontWeight: 700, minWidth: 110, textAlign: { sm: 'end' } }}
            />
          </Stack>
        ))}
      </Stack>
      <Divider sx={{ my: 4 }} />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 1, sm: 6 }}
        justifyContent="flex-end"
        alignItems={{ sm: 'center' }}
      >
        {plan.totals.insurance > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('portal.plans.insurance')}: <MoneyText value={plan.totals.insurance} />
          </Typography>
        )}
        <Typography fontWeight={800}>
          {t('portal.plans.yourShare')}: <MoneyText value={plan.totals.patient} />
        </Typography>
      </Stack>
      {plan.acceptance && (
        <Alert severity="success" sx={{ mt: 4 }}>
          {t('portal.plans.acceptedOn', {
            date: formatDate(plan.acceptance.at, lang),
            name: plan.acceptance.signerName ?? '',
          })}
        </Alert>
      )}
    </Card>
  );
}

/** Treatment plans the clinic shared (01 §4.10): review, then accept all or some items with a signature. */
export function PlansPage() {
  const { t } = useTranslation('patient');
  const me = usePortalMe();
  const q = usePortalPlans();
  const [accepting, setAccepting] = useState<PortalPlan | null>(null);
  const waiting = (q.data ?? []).filter((p) => p.canAccept);
  const rest = (q.data ?? []).filter((p) => !p.canAccept);

  return (
    <>
      <PortalHeader title={t('portal.plans.title')} subtitle={t('portal.plans.subtitle')} />
      {q.isLoading || me.isLoading ? (
        <PageSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !me.data?.patients.length ? (
        <LinkFilePrompt />
      ) : (q.data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardList size={30} />}
            title={t('portal.plans.empty')}
            description={t('portal.plans.emptyHint')}
          />
        </Card>
      ) : (
        <Stack spacing={5}>
          {[...waiting, ...rest].map((p) => (
            <PlanCard key={p.id} plan={p} onAccept={() => setAccepting(p)} />
          ))}
        </Stack>
      )}
      {accepting && <AcceptDialog plan={accepting} onClose={() => setAccepting(null)} />}
    </>
  );
}
