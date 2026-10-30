import { Button } from '@mui/material';
import { useSnackbar, type SnackbarKey } from 'notistack';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/lib/api/apiError';

type SuccessOpts = { undo?: () => void | Promise<void> };

/** Snackbar (bottom, auto-hide 4 s) with Undo where possible (16_UX_UI_AND_VALIDATION.md §4). */
export function useNotify() {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();
  const { t } = useTranslation();

  const success = useCallback(
    (message: string, opts: SuccessOpts = {}) => {
      enqueueSnackbar(message, {
        variant: 'success',
        autoHideDuration: opts.undo ? 6000 : 4000,
        action: opts.undo
          ? (key: SnackbarKey) => (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  closeSnackbar(key);
                  void opts.undo?.();
                }}
              >
                {t('actions.undo')}
              </Button>
            )
          : undefined,
      });
    },
    [enqueueSnackbar, closeSnackbar, t],
  );

  const error = useCallback(
    (err: unknown) => {
      enqueueSnackbar(typeof err === 'string' ? err : getErrorMessage(err, t), {
        variant: 'error',
        autoHideDuration: 6000,
      });
    },
    [enqueueSnackbar, t],
  );

  const info = useCallback(
    (message: string) => enqueueSnackbar(message, { variant: 'info' }),
    [enqueueSnackbar],
  );

  return useMemo(() => ({ success, error, info }), [success, error, info]);
}
