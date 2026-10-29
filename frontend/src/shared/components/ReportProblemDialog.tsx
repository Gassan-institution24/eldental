import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getReportContext, reportIssue, flush } from '@/lib/telemetry';
import { useNotify } from '../hooks/useNotify';
import { useReportProblem } from './reportProblemStore';

const MAX = 2000;

/** "Report a problem": comment + optional user-confirmed screenshot + automatic context. */
export function ReportProblemDialog() {
  const { t } = useTranslation();
  const { isOpen, presetMessage, close } = useReportProblem();
  const notify = useNotify();
  const [comment, setComment] = useState('');
  const [withScreenshot, setWithScreenshot] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setComment('');
      setWithScreenshot(false);
      setFailed(false);
    }
  }, [isOpen]);

  const send = async () => {
    setSending(true);
    setFailed(false);
    try {
      let screenshot: string | undefined;
      if (withScreenshot) {
        const { default: html2canvas } = await import('html2canvas');
        const canvas = await html2canvas(document.body, { scale: 0.6, logging: false });
        screenshot = canvas.toDataURL('image/jpeg', 0.6);
      }
      reportIssue({
        kind: 'user_report',
        severity: 'medium',
        message: presetMessage ?? 'user report',
        userComment: comment.trim().slice(0, MAX),
        context: getReportContext(),
        ...(screenshot ? { screenshot } : {}),
      });
      await flush();
      notify.success(t('report.sent'));
      close();
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={close} maxWidth="sm" fullWidth aria-labelledby="report-title">
      <DialogTitle id="report-title">{t('report.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          {t('report.intro')}
        </Typography>
        {failed && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {t('report.failed')}
          </Alert>
        )}
        <TextField
          autoFocus
          multiline
          minRows={4}
          label={t('report.comment')}
          helperText={comment.length > MAX * 0.8 ? `${comment.length}/${MAX}` : t('report.commentHelper')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          inputProps={{ dir: 'auto', maxLength: MAX }}
        />
        <FormControlLabel
          sx={{ mt: 2 }}
          control={<Checkbox checked={withScreenshot} onChange={(e) => setWithScreenshot(e.target.checked)} />}
          label={t('report.screenshot')}
        />
        <FormHelperText>{t('report.screenshotHelper')}</FormHelperText>
      </DialogContent>
      <DialogActions sx={{ px: 6, pb: 4 }}>
        <Button onClick={close}>{t('actions.cancel')}</Button>
        <Button variant="contained" onClick={() => void send()} disabled={sending}>
          {sending ? t('states.saving') : t('report.send')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
