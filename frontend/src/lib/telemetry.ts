import { env } from '@/config/env';
import { getAccessToken } from '@/stores/authStore';
import { getSessionId } from './session';

/**
 * Frontend tracker (15_LOGGING_AND_MONITORING.md §3): activity + user issues, batched,
 * flushed every 5 s / 20 events and on pagehide via sendBeacon. Never sends typed values.
 */
export type ActivityType =
  | 'page_view'
  | 'action'
  | 'search'
  | 'filter'
  | 'download'
  | 'session_start'
  | 'session_end'
  | 'clinic_switch'
  | 'language_switch';

export type ActivityEvent = {
  type: ActivityType;
  route: string;
  at: string;
  action?: string;
  entity?: string;
  entityId?: string;
  meta?: Record<string, string | number | boolean | null>;
  durationMs?: number;
};

export type IssueKind =
  | 'js_error'
  | 'api_error'
  | 'validation_error'
  | 'slow_page'
  | 'offline'
  | 'permission_denied'
  | 'rage_click'
  | 'user_report';

export type IssueEvent = {
  kind: IssueKind;
  severity: 'low' | 'medium' | 'high';
  message: string;
  route: string;
  at: string;
  code?: string;
  component?: string;
  stack?: string;
  api?: { method: string; path: string; status: number; durationMs?: number; reqId?: string };
  validation?: { form: string; fields: { field: string; rule: string }[] };
  userComment?: string;
  /** JPEG data URL, only for user reports and only when the user ticks the box. */
  screenshot?: string;
  context?: { recentActivity: ActivityEvent[]; failedReqIds: string[] };
};

const FLUSH_MS = 5000;
const MAX_BATCH = 20;

const activityQueue: ActivityEvent[] = [];
const issueQueue: IssueEvent[] = [];
const recentActivity: ActivityEvent[] = [];
const failedReqIds: string[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let currentRoute = '/';
let enabled = !env.isTest;

export function setTelemetryEnabled(v: boolean): void {
  enabled = v;
}

export function setCurrentRoute(route: string): void {
  currentRoute = route;
}

export function getCurrentRoute(): string {
  return currentRoute;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Session-Id': getSessionId(),
    'X-App-Version': env.appVersion,
  };
  const token = getAccessToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function post(path: string, body: unknown, useBeacon: boolean): Promise<boolean> {
  const url = `${env.apiUrl}/telemetry/${path}`;
  const payload = JSON.stringify({
    sessionId: getSessionId(),
    appVersion: env.appVersion,
    ...(body as object),
  });
  if (useBeacon && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    return navigator.sendBeacon(url, new Blob([payload], { type: 'text/plain' }));
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: payload,
      credentials: 'include',
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function flush(useBeacon = false): Promise<void> {
  if (!enabled) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return; // retried when back online
  if (activityQueue.length) {
    const batch = activityQueue.splice(0, activityQueue.length);
    const ok = await post('activity', { events: batch }, useBeacon);
    if (!ok) activityQueue.unshift(...batch.slice(-100));
  }
  if (issueQueue.length) {
    const batch = issueQueue.splice(0, issueQueue.length);
    const ok = await post('issues', { issues: batch }, useBeacon);
    if (!ok) issueQueue.unshift(...batch.slice(-50));
  }
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_MS);
}

export function trackActivity(e: Omit<ActivityEvent, 'at' | 'route'> & { route?: string }): void {
  const event: ActivityEvent = {
    ...e,
    route: e.route ?? currentRoute,
    at: new Date().toISOString(),
  };
  recentActivity.push(event);
  if (recentActivity.length > 20) recentActivity.shift();
  if (!enabled) return;
  activityQueue.push(event);
  if (activityQueue.length >= MAX_BATCH) void flush();
  else schedule();
}

/** Key action (see shared/telemetry/actions.ts for the list of names). */
export function track(action: string, meta?: ActivityEvent['meta']): void {
  trackActivity({ type: 'action', action, ...(meta ? { meta } : {}) });
}

export function reportIssue(e: Omit<IssueEvent, 'at' | 'route'> & { route?: string }): void {
  if (e.api?.reqId) {
    failedReqIds.push(e.api.reqId);
    if (failedReqIds.length > 20) failedReqIds.shift();
  }
  if (!enabled) return;
  issueQueue.push({ ...e, route: e.route ?? currentRoute, at: new Date().toISOString() });
  schedule();
}

/** Context attached to "Report a problem" (last 20 activity events + failed reqIds). */
export function getReportContext(): { recentActivity: ActivityEvent[]; failedReqIds: string[] } {
  return { recentActivity: [...recentActivity], failedReqIds: [...failedReqIds] };
}

let installed = false;

/** Global hooks: JS errors, unhandled rejections, offline, pagehide flush, slow loads. */
export function installTelemetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    reportIssue({
      kind: 'js_error',
      severity: 'high',
      message: String(ev.message).slice(0, 500),
      ...(ev.error instanceof Error && ev.error.stack
        ? { stack: ev.error.stack.slice(0, 4000) }
        : {}),
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason as unknown;
    if (
      reason &&
      typeof reason === 'object' &&
      'name' in reason &&
      (reason as { name: string }).name === 'ApiError'
    )
      return;
    reportIssue({
      kind: 'js_error',
      severity: 'medium',
      message: (reason instanceof Error ? reason.message : String(reason)).slice(0, 500),
      ...(reason instanceof Error && reason.stack ? { stack: reason.stack.slice(0, 4000) } : {}),
    });
  });
  window.addEventListener('offline', () =>
    reportIssue({ kind: 'offline', severity: 'low', message: 'offline' }),
  );
  window.addEventListener('online', () => void flush());
  window.addEventListener('pagehide', () => void flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush(true);
  });
}

/** Reports a navigation that took longer than 3 s to render. */
export function reportSlowPage(route: string, durationMs: number): void {
  if (durationMs > 3000) {
    reportIssue({
      kind: 'slow_page',
      severity: 'low',
      message: 'slow page',
      route,
      api: undefined,
      code: String(Math.round(durationMs)),
    });
  }
}
