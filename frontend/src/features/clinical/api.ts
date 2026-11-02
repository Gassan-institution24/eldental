import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getData, patchData, postData, putData } from '@/lib/api/axios';
import { resourceHooks, type Entity } from '@/shared/api/resource';

export type ToothCondition = {
  code: string;
  surfaces?: string[];
  kind: EntryKind;
  entryId: string;
  notedAt: string;
  planId?: string;
  planItemId?: string;
};
export type ToothState = {
  status: 'present' | 'missing' | 'implant' | 'unerupted';
  conditions: ToothCondition[];
};
export type EntryKind = 'existing' | 'finding' | 'planned' | 'completed';
export type ChartEntry = {
  id: string;
  toothNumber: number;
  surfaces: string[];
  kind: EntryKind;
  conditionCode?: string;
  setStatus?: string;
  clinicProcedureId?: string;
  treatmentPlanId?: string;
  staffId?: string;
  notes: string;
  voided: boolean;
  voidsEntryId?: string;
  at: string;
};
export type Chart = {
  dentition: 'permanent' | 'primary' | 'mixed';
  teeth: Record<string, ToothState>;
  entries: ChartEntry[];
};
export type ConditionDef = {
  id: string;
  code: string;
  color: string;
  appliesTo: 'tooth' | 'surface';
};

export type PlanStatus =
  | 'draft'
  | 'presented'
  | 'accepted'
  | 'partially_accepted'
  | 'rejected'
  | 'in_progress'
  | 'completed'
  | 'cancelled';
export type PlanItem = {
  id: string;
  phaseIndex: number;
  clinicProcedureId: string;
  code: string;
  category: string;
  toothNumbers: number[];
  surfaces: string[];
  quantity: number;
  unitPrice: number;
  discount: number;
  insuranceEstimate: number;
  patientEstimate: number;
  status: 'proposed' | 'accepted' | 'rejected' | 'scheduled' | 'completed';
  completedProcedureId?: string;
  appointmentId?: string;
  notes: string;
};
export type TreatmentPlan = Entity & {
  patientId: string;
  number: string;
  title: string;
  dentistId: string;
  status: PlanStatus;
  phases: { name: string; order: number }[];
  items: PlanItem[];
  insurancePolicyId?: string;
  totals: { gross: number; discount: number; insurance: number; patient: number };
  alternativeGroupId?: string;
  alternativeLabel: string;
  presentedAt?: string;
  validUntil?: string;
  acceptance?: { at: string; byPatient: boolean; signatureFileId?: string; signerName?: string };
  notes: string;
  createdAt: string;
};

export type PerformedProcedure = {
  id: string;
  patientId: string;
  appointmentId?: string;
  treatmentPlanId?: string;
  treatmentPlanItemId?: string;
  clinicProcedureId: string;
  code: string;
  category: string;
  toothNumbers: number[];
  surfaces: string[];
  dentistId: string;
  performedAt: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  status: 'completed' | 'voided';
  voidReason?: string;
  invoiceIssued: boolean;
  notes: string;
};

export type Soap = { subjective?: string; objective?: string; assessment?: string; plan?: string };
export type ClinicalNote = Entity & {
  patientId: string;
  appointmentId?: string;
  authorId: string;
  format: 'soap' | 'free';
  content: Soap;
  text: string;
  toothNumbers: number[];
  signedAt?: string;
  amendsNoteId?: string;
  amendedById?: string;
  createdAt: string;
  updatedAt: string;
};
export type NoteTemplate = Entity & {
  name: string;
  format: 'soap' | 'free';
  content?: Soap;
  text: string;
  isActive: boolean;
};

export type PerioTooth = {
  pocketDepth: number[];
  recession: number[];
  bleeding: boolean[];
  suppuration: boolean[];
  mobility: number;
  furcation: number;
  missing?: boolean;
};
export type PerioExam = Entity & {
  patientId: string;
  examDate: string;
  examinerId: string;
  teeth: Record<string, PerioTooth>;
  notes: string;
  summary: {
    sites: number;
    bopPercent: number;
    sites4mm: number;
    sites6mm: number;
    meanPd: number;
    meanCal: number;
  };
  createdAt: string;
};

export type RxItem = {
  medicineId?: string;
  name: string;
  dose?: string;
  route?: string;
  frequency?: string;
  durationDays?: number;
  instructions?: string;
};
export type Prescription = Entity & {
  patientId: string;
  dentistId: string;
  number: string;
  items: RxItem[];
  notes: string;
  printedAt?: string;
  createdAt: string;
};
export type Medicine = {
  id: string;
  name: string;
  form: string;
  dose: string;
  frequency: string;
  days: number;
  group: string;
};

export const LAB_STATUSES = [
  'draft',
  'sent',
  'in_progress',
  'received',
  'fitted',
  'remake',
  'cancelled',
] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
export const LAB_FLOW: Record<LabStatus, LabStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['in_progress', 'received', 'cancelled'],
  in_progress: ['received', 'cancelled'],
  received: ['fitted', 'remake'],
  remake: ['sent', 'cancelled'],
  fitted: ['remake'],
  cancelled: [],
};
export const LAB_ITEM_TYPES = [
  'crown',
  'bridge',
  'denture',
  'veneer',
  'aligner',
  'night_guard',
  'implant_crown',
  'other',
] as const;
export type LabOrder = Entity & {
  number: string;
  patientId: string;
  patient?: { id: string; fullName: string; fileNumber: string };
  dentistId: string;
  labName: string;
  items: {
    type: string;
    toothNumbers: number[];
    material?: string;
    shade?: string;
    notes?: string;
  }[];
  status: LabStatus;
  statusHistory: { from?: string; to: string; at: string; reason?: string }[];
  dueDate?: string;
  sentAt?: string;
  receivedAt?: string;
  cost: number;
  notes: string;
  createdAt: string;
};

export type ConsentTemplate = Entity & {
  title: string;
  body: string;
  procedureCategories: string[];
  isActive: boolean;
};
export type Consent = Entity & {
  patientId: string;
  templateId?: string;
  title: string;
  renderedBody: string;
  signedAt: string;
  signerName?: string;
  signatureFileId: string;
};

const k = {
  chart: (p: string) => ['chart', p] as const,
  conditions: ['tooth-conditions'] as const,
  plans: (p: string) => ['treatment-plans', p] as const,
  procedures: (p: string) => ['performed-procedures', p] as const,
  notes: (p: string) => ['notes', p] as const,
  perio: (p: string) => ['perio', p] as const,
  rx: (p: string) => ['prescriptions', p] as const,
  lab: (p: Record<string, unknown>) => ['lab-orders', p] as const,
  consents: (p: string) => ['consents', p] as const,
};

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) =>
    keys.forEach((key) => void qc.invalidateQueries({ queryKey: key }));
}

/* ---------- chart ---------- */

export const useChart = (patientId: string) =>
  useQuery({
    queryKey: k.chart(patientId),
    queryFn: () => getData<Chart>(`/patients/${patientId}/chart`),
  });
export const useConditions = () =>
  useQuery({
    queryKey: k.conditions,
    staleTime: Infinity,
    queryFn: () => getData<ConditionDef[]>('/catalog/tooth-conditions'),
  });

export function useChartMutations(patientId: string) {
  const qc = useQueryClient();
  const set = (data: Chart) => qc.setQueryData(k.chart(patientId), data);
  return {
    addEntry: useMutation({
      mutationFn: (b: Record<string, unknown>) =>
        postData<Chart>(`/patients/${patientId}/chart/entries`, b),
      onSuccess: set,
    }),
    voidEntry: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        postData<Chart>(`/patients/${patientId}/chart/entries/${id}/void`, { reason }),
      onSuccess: set,
    }),
    dentition: useMutation({
      mutationFn: (dentition: string) =>
        putData<Chart>(`/patients/${patientId}/chart/dentition`, { dentition }),
      onSuccess: set,
    }),
  };
}

/* ---------- plans & procedures ---------- */

export const usePlans = (patientId: string, enabled = true) =>
  useQuery({
    queryKey: k.plans(patientId),
    queryFn: () => getData<TreatmentPlan[]>(`/patients/${patientId}/treatment-plans`),
    enabled,
  });
export const useProcedures = (patientId: string) =>
  useQuery({
    queryKey: k.procedures(patientId),
    queryFn: () =>
      getData<PerformedProcedure[]>('/performed-procedures', { params: { patientId } }),
  });

export function usePlanMutations(patientId: string) {
  const inv = useInvalidate();
  const done = () => inv(k.plans(patientId), k.chart(patientId));
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) =>
        postData<TreatmentPlan>('/treatment-plans', { patientId, ...b }),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<TreatmentPlan>(`/treatment-plans/${id}`, b),
      onSuccess: done,
    }),
    present: useMutation({
      mutationFn: ({ id, validUntil }: { id: string; validUntil?: string }) =>
        postData<TreatmentPlan>(`/treatment-plans/${id}/present`, validUntil ? { validUntil } : {}),
      onSuccess: done,
    }),
    accept: useMutation({
      mutationFn: ({
        id,
        ...b
      }: {
        id: string;
        itemIds?: string[];
        signature: string;
        signerName?: string;
      }) => postData<TreatmentPlan>(`/treatment-plans/${id}/accept`, b),
      onSuccess: done,
    }),
    status: useMutation({
      mutationFn: ({
        id,
        ...b
      }: {
        id: string;
        to: 'rejected' | 'cancelled' | 'draft';
        reason?: string;
      }) => postData<TreatmentPlan>(`/treatment-plans/${id}/status`, b),
      onSuccess: done,
    }),
  };
}

export function useProcedureMutations(patientId: string) {
  const inv = useInvalidate();
  const done = () =>
    inv(
      k.procedures(patientId),
      k.chart(patientId),
      k.plans(patientId),
      ['appointments'],
      ['recalls'],
    );
  return {
    perform: useMutation({
      mutationFn: (b: Record<string, unknown>) =>
        postData<PerformedProcedure>('/performed-procedures', { patientId, ...b }),
      onSuccess: done,
    }),
    void: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        postData<PerformedProcedure>(`/performed-procedures/${id}/void`, { reason }),
      onSuccess: done,
    }),
  };
}

/* ---------- notes ---------- */

export const useNotes = (patientId: string) =>
  useQuery({
    queryKey: k.notes(patientId),
    queryFn: () => getData<ClinicalNote[]>(`/patients/${patientId}/notes`),
  });
export const noteTemplatesApi = resourceHooks<NoteTemplate>('/note-templates');
export const useUnsignedNotes = (enabled: boolean) =>
  useQuery({
    queryKey: ['notes', 'unsigned'],
    enabled,
    queryFn: () => getData<ClinicalNote[]>('/notes/unsigned', { silent: true }),
  });

export function useNoteMutations(patientId: string) {
  const inv = useInvalidate();
  const done = () => inv(k.notes(patientId), ['notes', 'unsigned']);
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) =>
        postData<ClinicalNote>('/notes', { patientId, ...b }),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<ClinicalNote>(`/notes/${id}`, b),
      onSuccess: done,
    }),
    sign: useMutation({
      mutationFn: (id: string) => postData<ClinicalNote>(`/notes/${id}/sign`),
      onSuccess: done,
    }),
    amend: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        postData<ClinicalNote>(`/notes/${id}/amend`, b),
      onSuccess: done,
    }),
  };
}

/* ---------- perio ---------- */

export const usePerio = (patientId: string) =>
  useQuery({
    queryKey: k.perio(patientId),
    queryFn: () => getData<PerioExam[]>(`/patients/${patientId}/perio`),
  });
export function usePerioMutations(patientId: string) {
  const inv = useInvalidate();
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) =>
        postData<PerioExam>('/perio', { patientId, ...b }),
      onSuccess: () => inv(k.perio(patientId)),
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<PerioExam>(`/perio/${id}`, b),
      onSuccess: () => inv(k.perio(patientId)),
    }),
  };
}

/* ---------- prescriptions ---------- */

export const usePrescriptions = (patientId: string) =>
  useQuery({
    queryKey: k.rx(patientId),
    queryFn: () => getData<Prescription[]>(`/patients/${patientId}/prescriptions`),
  });
export const useMedicines = (q: string) =>
  useQuery({
    queryKey: ['medicines', q],
    staleTime: 300_000,
    queryFn: () => getData<Medicine[]>('/catalog/medicines', { params: q ? { q } : {} }),
  });
export function useCreatePrescription(patientId: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) =>
      postData<Prescription>('/prescriptions', { patientId, ...b }),
    onSuccess: () => inv(k.rx(patientId)),
  });
}
export type RxPrint = {
  prescription: Prescription;
  patient: {
    fullName: string;
    fileNumber: string;
    dateOfBirth?: string;
    gender?: string;
    medicalAlerts: string[];
  };
  dentist: {
    name: string;
    licenseNumber?: string;
    primarySpecialty?: string;
    specialties?: string[];
    signatureFileId?: string;
    stampFileId?: string;
  } | null;
  clinic: { name: string; phone?: string; email?: string; addressLine1?: string } | null;
};
export const fetchRxPrint = (id: string) => getData<RxPrint>(`/prescriptions/${id}/print`);

/* ---------- lab ---------- */

export const useLabOrders = (p: { patientId?: string; status?: string; open?: boolean }) =>
  useQuery({
    queryKey: k.lab(p),
    queryFn: () =>
      getData<LabOrder[]>('/lab-orders', {
        params: {
          ...(p.patientId ? { patientId: p.patientId } : {}),
          ...(p.status ? { status: p.status } : {}),
          ...(p.open ? { open: 'true' } : {}),
        },
      }),
  });
export function useLabMutations() {
  const inv = useInvalidate();
  const done = () => inv(['lab-orders']);
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<LabOrder>('/lab-orders', b),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<LabOrder>(`/lab-orders/${id}`, b),
      onSuccess: done,
    }),
    status: useMutation({
      mutationFn: ({ id, ...b }: { id: string; to: LabStatus; reason?: string; cost?: number }) =>
        postData<LabOrder>(`/lab-orders/${id}/status`, b),
      onSuccess: done,
    }),
  };
}

/* ---------- consents ---------- */

export const consentTemplatesApi = resourceHooks<ConsentTemplate>('/consent-templates');
export const useConsents = (patientId: string) =>
  useQuery({
    queryKey: k.consents(patientId),
    queryFn: () => getData<Consent[]>(`/patients/${patientId}/consents`),
  });
export function useSignConsent(patientId: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) => postData<Consent>('/consents', { patientId, ...b }),
    onSuccess: () => inv(k.consents(patientId), ['documents']),
  });
}
