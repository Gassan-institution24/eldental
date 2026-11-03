import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, deleteData, getData, patchData, postData } from '@/lib/api/axios';
import { resourceHooks, type Entity } from '@/shared/api/resource';

export type PatientName = { first: string; father?: string; grandfather?: string; family: string };
export type Patient = Entity & {
  fileNumber: string;
  name: PatientName;
  fullName: string;
  gender?: 'male' | 'female';
  dateOfBirth?: string;
  nationalId?: string;
  passportNo?: string;
  phone?: string;
  altPhone?: string;
  email?: string;
  address?: { line1?: string; city?: string };
  guardian?: { patientId?: string; name: string; relation: string; phone: string };
  familyGroupId?: string;
  emergencyContact?: { name: string; relation?: string; phone: string };
  referralSource?: string;
  referredBy?: {
    type: 'patient' | 'doctor' | 'campaign' | 'other';
    patientId?: string;
    patientName?: string;
    patientFileNumber?: string;
    name?: string;
    note?: string;
  };
  nationality?: string;
  maritalStatus?: 'single' | 'married' | 'divorced' | 'widowed';
  occupation?: string;
  bloodType?: string;
  heightCm?: number;
  weightKg?: number;
  bmi?: number;
  legacyFileNumber?: string;
  photoFileId?: string;
  photoUrl?: string;
  idVerifiedAt?: string;
  idVerifiedBy?: string;
  idVerifiedByName?: string;
  flags?: { code: string; note?: string }[];
  preferredDentist?: string;
  preferredDentistName?: string;
  preferredLanguage?: 'ar' | 'en';
  communicationPrefs?: { whatsapp?: boolean; sms?: boolean; email?: boolean; marketing?: boolean };
  medicalAlerts: string[];
  balance?: number;
  tags: string[];
  notes?: string;
  status: 'active' | 'inactive' | 'deceased' | 'merged';
  mergedIntoId?: string;
  lastVisitAt?: string;
  noShowCount?: number;
  hasPortalAccount?: boolean;
  createdAt: string;
};

export const patientsApi = resourceHooks<Patient>('/patients');

export type PatientHit = {
  id: string;
  fileNumber: string;
  legacyFileNumber?: string;
  fullName: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: string;
  medicalAlerts?: string[];
  balance?: number;
  status: string;
};

export function usePatientSearch(q: string) {
  return useQuery({
    queryKey: ['/patients', 'search', q],
    queryFn: () => getData<PatientHit[]>('/patients/search', { params: { q, limit: 8 } }),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
  });
}

export function useDuplicateCheck(phone: string | undefined, excludeId?: string) {
  return useQuery({
    queryKey: ['/patients', 'duplicate', phone, excludeId],
    queryFn: () =>
      getData<{ id: string; fileNumber: string; fullName: string }[]>('/patients/check-duplicate', {
        params: { phone, excludeId },
        silent: true,
      }),
    enabled: Boolean(phone && phone.replace(/\D/g, '').length >= 9),
    staleTime: 30_000,
  });
}

/** Undo for a soft delete (16 §4). */
export function useRestorePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postData<void>(`/patients/${id}/restore`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients'] }),
  });
}

export function useMergePatient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sourceId, reason }: { id: string; sourceId: string; reason: string }) =>
      postData<Patient>(`/patients/${id}/merge`, { sourceId, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients'] }),
  });
}

export type MedicalHistory = Entity & {
  version: number;
  conditions: string[];
  medications: string;
  medicationsList: { name: string; medicineId?: string; dose?: string; frequency?: string; since?: string }[];
  surgeries: { name: string; year?: number; note?: string }[];
  lifestyle: { smoking?: 'none' | 'former' | 'light' | 'heavy'; alcohol?: 'none' | 'light' | 'heavy' };
  pregnancyWeeks?: number;
  allergies: { substance: string; reaction?: string; severity: 'mild' | 'moderate' | 'severe' }[];
  notes: string;
  reviewedAt?: string;
  createdAt: string;
};

export function useMedicalHistory(patientId: string, enabled = true) {
  return useQuery({
    queryKey: ['/patients', patientId, 'medical'],
    queryFn: () => getData<MedicalHistory | null>(`/patients/${patientId}/medical-history`),
    enabled,
  });
}

export function useMedicalVersions(patientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['/patients', patientId, 'medical', 'versions'],
    queryFn: () => getData<MedicalHistory[]>(`/patients/${patientId}/medical-history/versions`),
    enabled,
  });
}

/** Medicine names for the history editor's autocomplete (global catalog). */
export function useMedicineSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: ['medicines', q],
    staleTime: 300_000,
    enabled,
    queryFn: () => getData<{ id: string; name: string; dose?: string; frequency?: string }[]>('/catalog/medicines', { params: q ? { q } : {} }),
  });
}

export function useSaveMedicalHistory(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      postData<MedicalHistory>(`/patients/${patientId}/medical-history`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients'] }),
  });
}

export type Policy = Entity & {
  insuranceCompanyId: string;
  insuranceCompanyName: string;
  planName?: string;
  memberNumber: string;
  relationToSubscriber: 'self' | 'spouse' | 'child' | 'other';
  validFrom?: string;
  validTo?: string;
  coveragePercentOverride?: number;
  annualMax?: number;
  usedThisYear?: number;
  isPrimary: boolean;
};

export function usePolicies(patientId: string) {
  return useQuery({
    queryKey: ['/patients', patientId, 'policies'],
    queryFn: () => getData<Policy[]>(`/patients/${patientId}/insurance-policies`),
  });
}

export function useSavePolicy(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Record<string, unknown> & { id?: string }) =>
      id
        ? patchData<Policy>(`/patients/${patientId}/insurance-policies/${id}`, body)
        : postData<Policy>(`/patients/${patientId}/insurance-policies`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients', patientId, 'policies'] }),
  });
}

export function useDeletePolicy(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteData(`/patients/${patientId}/insurance-policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients', patientId, 'policies'] }),
  });
}

export type InsuranceCompany = Entity & {
  name: string;
  code?: string;
  defaultCoveragePercent: number;
  isActive: boolean;
};
export const insuranceCompaniesApi = resourceHooks<InsuranceCompany>('/insurance-companies');

export type FileItem = {
  id: string;
  ownerType: string;
  category: string;
  mime: string;
  size: number;
  originalName: string;
  notes?: string;
  toothNumbers?: number[];
  takenAt?: string;
  createdAt: string;
  url: string;
};

export function useDocuments(patientId: string, category?: string) {
  return useQuery({
    queryKey: ['/patients', patientId, 'documents', category ?? ''],
    queryFn: () =>
      getData<FileItem[]>(`/patients/${patientId}/documents`, {
        params: category ? { category } : {},
      }),
  });
}

export function useUploadDocument(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      category,
      notes,
      onProgress,
    }: {
      file: File;
      category: string;
      notes?: string;
      onProgress?: (p: number) => void;
    }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', category);
      if (notes) fd.append('notes', notes);
      const res = await api.post<{ data: FileItem }>(`/patients/${patientId}/documents`, fd, {
        onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
      return res.data.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients', patientId, 'documents'] }),
  });
}

export function useDeleteDocument(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: string) => deleteData(`/patients/${patientId}/documents/${fileId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients', patientId, 'documents'] }),
  });
}

/** `ref` is a workspace tab path (`chart`) or an absolute app path (`/clinic/...`). */
export type TimelineEvent = { at: string; kind: string; title: string; ref?: string };
export function useTimeline(patientId: string) {
  return useQuery({
    queryKey: ['/patients', patientId, 'timeline'],
    queryFn: () => getData<TimelineEvent[]>(`/patients/${patientId}/timeline`),
  });
}

export type FamilyMember = {
  id: string;
  fileNumber: string;
  fullName: string;
  gender?: 'male' | 'female';
  dateOfBirth?: string;
  status: Patient['status'];
  relation: 'guardian' | 'dependant' | 'member';
};

export function useFamily(patientId: string, enabled = true) {
  return useQuery({
    queryKey: ['/patients', patientId, 'family'],
    queryFn: () => getData<FamilyMember[]>(`/patients/${patientId}/family`),
    enabled,
  });
}

/** Linking or unlinking changes every member's family list, so all patient queries refresh. */
export function useLinkFamily(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (otherId: string) =>
      postData<FamilyMember[]>(`/patients/${patientId}/family`, { patientId: otherId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients'] }),
  });
}

export function useUnlinkFamily() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => deleteData(`/patients/${memberId}/family`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients'] }),
  });
}

/* ---------- photo, ID verification, referrals (03 §4) ---------- */

function usePatientUpdate<T>(fn: (v: T) => Promise<Patient>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (p) => {
      qc.setQueryData(patientsApi.keys.detail(p.id), p);
      void qc.invalidateQueries({ queryKey: ['/patients'] });
    },
  });
}

export function usePatientPhoto(patientId: string) {
  return {
    upload: usePatientUpdate(async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.put<{ data: Patient }>(`/patients/${patientId}/photo`, fd);
      return res.data.data;
    }),
    remove: usePatientUpdate(async () => (await api.delete<{ data: Patient }>(`/patients/${patientId}/photo`)).data.data),
  };
}

export function useVerifyId(patientId: string) {
  return usePatientUpdate(() => postData<Patient>(`/patients/${patientId}/verify-id`, {}));
}

export type ReferredPatient = { id: string; fileNumber: string; fullName: string; createdAt: string; status: string };
export function useReferrals(patientId: string, enabled = true) {
  return useQuery({
    queryKey: ['/patients', patientId, 'referrals'],
    queryFn: () => getData<ReferredPatient[]>(`/patients/${patientId}/referrals`),
    enabled,
  });
}

export type ReferralReport = {
  from: string;
  to: string;
  newPatients: number;
  byType: { type: string; count: number }[];
  topReferrers: { patientId: string; fullName: string; fileNumber: string; count: number }[];
  sources: { source: string; count: number }[];
};
export function useReferralReport(from: string, to: string) {
  return useQuery({
    queryKey: ['reports', 'referrals', from, to],
    queryFn: () => getData<ReferralReport>('/reports/referrals', { params: { from, to } }),
  });
}

/* ---------- communication log ---------- */

export type Communication = Entity & {
  patientId: string;
  at: string;
  channel: 'call' | 'whatsapp' | 'sms' | 'email' | 'in_person' | 'other';
  direction: 'in' | 'out';
  summary: string;
  outcome: 'reached' | 'no_answer' | 'left_message' | 'resolved' | 'other';
  followUpAt?: string;
  followUpDoneAt?: string;
  followUpDoneByName?: string;
  staffId: string;
  staffName?: string;
  createdAt: string;
  editable: boolean;
};
export type CommunicationPage = { data: Communication[]; meta: { total: number; page: number; pages: number; dueCount: number } };

export function useCommunications(patientId: string, enabled: boolean, limit = 50) {
  return useQuery({
    queryKey: ['/patients', patientId, 'communications', limit],
    enabled,
    queryFn: async () => (await api.get<CommunicationPage>(`/patients/${patientId}/communications`, { params: { limit } })).data,
  });
}

export function useSaveCommunication(patientId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: Record<string, unknown> & { id?: string }) =>
      id ? patchData<Communication>(`/patient-communications/${id}`, b) : postData<Communication>(`/patients/${patientId}/communications`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['/patients', patientId] }),
  });
}

/* ---------- bulk import ---------- */

export type ImportFieldError = { path: string; code: string; params?: Record<string, unknown> };
export type ImportCheckRow =
  | { index: number; status: 'ok' }
  | { index: number; status: 'error'; errors: ImportFieldError[] }
  | { index: number; status: 'duplicate'; fields: string[]; duplicateOfRow?: number; duplicateOf?: { id: string; fileNumber: string; fullName: string } };
export type ImportCommitRow =
  | { index: number; status: 'created'; id: string; fileNumber: string }
  | { index: number; status: 'skipped' | 'error'; reason?: string };
export type ImportResult<R> = { dryRun: boolean; summary: { total: number; ok: number; duplicate: number; error: number; created?: number }; rows: R[] };

export function usePatientImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { rows: Record<string, unknown>[]; dryRun: boolean; allowDuplicates?: boolean }) =>
      postData<ImportResult<ImportCheckRow | ImportCommitRow>>('/patients/import', b),
    onSuccess: (_d, v) => {
      if (!v.dryRun) void qc.invalidateQueries({ queryKey: ['/patients'] });
    },
  });
}
