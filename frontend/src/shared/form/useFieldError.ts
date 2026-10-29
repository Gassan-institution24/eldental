import { useFormContext, get, type FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { decodeError } from './resolver';

/** Translates a field's error code with the field's own label (16_UX_UI_AND_VALIDATION.md §5.6). */
export function useErrorText() {
  const { t } = useTranslation();
  return (error: FieldError | undefined, label: string): string | undefined => {
    if (!error) return undefined;
    const decoded = decodeError(error.message) ?? { code: error.type ?? 'invalid' };
    return t(`validation:${decoded.code}`, {
      field: label,
      ...(decoded.params ?? {}),
      defaultValue: t(`errors:${decoded.code}`, { defaultValue: t('validation:invalid', { field: label }) }),
    });
  };
}

export function useFieldError(name: string): FieldError | undefined {
  const { formState } = useFormContext();
  return get(formState.errors, name) as FieldError | undefined;
}
