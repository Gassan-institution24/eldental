import { Alert, Box, Button, Card, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Inbox, Lock, RefreshCw, SearchX, ServerCrash, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorMessage, isApiError } from '@/lib/api/apiError';
import { useReportProblem } from './reportProblemStore';

function Illustration({
  icon,
  tone = 'primary',
}: {
  icon: ReactNode;
  tone?: 'primary' | 'error' | 'warning';
}) {
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 72,
        height: 72,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: theme.palette[tone].main,
        bgcolor: alpha(theme.palette[tone].main, 0.1),
        mb: 3,
      })}
    >
      {icon}
    </Box>
  );
}

type EmptyProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
};

/** Illustration + one sentence + primary action (16_UX_UI_AND_VALIDATION.md §4). */
export function EmptyState({ title, description, action, icon, compact }: EmptyProps) {
  const { t } = useTranslation();
  return (
    <Stack
      alignItems="center"
      textAlign="center"
      sx={{ py: compact ? 6 : 12, px: 4 }}
      role="status"
    >
      <Illustration icon={icon ?? <Inbox size={32} />} />
      <Typography variant="h4" component="p">
        {title ?? t('states.empty')}
      </Typography>
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 420 }}>
          {description}
        </Typography>
      )}
      {action && <Box sx={{ mt: 4 }}>{action}</Box>}
    </Stack>
  );
}

export function EmptySearch({ query, onClear }: { query: string; onClear?: () => void }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<SearchX size={32} />}
      title={t('states.emptySearch', { query })}
      action={
        onClear && (
          <Button variant="outlined" onClick={onClear}>
            {t('actions.clearFilters')}
          </Button>
        )
      }
    />
  );
}

type ErrorProps = { error?: unknown; onRetry?: () => void; compact?: boolean; title?: string };

/** Friendly message + retry + reference code + "Report a problem". */
export function ErrorState({ error, onRetry, compact, title }: ErrorProps) {
  const { t } = useTranslation();
  const openReport = useReportProblem((s) => s.open);
  const reqId = isApiError(error) ? error.requestId : undefined;
  return (
    <Stack alignItems="center" textAlign="center" sx={{ py: compact ? 6 : 12, px: 4 }} role="alert">
      <Illustration icon={<ServerCrash size={32} />} tone="error" />
      <Typography variant="h4" component="p">
        {title ?? t('states.error')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 460 }}>
        {error ? getErrorMessage(error, t) : t('states.errorHint')}
      </Typography>
      {reqId && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ mt: 2, fontFamily: 'monospace' }}
          dir="ltr"
        >
          {t('errors:referenceCode', { code: reqId })}
        </Typography>
      )}
      <Stack direction="row" spacing={2} sx={{ mt: 4 }}>
        {onRetry && (
          <Button variant="contained" startIcon={<RefreshCw size={18} />} onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        )}
        <Button variant="text" onClick={() => openReport()}>
          {t('layout.reportProblem')}
        </Button>
      </Stack>
    </Stack>
  );
}

/** 403 screen that explains what's missing. */
export function NoPermission({ permission }: { permission?: string }) {
  const { t } = useTranslation();
  return (
    <Stack alignItems="center" textAlign="center" sx={{ py: 12, px: 4 }} role="alert">
      <Illustration icon={<Lock size={32} />} tone="warning" />
      <Typography variant="h4" component="h1">
        {t('states.noPermissionTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 460 }}>
        {permission
          ? t('states.noPermissionBody', {
              permission: t(`perm:${permission}`, { defaultValue: permission }),
            })
          : t('states.noPermissionGeneric')}
      </Typography>
    </Stack>
  );
}

export function OfflineNotice() {
  const { t } = useTranslation();
  return (
    <Alert severity="warning" icon={<WifiOff size={18} />} sx={{ borderRadius: 0 }}>
      {t('states.offline')}
    </Alert>
  );
}

export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Box aria-busy="true" aria-live="polite">
      <Skeleton variant="text" width="30%" height={40} />
      <Skeleton variant="text" width="18%" height={20} sx={{ mb: 4 }} />
      <Card sx={{ p: 4 }}>
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={36} sx={{ mb: 2 }} />
        ))}
      </Card>
    </Box>
  );
}

export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <Box aria-busy="true" sx={{ p: 2 }}>
      {Array.from({ length: rows }, (_, r) => (
        <Stack key={r} direction="row" spacing={3} sx={{ mb: 2 }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} variant="text" sx={{ flex: c === 0 ? 2 : 1 }} height={28} />
          ))}
        </Stack>
      ))}
    </Box>
  );
}

export function CardSkeleton({ height = 120 }: { height?: number }) {
  return <Skeleton variant="rounded" height={height} />;
}
