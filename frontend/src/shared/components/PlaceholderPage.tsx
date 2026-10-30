import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { brand } from '@/theme/tokens';
import { EmptyState } from './States';
import { PageHeader } from './PageHeader';

/** Used only for routes whose module lands in a later roadmap phase. */
export function PlaceholderPage({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t(titleKey)} />
      <Card
        sx={{ position: 'relative', overflow: 'hidden', p: { xs: 8, md: 14 }, textAlign: 'center' }}
      >
        <Box
          aria-hidden
          sx={{ position: 'absolute', inset: 0, backgroundImage: brand.gradientSoft }}
        />
        <Stack alignItems="center" spacing={4} sx={{ position: 'relative' }}>
          <Box
            sx={{
              width: 72,
              height: 72,
              borderRadius: '20px',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              backgroundImage: brand.gradient,
              boxShadow: '0 20px 40px -18px rgba(124,58,237,.8)',
            }}
          >
            <Rocket size={32} />
          </Box>
          <Typography variant="h3">{t('dashboard:comingSoon.title')}</Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 480 }}>
            {t('dashboard:comingSoon.body')}
          </Typography>
        </Stack>
      </Card>
    </>
  );
}

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <Box sx={{ minHeight: '70vh', display: 'grid', placeItems: 'center' }}>
      <EmptyState
        title={t('states.notFoundTitle')}
        description={t('states.notFoundBody')}
        action={
          <Button component={RouterLink} to="/" variant="contained">
            {t('actions.goHome')}
          </Button>
        }
      />
    </Box>
  );
}
