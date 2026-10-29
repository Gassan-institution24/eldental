import { useCallback } from 'react';
import { api, postData, setAuthHandlers } from '@/lib/api/axios';
import { queryClient } from '@/lib/api/queryClient';
import { rotateSessionId } from '@/lib/session';
import { flush, trackActivity } from '@/lib/telemetry';
import { useAuthStore } from '@/stores/authStore';
import type { LoginResponse } from '../types';

/** Multi-tab sync of logout and refreshed tokens (10_FRONTEND.md §4). */
type AuthMessage = { type: 'token'; token: string } | { type: 'logout' };
const channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('auth') : null;

channel?.addEventListener('message', (ev: MessageEvent<AuthMessage>) => {
  if (ev.data.type === 'token') useAuthStore.getState().setAccessToken(ev.data.token);
  if (ev.data.type === 'logout') {
    useAuthStore.getState().clear();
    queryClient.clear();
  }
});

export function storeToken(token: string, broadcast = true): void {
  useAuthStore.getState().setAccessToken(token);
  if (broadcast) channel?.postMessage({ type: 'token', token } satisfies AuthMessage);
}

/** POST /auth/refresh (cookie). Returns the new access token or null. */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await api.post<{ data: { accessToken: string } }>('/auth/refresh', undefined, { skipAuthRefresh: true, silent: true });
    const token = res.data.data.accessToken;
    storeToken(token);
    return token;
  } catch {
    return null;
  }
}

function localLogout(): void {
  useAuthStore.getState().clear();
  queryClient.clear();
  channel?.postMessage({ type: 'logout' } satisfies AuthMessage);
}

let redirecting = false;
function logoutAndRedirect(): void {
  if (!useAuthStore.getState().accessToken) return;
  localLogout();
  if (redirecting) return;
  redirecting = true;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

setAuthHandlers(refreshAccessToken, logoutAndRedirect);

/** On app load: try the refresh cookie; a failure just means "guest". */
export async function bootstrapAuth(): Promise<void> {
  await refreshAccessToken();
  useAuthStore.getState().setBootstrapped(true);
}

export async function login(body: { identifier: string; password: string; remember: boolean }): Promise<LoginResponse> {
  const isEmail = body.identifier.includes('@');
  const res = await postData<LoginResponse>(
    '/auth/login',
    { ...(isEmail ? { email: body.identifier } : { phone: body.identifier }), password: body.password, remember: body.remember },
    { skipAuthRefresh: true },
  );
  if (res.accessToken) {
    rotateSessionId();
    storeToken(res.accessToken);
    trackActivity({ type: 'session_start' });
  }
  return res;
}

export async function loginMfa(body: { mfaToken: string; code: string }): Promise<LoginResponse> {
  const res = await postData<LoginResponse>('/auth/login/mfa', body, { skipAuthRefresh: true });
  if (res.accessToken) {
    rotateSessionId();
    storeToken(res.accessToken);
    trackActivity({ type: 'session_start' });
  }
  return res;
}

export async function selectClinic(clinicId: string): Promise<void> {
  const res = await postData<{ accessToken: string }>('/auth/select-clinic', { clinicId });
  storeToken(res.accessToken);
  queryClient.clear();
  trackActivity({ type: 'clinic_switch', entity: 'clinic', entityId: clinicId });
}

export function useLogout() {
  return useCallback(async () => {
    trackActivity({ type: 'session_end' });
    await flush();
    await api.post('/auth/logout', undefined, { skipAuthRefresh: true, silent: true }).catch(() => undefined);
    localLogout();
    window.location.assign('/login');
  }, []);
}

export const authApi = {
  forgot: (target: string) => postData<void>('/auth/password/forgot', { target }, { skipAuthRefresh: true }),
  reset: (body: { target: string; code: string; newPassword: string }) => postData<void>('/auth/password/reset', body, { skipAuthRefresh: true }),
  change: (body: { currentPassword: string; newPassword: string }) => postData<{ accessToken?: string }>('/auth/password/change', body),
  acceptInvitation: (body: { token: string; password: string }) => postData<LoginResponse>('/auth/invitations/accept', body, { skipAuthRefresh: true }),
  invitationInfo: (token: string) => api.get<{ data: { email?: string; displayName: string; clinicName?: string } }>(`/auth/invitations/${encodeURIComponent(token)}`, { skipAuthRefresh: true }).then((r) => r.data.data),
  logoutAll: () => postData<void>('/auth/logout-all'),
  mfaSetup: () => postData<{ secret: string; otpauthUrl: string; qrDataUrl: string }>('/auth/mfa/setup'),
  mfaEnable: (body: { code: string; mfaToken?: string }) => postData<{ recoveryCodes: string[]; accessToken?: string }>('/auth/mfa/enable', body, { skipAuthRefresh: Boolean(body.mfaToken) }),
  mfaDisable: (body: { code: string }) => postData<void>('/auth/mfa/disable', body),
};
