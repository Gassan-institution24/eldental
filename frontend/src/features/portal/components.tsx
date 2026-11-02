import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { inClinicTz } from '@/lib/dates';
import { useSeedName } from '@/shared/hooks/useSeedName';
import type { SeedNamed } from './api';

/** Page title row for the portal: title + one-line subtitle, actions wrap under it on phones. */
export function PortalHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={3}
      justifyContent="space-between"
      alignItems={{ xs: 'stretch', sm: 'center' }}
      sx={{ mb: 6 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h3" component="h1">
          {title}
        </Typography>
        {subtitle && (
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {action}
    </Stack>
  );
}

/** Shown where data needs a linked clinic file and the account has none yet. */
export function LinkFilePrompt({ body }: { body?: string }) {
  const { t } = useTranslation('patient');
  return (
    <Card
      sx={(th) => ({
        p: { xs: 5, md: 6 },
        borderColor: alpha('#06B6D4', 0.4),
        bgcolor: alpha('#06B6D4', th.palette.mode === 'dark' ? 0.08 : 0.04),
      })}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} alignItems={{ sm: 'center' }}>
        <Box sx={{ color: '#0891B2' }}>
          <Link2 size={28} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">{t('home.linkTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {body ?? t('home.linkBody')}
          </Typography>
        </Box>
        <Button component={RouterLink} to="/portal/family" variant="outlined">
          {t('home.linkCta')}
        </Button>
      </Stack>
    </Card>
  );
}

/** Big calendar-style date block used on appointment cards. */
export function DateBlock({ value, lang }: { value: string; lang: string }) {
  const d = inClinicTz(value).locale(lang);
  return (
    <Box
      sx={(th) => ({
        width: 64,
        flexShrink: 0,
        borderRadius: '16px',
        textAlign: 'center',
        py: 1.5,
        bgcolor: alpha(th.palette.primary.main, 0.08),
        color: 'primary.main',
      })}
    >
      <Typography variant="caption" fontWeight={700} display="block">
        {d.format('MMM')}
      </Typography>
      <Typography variant="h4" component="div" fontWeight={800} lineHeight={1.1}>
        {d.format('D')}
      </Typography>
      <Typography variant="caption" display="block">
        {d.format('ddd')}
      </Typography>
    </Box>
  );
}

/** Seed-named records (appointment types, procedures) in the UI language until renamed. */
export function useSeedLabel(group: 'appointmentType' | 'procedure') {
  const seedName = useSeedName(group);
  return (r: SeedNamed | undefined) => (r ? seedName(r) || r.code || '' : '');
}
