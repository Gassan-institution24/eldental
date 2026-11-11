import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, getData } from '@/lib/api/axios';
import { useAuthStore } from '@/stores/authStore';
import '../authApi';

/**
 * Token renewal must not sign people out (and bounce them to the login) on a temporary
 * failure; only a 401 from /auth/refresh ends the session.
 */
type Reply = { status: number; data: unknown };
let refreshReplies: Reply[] = [];
let refreshCalls = 0;
let meAuth: string[] = [];

function reply(config: InternalAxiosRequestConfig, r: Reply): Promise<AxiosResponse> {
  const res = { status: r.status, statusText: '', data: r.data, headers: {}, config };
  if (r.status < 400) return Promise.resolve(res);
  return Promise.reject(new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, res));
}

const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  refreshReplies = [];
  refreshCalls = 0;
  meAuth = [];
  useAuthStore.setState({ accessToken: 'old', bootstrapped: true });
  api.defaults.adapter = (config) => {
    if (config.url === '/auth/refresh') {
      refreshCalls += 1;
      return reply(config, refreshReplies.shift() ?? { status: 500, data: {} });
    }
    const auth = String(config.headers.get('Authorization'));
    meAuth.push(auth);
    return auth === 'Bearer fresh'
      ? reply(config, { status: 200, data: { data: { ok: true } } })
      : reply(config, { status: 401, data: { error: { code: 'TOKEN_EXPIRED', message: 'x' } } });
  };
});

afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

const renewed = { status: 200, data: { data: { accessToken: 'fresh' } } };

describe('session renewal', () => {
  it('renews an expired token and retries the request', async () => {
    refreshReplies = [renewed];
    await expect(getData('/auth/me')).resolves.toEqual({ ok: true });
    expect(useAuthStore.getState().accessToken).toBe('fresh');
  });

  it('keeps the session through a temporary failure (429, then success)', async () => {
    refreshReplies = [{ status: 429, data: { error: { code: 'RATE_LIMITED' } } }, renewed];
    await expect(getData('/auth/me')).resolves.toEqual({ ok: true });
    expect(refreshCalls).toBe(2);
    expect(useAuthStore.getState().accessToken).toBe('fresh');
  });

  it('does not sign out when the server stays unreachable', async () => {
    refreshReplies = [{ status: 503, data: {} }, { status: 503, data: {} }, { status: 503, data: {} }];
    await expect(getData('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().accessToken).toBe('old');
  });

  it('signs out only when the server says the session is over', async () => {
    refreshReplies = [{ status: 401, data: { error: { code: 'SESSION_REVOKED' } } }];
    await expect(getData('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('retries with a token another tab already renewed, without a second refresh', async () => {
    api.defaults.adapter = (config) => {
      const auth = String(config.headers.get('Authorization'));
      meAuth.push(auth);
      // The request left with the old token; meanwhile a broadcast stored the fresh one.
      if (auth === 'Bearer old') useAuthStore.setState({ accessToken: 'fresh' });
      return auth === 'Bearer fresh'
        ? reply(config, { status: 200, data: { data: { ok: true } } })
        : reply(config, { status: 401, data: { error: { code: 'TOKEN_INVALID', message: 'x' } } });
    };
    await expect(getData('/auth/me')).resolves.toEqual({ ok: true });
    expect(meAuth).toEqual(['Bearer old', 'Bearer fresh']);
    expect(refreshCalls).toBe(0);
  });
});
