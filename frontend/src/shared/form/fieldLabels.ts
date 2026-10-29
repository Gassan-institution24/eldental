import { createContext, useContext, useEffect, useMemo } from 'react';

/** Inputs register their visible label so the error summary shows what the user sees. */
export type FieldLabelRegistry = Map<string, string>;

export const FieldLabelsContext = createContext<FieldLabelRegistry | null>(null);

export function useFieldLabelRegistry(): FieldLabelRegistry {
  return useMemo(() => new Map<string, string>(), []);
}

export function useRegisterLabel(name: string, label: string): void {
  const registry = useContext(FieldLabelsContext);
  useEffect(() => {
    registry?.set(name, label);
    return () => {
      registry?.delete(name);
    };
  }, [registry, name, label]);
}
