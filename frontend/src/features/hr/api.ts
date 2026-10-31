import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteData, getData, postData } from '@/lib/api/axios';
import { resourceHooks, type Entity } from '@/shared/api/resource';

export type Shift = Entity & {
  name: string;
  weekly: { weekday: number; start: string; end: string; breakMinutes: number }[];
  graceMinutes: number;
  isDefault: boolean;
  isActive: boolean;
};
export const shiftsApi = resourceHooks<Shift>('/shifts');

export type AttendanceRow = {
  id: string;
  version: number;
  staffId: string;
  date: string;
  checkIn?: { at: string; method: string };
  checkOut?: { at: string; method: string };
  scheduledStart?: string;
  scheduledEnd?: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  overtimeApproved: boolean;
  workedMinutes: number;
  status: 'present' | 'absent' | 'on_leave' | 'holiday' | 'weekend';
  adjustmentReason?: string;
  locked: boolean;
};
export type MyToday = {
  date: string;
  attendance: AttendanceRow | null;
  expected: { start: string; end: string } | null;
};

export type LeaveType = Entity & {
  code: string;
  name: string | null;
  systemKey?: string;
  paid: boolean;
  annualEntitlementDays: number;
  accrual: 'yearly' | 'monthly';
  carryOverMaxDays: number;
  requiresAttachment: boolean;
  isActive: boolean;
};
export const leaveTypesApi = resourceHooks<LeaveType>('/leave-types');
export type LeaveBalance = {
  leaveTypeId: string;
  code: string;
  name: string | null;
  systemKey?: string;
  paid: boolean;
  year: number;
  entitled: number;
  carriedOver: number;
  taken: number;
  pending: number;
  remaining: number | null;
};
export type LeaveRequest = {
  id: string;
  version: number;
  staffId: string;
  staffName?: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay: boolean;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decision?: { at: string; comment?: string };
  createdAt: string;
};

export type SalaryComponent = Entity & {
  name: string;
  kind: 'earning' | 'deduction';
  calc: 'fixed' | 'percent_of_basic' | 'per_hour';
  taxable: boolean;
  subjectToSocialSecurity: boolean;
  isActive: boolean;
};
export const salaryComponentsApi = resourceHooks<SalaryComponent>('/salary-components');

export type Payslip = {
  id: string;
  staffId: string;
  staffName?: string;
  payrollRunId: string;
  year: number;
  month: number;
  workedDays: number;
  daysInMonth: number;
  basic?: number;
  earnings?: { name: string; amount: number }[];
  deductions?: { name: string; amount: number }[];
  overtime?: { minutes: number; amount: number };
  absenceDeduction?: number;
  absentDays: number;
  unpaidLeaveDeduction?: number;
  unpaidLeaveDays: number;
  commission?: { basis?: string; base: number; percent: number; amount: number };
  socialSecurity?: { base: number; employee: number; employer: number };
  incomeTax?: number;
  advances: number;
  gross?: number;
  totalDeductions?: number;
  net?: number;
  status: 'draft' | 'final';
  acknowledgedAt?: string;
};
export type PayrollRun = {
  id: string;
  version: number;
  year: number;
  month: number;
  status: 'draft' | 'calculated' | 'approved' | 'paid' | 'cancelled';
  totals: { gross: number; deductions: number; employerContributions: number; net: number };
  oneOffLines: {
    _id: string;
    staffId: string;
    kind: 'earning' | 'deduction';
    name: string;
    amount: number;
    reason: string;
  }[];
  calculatedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  payslips?: Payslip[];
};

const k = { today: ['attendance', 'me'] as const };

export const useMyToday = (enabled = true) =>
  useQuery({
    queryKey: k.today,
    enabled,
    refetchInterval: 60_000,
    queryFn: () => getData<MyToday | null>('/attendance/me', { silent: true }),
  });
export const useAttendance = (p: { from: string; to: string; staffId?: string }) =>
  useQuery({
    queryKey: ['attendance', p],
    queryFn: () =>
      getData<AttendanceRow[]>('/attendance', {
        params: Object.fromEntries(Object.entries(p).filter(([, v]) => v)),
      }),
  });
export function useAttendanceMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['attendance'] });
  return {
    checkIn: useMutation({
      mutationFn: () => postData<AttendanceRow>('/attendance/check-in', {}),
      onSuccess: done,
    }),
    checkOut: useMutation({
      mutationFn: () => postData<AttendanceRow>('/attendance/check-out', {}),
      onSuccess: done,
    }),
    adjust: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<AttendanceRow>('/attendance/adjust', b),
      onSuccess: done,
    }),
  };
}
export const useAttendanceQr = (enabled: boolean) =>
  useQuery({
    queryKey: ['attendance-qr'],
    enabled,
    refetchInterval: 30_000,
    queryFn: () => getData<{ token: string; validForSeconds: number }>('/attendance/qr'),
  });

export const useLeaveBalances = (staffId?: string) =>
  useQuery({
    queryKey: ['leave-balances', staffId],
    queryFn: () =>
      getData<LeaveBalance[]>('/leave-balances', { params: staffId ? { staffId } : {} }),
  });
export const useLeaveRequests = (p: { status?: string; staffId?: string }) =>
  useQuery({
    queryKey: ['leave-requests', p],
    queryFn: () =>
      getData<LeaveRequest[]>('/leave-requests', {
        params: Object.fromEntries(Object.entries(p).filter(([, v]) => v)),
      }),
  });
export function useLeaveMutations() {
  const qc = useQueryClient();
  const done = () => {
    for (const key of ['leave-requests', 'leave-balances', 'availability', 'schedule-exceptions'])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  return {
    request: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<LeaveRequest>('/leave-requests', b),
      onSuccess: done,
    }),
    approve: useMutation({
      mutationFn: ({ id, ...b }: { id: string; comment?: string; confirmConflicts?: boolean }) =>
        postData<LeaveRequest>(`/leave-requests/${id}/approve`, b),
      onSuccess: done,
    }),
    reject: useMutation({
      mutationFn: ({ id, ...b }: { id: string; comment?: string }) =>
        postData<LeaveRequest>(`/leave-requests/${id}/reject`, b),
      onSuccess: done,
    }),
    cancel: useMutation({
      mutationFn: (id: string) => postData<LeaveRequest>(`/leave-requests/${id}/cancel`),
      onSuccess: done,
    }),
  };
}

export const usePayrollRuns = () =>
  useQuery({ queryKey: ['payroll-runs'], queryFn: () => getData<PayrollRun[]>('/payroll-runs') });
export const usePayrollRun = (id?: string) =>
  useQuery({
    queryKey: ['payroll-runs', id],
    enabled: Boolean(id),
    queryFn: () => getData<PayrollRun>(`/payroll-runs/${id}`),
  });
export function usePayrollMutations() {
  const qc = useQueryClient();
  const done = () => {
    for (const key of ['payroll-runs', 'reports', 'journals'])
      void qc.invalidateQueries({ queryKey: [key] });
  };
  return {
    create: useMutation({
      mutationFn: (b: { year: number; month: number }) => postData<PayrollRun>('/payroll-runs', b),
      onSuccess: done,
    }),
    calculate: useMutation({
      mutationFn: (id: string) => postData<PayrollRun>(`/payroll-runs/${id}/calculate`),
      onSuccess: done,
    }),
    addLine: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        postData<PayrollRun>(`/payroll-runs/${id}/lines`, b),
      onSuccess: done,
    }),
    removeLine: useMutation({
      mutationFn: ({ id, lineId }: { id: string; lineId: string }) =>
        deleteData(`/payroll-runs/${id}/lines/${lineId}`),
      onSuccess: done,
    }),
    approve: useMutation({
      mutationFn: (id: string) => postData<PayrollRun>(`/payroll-runs/${id}/approve`),
      onSuccess: done,
    }),
    pay: useMutation({
      mutationFn: ({ id, paidFromAccountId }: { id: string; paidFromAccountId: string }) =>
        postData<PayrollRun>(`/payroll-runs/${id}/pay`, { paidFromAccountId }),
      onSuccess: done,
    }),
    cancel: useMutation({
      mutationFn: (id: string) => postData<PayrollRun>(`/payroll-runs/${id}/cancel`),
      onSuccess: done,
    }),
  };
}
export const useMyPayslips = () =>
  useQuery({ queryKey: ['payslips', 'mine'], queryFn: () => getData<Payslip[]>('/payslips/mine') });
export type PayslipView = {
  payslip: Payslip;
  staff: { name?: string; jobTitle?: string };
  clinic: { name: string; addressLine1?: string; phone?: string } | null;
};
export const usePayslip = (id?: string) =>
  useQuery({
    queryKey: ['payslips', id],
    enabled: Boolean(id),
    queryFn: () => getData<PayslipView>(`/payslips/${id}`),
  });
export function useAcknowledgePayslip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postData<Payslip>(`/payslips/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payslips'] }),
  });
}
