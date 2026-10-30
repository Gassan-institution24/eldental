import type { ReactNode } from 'react';
import { Navigate, useLocation, useMatches } from 'react-router-dom';
import { useSession } from '@/features/auth/api/session';
import type { Session } from '@/features/auth/types';
import { NoPermission, PageSkeleton, ErrorState } from '@/shared/components/States';
import { usePermission } from '@/shared/rbac/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { reportIssue } from '@/lib/telemetry';
import { useEffect } from 'react';

export type RouteHandle = { perm?: string; title?: string };

function useAuthed(): {
  status: 'loading' | 'guest' | 'error' | 'ok';
  session?: Session;
  error?: unknown;
  retry?: () => void;
} {
  const token = useAuthStore((s) => s.accessToken);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const q = useSession();
  if (!bootstrapped) return { status: 'loading' };
  if (!token) return { status: 'guest' };
  if (q.isLoading) return { status: 'loading' };
  if (q.isError) return { status: 'error', error: q.error, retry: () => void q.refetch() };
  return q.data ? { status: 'ok', session: q.data } : { status: 'loading' };
}

function homeFor(s: Session): string {
  if (s.user.mustChangePassword) return '/change-password';
  if (s.user.kind === 'platform') return '/admin';
  if (s.user.kind === 'patient') return '/portal';
  if (!s.clinic) return '/select-clinic';
  return '/clinic/dashboard';
}

export function HomeRedirect() {
  const a = useAuthed();
  if (a.status === 'loading') return <PageSkeleton />;
  if (a.status !== 'ok' || !a.session) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(a.session)} replace />;
}

/** Login, forgot/reset, invite: only for guests. */
export function GuestGuard({ children }: { children: ReactNode }) {
  const a = useAuthed();
  if (a.status === 'loading') return <PageSkeleton rows={3} />;
  if (a.status === 'ok' && a.session) return <Navigate to={homeFor(a.session)} replace />;
  return <>{children}</>;
}

type AuthGuardProps = {
  kind?: Session['user']['kind'];
  needsClinic?: boolean;
  children: ReactNode;
};

/** AuthGuard + KindGuard + ClinicGuard (10_FRONTEND.md §3). */
export function AuthGuard({ kind, needsClinic, children }: AuthGuardProps) {
  const a = useAuthed();
  const location = useLocation();
  if (a.status === 'loading') return <PageSkeleton />;
  if (a.status === 'error') return <ErrorState error={a.error} onRetry={a.retry} />;
  if (a.status === 'guest' || !a.session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <Navigate
        to={kind === 'patient' ? `/portal/login?next=${next}` : `/login?next=${next}`}
        replace
      />
    );
  }
  const s = a.session;
  if (s.user.mustChangePassword && location.pathname !== '/change-password')
    return <Navigate to="/change-password" replace />;
  if (kind && s.user.kind !== kind) return <Navigate to={homeFor(s)} replace />;
  if (needsClinic && !s.clinic) return <Navigate to="/select-clinic" replace />;
  return <>{children}</>;
}

/** Reads `handle.perm` of the deepest matched route and shows the 403 screen if missing. */
export function RequirePermission({ children }: { children: ReactNode }) {
  const matches = useMatches();
  const { can } = usePermission();
  const handle = [...matches].reverse().find((m) => (m.handle as RouteHandle | undefined)?.perm)
    ?.handle as RouteHandle | undefined;
  const allowed = can(handle?.perm);
  useEffect(() => {
    if (!allowed && handle?.perm)
      reportIssue({
        kind: 'permission_denied',
        severity: 'low',
        message: 'permission screen',
        code: handle.perm,
      });
  }, [allowed, handle?.perm]);
  if (!allowed) return <NoPermission permission={handle?.perm} />;
  return <>{children}</>;
}
