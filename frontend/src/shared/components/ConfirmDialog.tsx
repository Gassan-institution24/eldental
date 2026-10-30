import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Ask for a reason (cancel appointment, void invoice…). Resolves with it. */
  reason?: { label?: string; required?: boolean; max?: number };
};

type Result = { confirmed: boolean; reason?: string };
type ConfirmFn = (opts: ConfirmOptions) => Promise<Result>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Destructive actions confirm and name the object (16_UX_UI_AND_VALIDATION.md §4). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const resolver = useRef<((r: Result) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    setReason('');
    setTouched(false);
    return new Promise<Result>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (r: Result) => {
    resolver.current?.(r);
    resolver.current = null;
    setOpts(null);
  };

  const reasonMissing = Boolean(opts?.reason?.required) && reason.trim().length === 0;
  const max = opts?.reason?.max ?? 500;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(opts)}
        onClose={() => close({ confirmed: false })}
        maxWidth="xs"
        fullWidth
        aria-labelledby="confirm-title"
      >
        <DialogTitle id="confirm-title" dir="auto">
          {opts?.title}
        </DialogTitle>
        <DialogContent>
          {opts?.body && <DialogContentText component="div">{opts.body}</DialogContentText>}
          {opts?.reason && (
            <TextField
              autoFocus
              sx={{ mt: 3 }}
              label={`${opts.reason.label ?? t('confirm.reason')}${opts.reason.required ? ' *' : ''}`}
              value={reason}
              multiline
              minRows={2}
              inputProps={{ dir: 'auto', maxLength: max }}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              error={touched && reasonMissing}
              helperText={
                touched && reasonMissing
                  ? t('validation:required', { field: opts.reason.label ?? t('confirm.reason') })
                  : reason.length > max * 0.8
                    ? `${reason.length}/${max}`
                    : undefined
              }
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 6, pb: 4 }}>
          <Button onClick={() => close({ confirmed: false })}>{t('actions.cancel')}</Button>
          <Button
            variant="contained"
            color={opts?.destructive ? 'error' : 'primary'}
            onClick={() => {
              if (reasonMissing) {
                setTouched(true);
                return;
              }
              close({ confirmed: true, ...(opts?.reason ? { reason: reason.trim() } : {}) });
            }}
          >
            {opts?.confirmLabel ?? t('actions.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return ctx;
}
