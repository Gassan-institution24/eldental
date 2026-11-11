import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authKeys } from '@/features/auth/api/session';
import { getData, patchData, postData, putData } from '@/lib/api/axios';
import { resourceHooks, type Entity } from '@/shared/api/resource';

export type WorkingHour = { weekday: number; open: string; close: string; closed: boolean };
export type ClinicSettings = {
  cancellationWindowHours: number;
  noShowGraceMinutes: number;
  onlineBookingEnabled: boolean;
  minOnlineLeadHours: number;
  maxOnlineDaysAhead: number;
  defaultAppointmentMinutes: number;
  vatRegistered: boolean;
  invoiceFooter: string;
  fiscalYearStartMonth: number;
  maxDiscountPercentWithoutApproval: number;
  printLanguage: 'ar' | 'en';
  weekendDays: number[];
  consentMode: 'off' | 'warn' | 'strict';
};
export type Clinic = Entity & {
  name: string;
  slug: string;
  phone?: string;
  email?: string;
  addressLine1: string;
  taxNumber?: string;
  commercialRegNo?: string;
  timezone: string;
  currency: string;
  locale: 'ar' | 'en';
  workingHours: WorkingHour[];
  settings: ClinicSettings;
  integrations: {
    jofotara: {
      enabled: boolean;
      clientId: string;
      activityNumber: string;
      incomeSourceSequence: string;
      hasSecret: boolean;
    };
    whatsapp: { enabled: boolean };
  };
  readOnly: boolean;
  onboarding?: { completedSteps: string[]; completedAt?: string };
};

export const clinicKey = ['clinic'] as const;

export function useClinic(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: clinicKey,
    queryFn: () => getData<Clinic>('/clinic'),
    enabled: opts.enabled ?? true,
  });
}

export function useUpdateClinic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown> & { version: number }) =>
      patchData<Clinic>('/clinic', body),
    onSuccess: (data) => {
      qc.setQueryData(clinicKey, data);
      void qc.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export function useSaveJofotara() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => putData('/clinic/integrations/jofotara', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: clinicKey }),
  });
}

export function useOnboardingStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (step: string) => postData<Clinic>('/clinic/onboarding', { step }),
    onSuccess: (data) => {
      qc.setQueryData(clinicKey, data);
      void qc.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

export type Chair = Entity & {
  name: string;
  roomName: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
};
export const chairsApi = resourceHooks<Chair>('/chairs');

export type AppointmentType = Entity & {
  name: string | null;
  systemKey?: string;
  code: string;
  defaultDurationMin: number;
  color: string;
  bufferAfterMin: number;
  allowOnline: boolean;
  requiresDeposit: boolean;
  isActive: boolean;
};
export const appointmentTypesApi = resourceHooks<AppointmentType>('/appointment-types');

export const PROCEDURE_CATEGORIES = [
  'diagnostic',
  'preventive',
  'restorative',
  'endodontics',
  'periodontics',
  'prosthodontics',
  'oral_surgery',
  'orthodontics',
  'implants',
  'cosmetic',
  'other',
] as const;
export type ProcedureCategory = (typeof PROCEDURE_CATEGORIES)[number];

export type ClinicProcedure = Entity & {
  code: string;
  name: string | null;
  systemKey?: string;
  category: ProcedureCategory;
  price: number;
  taxRateId?: string;
  defaultDurationMin: number;
  toothRequired: boolean;
  surfacesRequired: boolean;
  labRequired: boolean;
  commissionEligible: boolean;
  chartEffect?: { setStatus?: string; addCondition?: string };
  isActive: boolean;
};
export const proceduresApi = resourceHooks<ClinicProcedure>('/procedures');

export type TaxRate = Entity & {
  name: string | null;
  systemKey?: string;
  rate: number;
  jofotaraCategory: 'S' | 'Z' | 'O';
  isDefault: boolean;
  isActive: boolean;
};
export const taxRatesApi = resourceHooks<TaxRate>('/tax-rates');

export type CatalogProcedure = {
  id: string;
  code: string;
  name: string | null;
  category: ProcedureCategory;
  suggestedPrice: number;
  defaultDurationMin: number;
};

export function useCatalogProcedures(enabled: boolean) {
  return useQuery({
    queryKey: ['catalog', 'procedures'],
    queryFn: () => getData<CatalogProcedure[]>('/catalog/procedures'),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useImportProcedures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { codes: string[]; priceFactorPercent: number }) =>
      postData<{ imported: number; skipped: number }>('/procedures/import-from-catalog', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: proceduresApi.keys.all }),
  });
}
