import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import i18n from '@/i18n';
import { env } from '@/config/env';
import { getAccessToken } from '@/stores/authStore';
import { getSessionId } from '../session';
import { reportIssue } from '../telemetry';
import { ApiError } from './apiError';

/** The single axios instance (no headers on the global axios). */
export const api = axios.create({
  baseURL: env.apiUrl,
  withCredentials: true,
  timeout: 30000,
});

type RetryConfig = InternalAxiosRequestConfig & {
  _retried?: boolean;
  _startedAt?: number;
  skipAuthRefresh?: boolean;
  silent?: boolean;
};

api.interceptors.request.use((config: RetryConfig) => {
  config.headers.set('X-Requested-With', 'XMLHttpRequest');
  config.headers.set('X-Session-Id', getSessionId());
  config.headers.set('X-App-Version', env.appVersion);
  config.headers.set('Accept-Language', i18n.resolvedLanguage ?? env.defaultLang);
  const token = getAccessToken();
  if (token && !config.headers.has('Authorization'))
    config.headers.set('Authorization', `Bearer ${token}`);
  config._startedAt = Date.now();
  return config;
});

type RefreshHandler = () => Promise<string | null>;
type LogoutHandler = () => void;
let refreshHandler: RefreshHandler | null = null;
let logoutHandler: LogoutHandler | null = null;
let refreshing: Promise<string | null> | null = null;

/** Wired by the auth feature (keeps this module free of feature imports). */
export function setAuthHandlers(refresh: RefreshHandler, logout: LogoutHandler): void {
  refreshHandler = refresh;
  logoutHandler = logout;
}

/** Single-flight refresh: concurrent 401s wait for the same refresh call. */
export function refreshOnce(): Promise<string | null> {
  if (!refreshHandler) return Promise.resolve(null);
  refreshing ??= refreshHandler().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function toApiError(error: AxiosError): ApiError {
  if (!error.response) {
    return new ApiError(
      0,
      error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
      error.message,
    );
  }
  const body = error.response.data as
    | {
        error?: {
          code?: string;
          message?: string;
          details?: Record<string, unknown>;
          requestId?: string;
        };
      }
    | undefined;
  const e = body?.error;
  return new ApiError(
    error.response.status,
    e?.code ?? `HTTP_${error.response.status}`,
    e?.message ?? error.message,
    e?.details,
    e?.requestId ?? (error.response.headers['x-request-id'] as string | undefined),
  );
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = (error.config ?? {}) as RetryConfig;
    const apiErr = toApiError(error);

    if (
      apiErr.status === 401 &&
      apiErr.code === 'TOKEN_EXPIRED' &&
      !config._retried &&
      !config.skipAuthRefresh
    ) {
      config._retried = true;
      const token = await refreshOnce();
      if (token) {
        config.headers.set('Authorization', `Bearer ${token}`);
        return api.request(config);
      }
      logoutHandler?.();
      return Promise.reject(apiErr);
    }
    if (apiErr.status === 401 && !config.skipAuthRefresh) logoutHandler?.();

    // 422s are tracked by the form wrapper (field + rule), 401 is a normal flow.
    if (!config.silent && apiErr.status !== 401 && apiErr.status !== 422) {
      reportIssue({
        kind: apiErr.status === 403 ? 'permission_denied' : 'api_error',
        severity: apiErr.status >= 500 || apiErr.status === 0 ? 'high' : 'low',
        message: apiErr.message.slice(0, 300),
        code: apiErr.code,
        api: {
          method: (config.method ?? 'get').toUpperCase(),
          path: (config.url ?? '').split('?')[0] ?? '',
          status: apiErr.status,
          durationMs: config._startedAt ? Date.now() - config._startedAt : 0,
          ...(apiErr.requestId ? { reqId: apiErr.requestId } : {}),
        },
      });
    }
    return Promise.reject(apiErr);
  },
);

export type ApiEnvelope<T> = { data: T; meta?: Record<string, unknown> };
export type Paged<T> = {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
};

export async function getData<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const res = await api.get<ApiEnvelope<T>>(url, config);
  return res.data.data;
}

export async function getPaged<T>(url: string, params?: object): Promise<Paged<T>> {
  const res = await api.get<Paged<T>>(url, { params });
  return res.data;
}

export async function postData<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await api.post<ApiEnvelope<T>>(url, body, config);
  return res.data?.data;
}

export async function patchData<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await api.patch<ApiEnvelope<T>>(url, body, config);
  return res.data?.data;
}

export async function putData<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await api.put<ApiEnvelope<T>>(url, body, config);
  return res.data?.data;
}

export async function deleteData(url: string, config?: AxiosRequestConfig): Promise<void> {
  await api.delete(url, config);
}

declare module 'axios' {
  interface AxiosRequestConfig {
    skipAuthRefresh?: boolean;
    silent?: boolean;
  }
}
