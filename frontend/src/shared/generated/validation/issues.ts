// SHARED FILE — the canonical copy lives in backend/src/shared/validation.
// Maps a Zod issue to a stable error code + params, identically on the server and in forms.
import type { ZodIssue } from 'zod';

export type ValidationField = { path: string; code: string; params?: Record<string, unknown> };

const CODE = /^[a-z][a-z0-9_]*$/;

function withParams(path: string, code: string, issue: ZodIssue): ValidationField {
  const own = (issue as { params?: Record<string, unknown> }).params;
  if (own) return { path, code, params: own };
  if (issue.code === 'too_small') return { path, code, params: { min: Number(issue.minimum) } };
  if (issue.code === 'too_big') return { path, code, params: { max: Number(issue.maximum) } };
  return { path, code };
}

export function issueToField(issue: ZodIssue): ValidationField {
  const path = issue.path.join('.');
  // Our schemas use codes as messages (`too_short`); Zod's own messages are sentences.
  if (issue.message && CODE.test(issue.message)) return withParams(path, issue.message, issue);
  switch (issue.code) {
    case 'invalid_type':
      return {
        path,
        code: issue.received === 'undefined' || issue.received === 'null' ? 'required' : 'invalid_type',
      };
    case 'too_small':
      if (issue.type === 'string') {
        return issue.minimum === 1
          ? { path, code: 'required' }
          : { path, code: 'too_short', params: { min: Number(issue.minimum) } };
      }
      if (issue.type === 'array') return { path, code: 'too_few', params: { min: Number(issue.minimum) } };
      return { path, code: 'too_small', params: { min: Number(issue.minimum) } };
    case 'too_big':
      if (issue.type === 'string') return { path, code: 'too_long', params: { max: Number(issue.maximum) } };
      if (issue.type === 'array') return { path, code: 'too_many', params: { max: Number(issue.maximum) } };
      return { path, code: 'too_big', params: { max: Number(issue.maximum) } };
    case 'invalid_enum_value':
    case 'invalid_literal':
    case 'invalid_union':
    case 'invalid_union_discriminator':
      return { path, code: 'invalid_option' };
    case 'invalid_string':
      if (issue.validation === 'email') return { path, code: 'invalid_email' };
      if (issue.validation === 'url') return { path, code: 'invalid_url' };
      return { path, code: 'invalid_format' };
    case 'invalid_date':
      return { path, code: 'invalid_date' };
    case 'unrecognized_keys':
      return { path, code: 'unknown_field', params: { keys: issue.keys } };
    default:
      return { path, code: 'invalid' };
  }
}

export function issuesToFields(issues: readonly ZodIssue[], prefix?: string): ValidationField[] {
  return issues.map((i) => {
    const f = issueToField(i);
    if (!prefix || prefix === 'body') return f;
    return { ...f, path: f.path ? `${prefix}.${f.path}` : prefix };
  });
}
