import { QueryClientProvider } from '@tanstack/react-query';
import { SnackbarProvider } from 'notistack';
import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { bootstrapAuth } from '@/features/auth/api/authApi';
import { queryClient } from '@/lib/api/queryClient';
import { installTelemetry } from '@/lib/telemetry';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { ReportProblemDialog } from '@/shared/components/ReportProblemDialog';
import { AppThemeProvider } from './providers/AppThemeProvider';
import { router } from './router';

/** Providers: Theme (RTL/LTR, light/dark), Query, i18n, Snackbar, Confirm, Auth bootstrap. */
export function App() {
  useEffect(() => {
    installTelemetry();
    void bootstrapAuth();
  }, []);

  return (
    <AppThemeProvider>
      <QueryClientProvider client={queryClient}>
        <SnackbarProvider maxSnack={3} autoHideDuration={4000} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <ConfirmProvider>
            <ErrorBoundary name="root">
              <RouterProvider router={router} />
            </ErrorBoundary>
            <ReportProblemDialog />
          </ConfirmProvider>
        </SnackbarProvider>
      </QueryClientProvider>
    </AppThemeProvider>
  );
}
