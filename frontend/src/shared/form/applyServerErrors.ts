import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { isApiError } from '@/lib/api/apiError';
import { encodeError } from './resolver';

/**
 * Maps a 422 `details.fields` (and 403 FIELD_FORBIDDEN `details.fields`) onto form inputs.
 * Returns the paths that could not be placed on a registered field (shown in the alert).
 */
export function applyServerErrors<T extends FieldValues>(form: UseFormReturn<T>, err: unknown): { mapped: string[]; unmapped: string[] } {
  const mapped: string[] = [];
  const unmapped: string[] = [];
  if (!isApiError(err)) return { mapped, unmapped };

  if (err.code === 'FIELD_FORBIDDEN' && Array.isArray(err.details?.fields)) {
    for (const f of err.details.fields as string[]) {
      form.setError(f as Path<T>, { type: 'field_forbidden', message: encodeError({ code: 'field_forbidden' }) }, { shouldFocus: mapped.length === 0 });
      mapped.push(f);
    }
    return { mapped, unmapped };
  }

  const values = form.getValues() as Record<string, unknown>;
  for (const issue of err.fields) {
    const path = issue.path.replace(/^(body|query|params)\./, '');
    const top = path.split('.')[0] ?? '';
    if (!path || !(top in values)) {
      unmapped.push(path);
      continue;
    }
    form.setError(
      path as Path<T>,
      { type: issue.code, message: encodeError({ code: issue.code, ...(issue.params ? { params: issue.params } : {}) }) },
      { shouldFocus: mapped.length === 0 },
    );
    mapped.push(path);
  }
  return { mapped, unmapped };
}
