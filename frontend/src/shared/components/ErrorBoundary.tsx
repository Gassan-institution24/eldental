import { Box, Button, Stack, Typography } from '@mui/material';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Trans } from 'react-i18next';
import i18n from '@/i18n';
import { reportIssue } from '@/lib/telemetry';
import { useReportProblem } from './reportProblemStore';

type Props = { children: ReactNode; name?: string; fallback?: (reset: () => void, ref: string) => ReactNode };
type State = { error: Error | null; ref: string };

function shortRef(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/** Catches render errors, reports a `js_error` with a reference code, and shows a friendly screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, ref: '' };

  static getDerivedStateFromError(error: Error): State {
    return { error, ref: shortRef() };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportIssue({
      kind: 'js_error',
      severity: 'high',
      message: error.message.slice(0, 500),
      code: this.state.ref,
      ...(this.props.name ? { component: this.props.name } : {}),
      stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 6000),
    });
  }

  reset = () => this.setState({ error: null, ref: '' });

  override render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.reset, this.state.ref);
    const t = i18n.t.bind(i18n);
    return (
      <Stack alignItems="center" textAlign="center" sx={{ py: 16, px: 4 }} role="alert">
        <Typography variant="h3" component="h1">
          {t('states.crashTitle')}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 2, maxWidth: 480 }}>
          {t('states.crashBody')}
        </Typography>
        <Box sx={{ mt: 2, fontFamily: 'monospace', fontSize: 13 }} dir="ltr">
          <Trans i18nKey="errors:referenceCode" values={{ code: this.state.ref }} />
        </Box>
        <Stack direction="row" spacing={2} sx={{ mt: 6 }}>
          <Button variant="contained" onClick={() => window.location.reload()}>
            {t('actions.reload')}
          </Button>
          <Button onClick={() => useReportProblem.getState().open(`ref ${this.state.ref}`)}>{t('layout.reportProblem')}</Button>
        </Stack>
      </Stack>
    );
  }
}
