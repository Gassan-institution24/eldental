import type { ZodError } from 'zod';
import { issueToField, issuesToFields, type ValidationField } from '@/shared/validation/issues';

export { issueToField };

export function zodErrorToFields(err: ZodError, prefix?: string): ValidationField[] {
  return issuesToFields(err.issues, prefix);
}
