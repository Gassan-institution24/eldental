import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type UseFormProps,
  type UseFormReturn,
} from 'react-hook-form';
import type { ZodTypeAny } from 'zod';
import { zodI18nResolver } from './resolver';

type Options<T extends FieldValues> = Omit<
  UseFormProps<T>,
  'resolver' | 'mode' | 'reValidateMode'
> & {
  schema: ZodTypeAny;
  defaultValues: DefaultValues<T>;
};

/**
 * Validation timing (16_UX_UI_AND_VALIDATION.md §5.2): first check on blur, then re-check on
 * change so an error disappears as soon as it is fixed; everything is checked on submit.
 */
export function useAppForm<T extends FieldValues>({
  schema,
  ...rest
}: Options<T>): UseFormReturn<T> {
  return useForm<T>({
    ...rest,
    resolver: zodI18nResolver<T>(schema),
    mode: 'onTouched',
    reValidateMode: 'onChange',
    // <Form> focuses the first invalid field in screen order (Zod reports async issues out of order).
    shouldFocusError: false,
  });
}
