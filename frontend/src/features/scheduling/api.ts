import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteData, getData, patchData, postData, putData } from '@/lib/api/axios';
import type { Entity } from '@/shared/api/resource';

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_chair',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Mirrors backend `appointment.state.ts` (06 §4) so buttons only offer valid moves. */
export const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ['confirmed', 'arrived', 'cancelled', 'no_show'],
  confirmed: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_chair', 'cancelled'],
  in_chair: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const CANCEL_REASONS = [
  'patient_request',
  'patient_sick',
  'clinic_closed',
  'dentist_unavailable',
  'rescheduled',
  'other',
] as const;

export type Appointment = Entity & {
  number: string;
  patientId?: string;
  patient?: {
    id: string;
    fullName: string;
    fileNumber: string;
    phone?: string;
    medicalAlerts: string[];
    noShowCount: number;
  };
  dentistId: string;
  chairId?: string;
  assistantIds: string[];
  appointmentTypeId?: string;
  start: string;
  end: string;
  status: AppointmentStatus;
  displayStatus: string;
  statusHistory: { from?: string; to: string; at: string; byUserId?: string; reason?: string }[];
  source: 'staff' | 'online' | 'walk_in' | 'recall';
  priority: 'normal' | 'emergency';
  overbooked: boolean;
  notes: string;
  patientNotes: string;
  cancellation?: { reason: string; comment?: string; at: string; lateCancel: boolean };
  checkInAt?: string;
  seatedAt?: string;
  completedAt?: string;
  noProceduresReason?: string;
  invoiceId?: string;
  createdAt: string;
};

export type Slot = { start: string; end: string; dentistId: string; chairId?: string };
export type Availability = {
  durationMin: number;
  timezone: string;
  days: { date: string; slots: Slot[] }[];
};

export type ScheduleBlock = {
  start: string;
  end: string;
  chairId?: string;
  appointmentTypeIds?: string[];
  onlineBookable: boolean;
};
export type ScheduleVersion = Entity & {
  staffId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  slotGranularityMin: number;
  weekly: { weekday: number; blocks: ScheduleBlock[] }[];
};
export type DentistSchedules = {
  staff: {
    id: string;
    name: string;
    color?: string;
    staffType: string;
    bookableOnline: boolean;
    defaultChairId?: string;
    specialties?: string[];
    primarySpecialty?: string;
  };
  current: ScheduleVersion | null;
  versions: ScheduleVersion[];
};

export type ScheduleException = Entity & {
  staffId?: string;
  chairId?: string;
  type: 'time_off' | 'extra_hours' | 'holiday' | 'chair_maintenance';
  start: string;
  end: string;
  reason: string;
};

type PatientMini = { id: string; fullName: string; fileNumber: string; phone?: string };

export type WaitlistEntry = Entity & {
  patientId: string;
  patient?: PatientMini;
  dentistId?: string;
  appointmentTypeId?: string;
  preferredDays: number[];
  preferredTimeRange?: { from: string; to: string };
  notes: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'waiting' | 'offered' | 'booked' | 'removed';
  offeredAt?: string;
  createdAt: string;
};

export type Recall = Entity & {
  patientId: string;
  patient?: PatientMini;
  type: 'cleaning' | 'checkup' | 'ortho_adjustment' | 'custom';
  dueDate: string;
  overdue: boolean;
  intervalMonths: number;
  dentistId?: string;
  status: 'upcoming' | 'due' | 'contacted' | 'booked' | 'dismissed';
  lastContactAt?: string;
  contactCount: number;
  notes: string;
  appointmentId?: string;
};

export type TodayBoard = {
  date: string;
  upcoming: Appointment[];
  arrived: (Appointment & { waitingMin: number })[];
  inChair: Appointment[];
  completed: Appointment[];
  missed: Appointment[];
  counts: Record<string, number>;
};

export const schedulingKeys = {
  appointments: ['appointments'] as const,
  range: (p: Record<string, unknown>) => ['appointments', 'range', p] as const,
  board: (date?: string) => ['appointments', 'board', date ?? 'today'] as const,
  one: (id: string) => ['appointments', 'one', id] as const,
  patient: (id: string) => ['appointments', 'patient', id] as const,
  availability: (p: Record<string, unknown>) => ['availability', p] as const,
  schedules: ['dentist-schedules'] as const,
  exceptions: (p: Record<string, unknown>) => ['schedule-exceptions', p] as const,
  waitlist: (p: Record<string, unknown>) => ['waiting-list', p] as const,
  recalls: (p: Record<string, unknown>) => ['recalls', p] as const,
};

const clean = (p: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));

export function useAppointments(p: {
  from: string;
  to: string;
  dentistId?: string;
  chairId?: string;
  includeCancelled?: boolean;
}) {
  return useQuery({
    queryKey: schedulingKeys.range(p),
    queryFn: () => getData<Appointment[]>('/appointments', { params: clean(p) }),
  });
}

export function useAppointment(id: string | undefined) {
  return useQuery({
    queryKey: schedulingKeys.one(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => getData<Appointment>(`/appointments/${id}`),
  });
}

export function usePatientAppointments(patientId: string | undefined) {
  return useQuery({
    queryKey: schedulingKeys.patient(patientId ?? ''),
    enabled: Boolean(patientId),
    queryFn: () => getData<Appointment[]>(`/patients/${patientId}/appointments`),
  });
}

export function useTodayBoard(date?: string) {
  return useQuery({
    queryKey: schedulingKeys.board(date),
    queryFn: () => getData<TodayBoard>('/appointments/today-board', { params: clean({ date }) }),
    refetchInterval: 60_000,
  });
}

export function useAvailability(
  p: {
    from: string;
    to: string;
    dentistId?: string;
    chairId?: string;
    appointmentTypeId?: string;
    durationMin?: number;
  },
  enabled = true,
) {
  return useQuery({
    queryKey: schedulingKeys.availability(p),
    enabled,
    queryFn: () => getData<Availability>('/availability', { params: clean(p) }),
  });
}

function useInvalidateAppointments() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: schedulingKeys.appointments });
    void qc.invalidateQueries({ queryKey: ['availability'] });
    void qc.invalidateQueries({ queryKey: ['recalls'] });
    void qc.invalidateQueries({ queryKey: ['waiting-list'] });
  };
}

export type BookPayload = {
  patientId: string;
  dentistId: string;
  chairId?: string;
  appointmentTypeId?: string;
  start: string;
  durationMin?: number;
  notes?: string;
  patientNotes?: string;
  source?: 'staff' | 'walk_in' | 'recall';
  priority?: 'normal' | 'emergency';
  override?: boolean;
  allowOverlap?: boolean;
  recallId?: string;
  waitlistId?: string;
  plannedItems?: { treatmentPlanItemId: string }[];
};

export function useBook() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (b: BookPayload) => postData<Appointment>('/appointments', b),
    onSuccess: invalidate,
  });
}

export function useUpdateAppointment() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
      patchData<Appointment>(`/appointments/${id}`, b),
    onSettled: invalidate,
  });
}

export function useTransition() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({
      id,
      ...b
    }: {
      id: string;
      to: AppointmentStatus;
      reason?: string;
      comment?: string;
      noProcedures?: boolean;
      version?: number;
    }) => postData<Appointment>(`/appointments/${id}/status`, b),
    onSuccess: invalidate,
  });
}

export function useCancelAppointment() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, ...b }: { id: string; reason: string; comment?: string }) =>
      postData<Appointment>(`/appointments/${id}/cancel`, b),
    onSuccess: invalidate,
  });
}

export function useBulkShift() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (b: { ids: string[]; minutes: number }) =>
      postData<{ id: string; ok: boolean; code?: string }[]>('/appointments/bulk-shift', b),
    onSuccess: invalidate,
  });
}

/* ---------- schedules ---------- */

export function useSchedules() {
  return useQuery({
    queryKey: schedulingKeys.schedules,
    queryFn: () => getData<DentistSchedules[]>('/dentist-schedules'),
  });
}

export function useSaveSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, ...b }: { staffId: string } & Record<string, unknown>) =>
      putData<ScheduleVersion>(`/dentist-schedules/${staffId}`, b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.schedules });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useDeleteScheduleVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ staffId, id }: { staffId: string; id: string }) =>
      deleteData(`/dentist-schedules/${staffId}/versions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: schedulingKeys.schedules }),
  });
}

export function useExceptions(p: { from: string; to: string; staffId?: string }) {
  return useQuery({
    queryKey: schedulingKeys.exceptions(p),
    queryFn: () => getData<ScheduleException[]>('/schedule-exceptions', { params: clean(p) }),
  });
}

export function useSaveException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: { id?: string } & Record<string, unknown>) =>
      id
        ? patchData<ScheduleException>(`/schedule-exceptions/${id}`, b)
        : postData<ScheduleException>('/schedule-exceptions', b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedule-exceptions'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useDeleteException() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteData(`/schedule-exceptions/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['schedule-exceptions'] });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

/* ---------- waiting list & recalls ---------- */

export function useWaitlist(p: { status?: string; dentistId?: string }) {
  return useQuery({
    queryKey: schedulingKeys.waitlist(p),
    queryFn: () => getData<WaitlistEntry[]>('/waiting-list', { params: clean(p) }),
  });
}

export function useSaveWaitlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: { id?: string } & Record<string, unknown>) =>
      id
        ? patchData<WaitlistEntry>(`/waiting-list/${id}`, b)
        : postData<WaitlistEntry>('/waiting-list', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waiting-list'] }),
  });
}

export function useRecalls(p: { bucket: string; dentistId?: string; q?: string }) {
  return useQuery({
    queryKey: schedulingKeys.recalls(p),
    queryFn: () => getData<Recall[]>('/recalls', { params: clean(p) }),
  });
}

export function useSaveRecall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...b }: { id?: string } & Record<string, unknown>) =>
      id ? patchData<Recall>(`/recalls/${id}`, b) : postData<Recall>('/recalls', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recalls'] }),
  });
}
