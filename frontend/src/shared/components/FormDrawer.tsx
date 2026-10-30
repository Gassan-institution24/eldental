import {
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfirm } from './ConfirmDialog';

type Props = {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** The <Form> id to submit from the sticky footer. */
  formId: string;
  submitting?: boolean;
  dirty?: boolean;
  submitLabel?: string;
  children: ReactNode;
  width?: number;
  extraActions?: ReactNode;
};

/**
 * Short forms (≤ 8 fields) open in a side drawer: right in LTR, left in RTL (16 §3), with a
 * sticky save bar and a confirmation before discarding unsaved changes.
 */
export function FormDrawer({
  open,
  title,
  subtitle,
  onClose,
  formId,
  submitting,
  dirty,
  submitLabel,
  children,
  width = 480,
  extraActions,
}: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const confirm = useConfirm();

  const tryClose = async () => {
    if (dirty && !submitting) {
      const r = await confirm({
        title: t('states.unsavedTitle'),
        body: t('states.unsavedBody'),
        confirmLabel: t('actions.leave'),
        destructive: true,
      });
      if (!r.confirmed) return;
    }
    onClose();
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => void tryClose()}
      PaperProps={{
        sx: { width: mobile ? '100%' : width, display: 'flex', flexDirection: 'column' },
      }}
    >
      <Stack direction="row" alignItems="flex-start" spacing={2} sx={{ px: 6, py: 5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h4" component="h2" dir="auto">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton onClick={() => void tryClose()} aria-label={t('actions.close')} size="small">
          <X size={20} />
        </IconButton>
      </Stack>
      <Divider />
      <Box sx={{ flex: 1, overflowY: 'auto', px: 6, py: 6 }}>{children}</Box>
      <Divider />
      <Stack
        direction="row"
        spacing={2}
        sx={{ px: 6, py: 4, bgcolor: 'background.default' }}
        justifyContent="flex-end"
        alignItems="center"
      >
        {extraActions}
        <Box sx={{ flex: 1 }} />
        <Button onClick={() => void tryClose()}>{t('actions.cancel')}</Button>
        <Button type="submit" form={formId} variant="contained" disabled={submitting}>
          {submitting ? t('states.saving') : (submitLabel ?? t('actions.save'))}
        </Button>
      </Stack>
    </Drawer>
  );
}
