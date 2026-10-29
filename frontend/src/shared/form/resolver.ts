import type { FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { ZodTypeAny } from 'zod';
import { issueToField } from '@/shared/generated/validation/issues';

/** Error messages are encoded `{code, params}` so the UI can translate them with params. */
export type EncodedError = { code: string; params?: Record<string, unknown> };

export function encodeError(e: EncodedError): string {
  return JSON.stringify(e);
}

export function decodeError(message: string | undefined): EncodedError | null {
  if (!message) return null;
  try {
    const v = JSON.parse(message) as EncodedError;
    return typeof v.code === 'string' ? v : { code: message };
  } catch {
    return { code: message };
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node = target;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) {
      if (!(k in node)) node[k] = value;
      return;
    }
    node[k] = (node[k] as Record<string, unknown> | undefined) ?? {};
    node = node[k] as Record<string, unknown>;
  });
}

/**
 * Zod resolver that produces the SAME codes the server returns (shared `issueToField`),
 * and hands the parsed + normalised values (E.164 phones, trimmed names) to onSubmit.
 */
export function zodI18nResolver<T extends FieldValues>(schema: ZodTypeAny): Resolver<T> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data as T, errors: {} };
    const errors: Record<string, unknown> = {};
    for (const issue of result.error.issues) {
      const f = issueToField(issue);
      const path = f.path || 'root';
      setPath(errors, path, { type: f.code, message: encodeError({ code: f.code, ...(f.params ? { params: f.params } : {}) }) });
    }
    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
