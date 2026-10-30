import { Box, Card, Divider, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  noPadding?: boolean;
};

/** Titled card used to group form sections and settings blocks. */
export function SectionCard({ title, subtitle, actions, children, footer, noPadding }: Props) {
  return (
    <Card sx={{ mb: 6 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ px: 6, pt: 5, pb: subtitle ? 4 : 3 }}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        <Box>
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions}
      </Stack>
      <Box sx={noPadding ? undefined : { px: 6, pb: 6 }}>{children}</Box>
      {footer && (
        <>
          <Divider />
          <Stack direction="row" justifyContent="flex-end" spacing={2} sx={{ px: 6, py: 4 }}>
            {footer}
          </Stack>
        </>
      )}
    </Card>
  );
}
