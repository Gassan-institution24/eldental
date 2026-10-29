import type { TFunction } from 'i18next';

export type FieldIssue = { path: string; code: string; params?: Record<string, unknown> };

/** Normalised API error (10_FRONTEND.md §4). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get fields(): FieldIssue[] {
    const f = this.details?.fields;
    return Array.isArray(f) ? (f as FieldIssue[]) : [];
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Translated message for any error: `errors.<CODE>` with details as params. */
export function getErrorMessage(err: unknown, t: TFunction): string {
  if (isApiError(err)) {
    const params = { ...(err.details ?? {}) } as Record<string, unknown>;
    return t(`errors:${err.code}`, { ...params, defaultValue: t('errors:UNKNOWN') });
  }
  return t('errors:UNKNOWN');
}
