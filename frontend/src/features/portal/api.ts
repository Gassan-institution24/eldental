import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData, postData } from '@/lib/api/axios';
import type { InvoicePrint, ReceiptPrint } from '@/features/billing/api';

/** Patient portal API (01 §4.10). Everything is limited server-side to the account's own files. */

export type ClinicRef = { id: string; name: string; slug: string };
export type PortalPatient = {
  id: string;
  clinic?: ClinicRef;
  fileNumber: string;
  fullName: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female';
  relation: 'self' | 'dependant';
};
export type PortalMe = {
  user: { id: string; displayName: string; email?: string; phone?: string; locale: 'ar' | 'en' };
  clinics: (ClinicRef & { onlineBooking: boolean })[];
  patients: PortalPatient[];
};

export type SeedNamed = { name?: string; systemKey?: string; code?: string };
export type ClinicPage = {
  id: string;
  slug: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  rules: {
    cancellationWindowHours: number;
    minOnlineLeadHours: number;
    maxOnlineDaysAhead: number;
  };
  appointmentTypes: (SeedNamed & { id: string; durationMin: number; color: string })[];
  dentists: {
    id: string;
    name: string;
    color: string;
    specialties: string[];
    primarySpecialty?: string;
  }[];
};
export type DaySlots = { date: string; slots: { start: string; end: string; dentistId: string }[] };

export type PortalAppointment = {
  id: string;
  number: string;
  clinic?: ClinicRef;
  patient?: { id: string; fullName: string };
  start: string;
  end: string;
  status: string;
  upcoming: boolean;
  dentist: { id: string; name: string };
  appointmentType?: SeedNamed & { color: string };
  online: boolean;
  notes: string;
  canCancel: boolean;
  cancelBy: string;
  cancellationWindowHours: number;
};

export type PortalPlan = {
  id: string;
  number: string;
  title: string;
  status: string;
  clinic?: ClinicRef;
  patient: { id: string; fullName: string };
  dentist: string;
  phases: { name: string; order: number }[];
  items: (SeedNamed & {
    id: string;
    phaseIndex: number;
    code: string;
    toothNumbers: number[];
    surfaces: string[];
    quantity: number;
    insuranceEstimate: number;
    patientEstimate: number;
    status: string;
  })[];
  totals: { gross: number; discount: number; insurance: number; patient: number };
  presentedAt?: string;
  validUntil?: string;
  acceptance?: { at: string; signerName?: string };
  notes: string;
  canAccept: boolean;
  expired: boolean;
};

export type PortalBilling = {
  invoices: {
    id: string;
    number: string;
    type: 'invoice' | 'credit_note';
    status: string;
    issueDate?: string;
    dueDate?: string;
    total: number;
    patientTotal: number;
    insuranceTotal: number;
    patientDue: number;
    clinic?: ClinicRef;
    patient: { id: string; fullName: string };
  }[];
  payments: {
    id: string;
    number: string;
    receiptNumber?: string;
    date: string;
    amount: number;
    method: string;
    status: string;
    clinic?: ClinicRef;
    patient?: { id: string; fullName: string };
  }[];
  balances: { patient: { id: string; fullName: string }; clinic?: ClinicRef; balance: number }[];
};

const k = {
  me: ['portal', 'me'] as const,
  appointments: ['portal', 'appointments'] as const,
  plans: ['portal', 'plans'] as const,
  billing: ['portal', 'billing'] as const,
};

export const usePortalMe = () =>
  useQuery({ queryKey: k.me, queryFn: () => getData<PortalMe>('/portal/me') });

export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { displayName?: string; email?: string; locale?: 'ar' | 'en' }) =>
      patchData<PortalMe>('/portal/me', b),
    onSuccess: (me) => qc.setQueryData(k.me, me),
  });
}

export const useOnlineClinics = () =>
  useQuery({
    queryKey: ['portal', 'clinics'],
    queryFn: () => getData<(ClinicRef & { phone?: string; address?: string })[]>('/portal/clinics'),
    staleTime: 5 * 60_000,
  });

export const useClinicPage = (slug: string | undefined) =>
  useQuery({
    queryKey: ['portal', 'clinic', slug],
    queryFn: () => getData<ClinicPage>(`/portal/clinics/${slug}`),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });

export const useOnlineSlots = (
  slug: string | undefined,
  q: { appointmentTypeId?: string; dentistId?: string; from: string; to: string },
) =>
  useQuery({
    queryKey: ['portal', 'slots', slug, q],
    queryFn: () =>
      getData<{ durationMin: number; days: DaySlots[] }>(`/portal/clinics/${slug}/availability`, {
        params: q,
      }),
    enabled: Boolean(slug && q.appointmentTypeId),
  });

export function useLinkFile() {
  const qc = useQueryClient();
  return {
    start: useMutation({
      mutationFn: (b: { clinicSlug: string; fileNumber: string }) =>
        postData<{ phoneHint: string; expiresInMinutes: number; devCode?: string }>(
          '/portal/link-patient/start',
          b,
        ),
    }),
    confirm: useMutation({
      mutationFn: (b: { clinicSlug: string; fileNumber: string; code: string }) =>
        postData<PortalMe>('/portal/link-patient', b),
      onSuccess: (me) => {
        qc.setQueryData(k.me, me);
        void qc.invalidateQueries({ queryKey: ['portal'] });
      },
    }),
  };
}

export function useAddDependant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: {
      guardianPatientId: string;
      first: string;
      family: string;
      dateOfBirth: string;
      gender: 'male' | 'female';
    }) => postData<PortalMe>('/portal/dependants', b),
    onSuccess: (me) => qc.setQueryData(k.me, me),
  });
}

export const usePortalAppointments = () =>
  useQuery({
    queryKey: k.appointments,
    queryFn: () => getData<PortalAppointment[]>('/portal/appointments'),
  });

export function useBookOnline() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: {
      clinicSlug: string;
      patientId?: string;
      appointmentTypeId: string;
      dentistId: string;
      start: string;
      notes?: string;
    }) => postData<PortalAppointment>('/portal/appointments', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
}

export function useCancelAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      postData<PortalAppointment>(`/portal/appointments/${id}/cancel`, comment ? { comment } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
}

export const usePortalPlans = () =>
  useQuery({ queryKey: k.plans, queryFn: () => getData<PortalPlan[]>('/portal/treatment-plans') });

export function useAcceptPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...b
    }: {
      id: string;
      itemIds?: string[];
      signature: string;
      signerName: string;
    }) => postData<PortalPlan>(`/portal/treatment-plans/${id}/accept`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: k.plans }),
  });
}

export const usePortalBilling = () =>
  useQuery({ queryKey: k.billing, queryFn: () => getData<PortalBilling>('/portal/billing') });

export const fetchPortalInvoicePrint = (id: string) =>
  getData<InvoicePrint>(`/portal/invoices/${id}/print`);
export const fetchPortalReceipt = (id: string) =>
  getData<ReceiptPrint>(`/portal/payments/${id}/receipt`);
