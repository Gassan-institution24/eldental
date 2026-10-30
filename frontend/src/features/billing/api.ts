import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, deleteData, getData, getPaged, patchData, postData } from '@/lib/api/axios';
import type { Entity } from '@/shared/api/resource';

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
export type InvoiceLine = {
  id: string;
  performedProcedureId?: string;
  clinicProcedureId?: string;
  description: string;
  category?: string;
  toothNumbers: number[];
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRateId?: string;
  taxAmount: number;
  lineTotal: number;
  insuranceShare: number;
  patientShare: number;
  dentistId?: string;
};
export type Invoice = Entity & {
  number?: string;
  type: 'invoice' | 'credit_note';
  status: InvoiceStatus;
  patientId: string;
  patient?: { fullName: string; fileNumber: string };
  insurancePolicyId?: string;
  insuranceCompanyId?: string;
  appointmentId?: string;
  dentistId?: string;
  lines: InvoiceLine[];
  invoiceDiscount: number;
  discountReason: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  insuranceTotal: number;
  patientTotal: number;
  amountPaid: number;
  insurancePaid: number;
  creditedTotal: number;
  writtenOff: number;
  balanceDue: number;
  patientDue: number;
  insuranceDue: number;
  issueDate?: string;
  dueDate?: string;
  installmentPlan: { dueDate: string; amount: number; paidAmount: number }[];
  originalInvoiceId?: string;
  claimId?: string;
  notes: string;
  voidReason?: string;
  einvoice?: {
    status: string;
    qr?: string;
    response?: string;
    attempts?: number;
    submittedAt?: string;
  };
  createdAt: string;
  payments?: {
    id: string;
    number: string;
    receiptNumber?: string;
    method: string;
    date: string;
    amount: number;
    status: string;
  }[];
  creditNotes?: { id: string; number: string; total: number; issueDate: string; reason: string }[];
};

export const PAYMENT_METHODS = [
  'cash',
  'card',
  'bank_transfer',
  'cheque',
  'wallet',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type Payment = {
  id: string;
  number: string;
  receiptNumber?: string;
  payerType: 'patient' | 'insurance';
  patientId?: string;
  patient?: { fullName: string; fileNumber: string };
  insuranceCompanyId?: string;
  claimId?: string;
  method: PaymentMethod;
  amount: number;
  date: string;
  receivedAt: string;
  reference: string;
  cheque?: {
    number: string;
    bank?: string;
    dueDate?: string;
    status: 'under_collection' | 'cleared' | 'bounced';
  };
  allocations: { invoiceId: string; invoiceNumber?: string; amount: number; at?: string }[];
  unallocated: number;
  refunded: number;
  status: 'posted' | 'partially_refunded' | 'refunded' | 'void';
  refunds: { amount: number; at: string; reason: string }[];
  notes: string;
  createdAt: string;
};

export type BillingSummary = {
  receivable: number;
  credit: number;
  balance: number;
  openInvoices: {
    id: string;
    number: string;
    issueDate: string;
    dueDate?: string;
    total: number;
    balanceDue: number;
    patientDue: number;
    insuranceDue: number;
  }[];
  credits: { paymentId: string; number: string; amount: number; date: string }[];
};

export type CashSession = {
  id: string;
  openedAt: string;
  openedBy: string;
  openingFloat: number;
  received: number;
  refunds: number;
  expected: number;
  payments: number;
  byMethod: { method: string; total: number; count: number }[];
};
export type CashHistory = {
  id: string;
  openedAt: string;
  closedAt: string;
  openingFloat: number;
  expected: number;
  counted: number;
  difference: number;
};

export type Claim = {
  id: string;
  number: string;
  insuranceCompanyId: string;
  insuranceCompanyName?: string;
  patientId: string;
  patient?: { fullName: string; fileNumber: string };
  invoiceIds: string[];
  claimedAmount: number;
  approvedAmount: number;
  paidAmount: number;
  shortfallMode?: 'write_off' | 'rebill';
  status: 'draft' | 'submitted' | 'approved' | 'partially_approved' | 'rejected' | 'paid';
  submittedAt?: string;
  responseAt?: string;
  rejectionReason?: string;
  notes: string;
  createdAt: string;
};

export type ListParams = Record<string, string | number | boolean | undefined>;
const clean = (p: ListParams) =>
  Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== ''));

export const billingKeys = {
  invoices: ['invoices'] as const,
  payments: ['payments'] as const,
  summary: (patientId: string) => ['billing-summary', patientId] as const,
  cash: ['cash-session'] as const,
  claims: ['insurance-claims'] as const,
};

function useInvalidateBilling() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      billingKeys.invoices,
      billingKeys.payments,
      ['billing-summary'],
      billingKeys.cash,
      billingKeys.claims,
      ['reports'],
      ['/patients'],
      ['einvoices'],
    ])
      void qc.invalidateQueries({ queryKey: k });
  };
}

export const useInvoices = (p: ListParams) =>
  useQuery({
    queryKey: [...billingKeys.invoices, 'list', p],
    queryFn: () => getPaged<Invoice>('/invoices', clean(p)),
  });
export const useInvoice = (id?: string) =>
  useQuery({
    queryKey: [...billingKeys.invoices, 'one', id],
    enabled: Boolean(id),
    queryFn: () => getData<Invoice>(`/invoices/${id}`),
  });
export const useBillingSummary = (patientId?: string) =>
  useQuery({
    queryKey: billingKeys.summary(patientId ?? ''),
    enabled: Boolean(patientId),
    queryFn: () => getData<BillingSummary>(`/patients/${patientId}/billing-summary`),
  });

export function useInvoiceMutations() {
  const done = useInvalidateBilling();
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<Invoice>('/invoices', b),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<Invoice>(`/invoices/${id}`, b),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteData(`/invoices/${id}`),
      onSuccess: done,
    }),
    issue: useMutation({
      mutationFn: ({ id, ...b }: { id: string; issueDate?: string; dueDate?: string }) =>
        postData<Invoice>(`/invoices/${id}/issue`, b),
      onSuccess: done,
    }),
    void: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        postData<Invoice>(`/invoices/${id}/void`, { reason }),
      onSuccess: done,
    }),
    credit: useMutation({
      mutationFn: ({ id, ...b }: { id: string; amount?: number; reason: string }) =>
        postData<Invoice>(`/invoices/${id}/credit-notes`, b),
      onSuccess: done,
    }),
  };
}

export const usePayments = (p: ListParams) =>
  useQuery({
    queryKey: [...billingKeys.payments, 'list', p],
    queryFn: () => getPaged<Payment>('/payments', clean(p)),
  });

export function usePaymentMutations() {
  const done = useInvalidateBilling();
  return {
    create: useMutation({
      mutationFn: ({
        idempotencyKey,
        ...b
      }: { idempotencyKey: string } & Record<string, unknown>) =>
        api
          .post<{ data: Payment }>('/payments', b, {
            headers: { 'Idempotency-Key': idempotencyKey },
          })
          .then((r) => r.data.data),
      onSuccess: done,
    }),
    allocate: useMutation({
      mutationFn: ({ id, ...b }: { id: string; invoiceId: string; amount: number }) =>
        postData<Payment>(`/payments/${id}/allocate`, b),
      onSuccess: done,
    }),
    refund: useMutation({
      mutationFn: ({ id, ...b }: { id: string; amount: number; reason: string }) =>
        postData<Payment>(`/payments/${id}/refund`, b),
      onSuccess: done,
    }),
    cheque: useMutation({
      mutationFn: ({ id, to }: { id: string; to: 'cleared' | 'bounced' }) =>
        postData<Payment>(`/payments/${id}/cheque`, { to }),
      onSuccess: done,
    }),
  };
}

export const useCashSession = () =>
  useQuery({
    queryKey: billingKeys.cash,
    queryFn: () => getData<CashSession | null>('/cash-sessions/current'),
  });
export const useCashHistory = (enabled = true) =>
  useQuery({
    queryKey: [...billingKeys.cash, 'history'],
    enabled,
    queryFn: () => getData<CashHistory[]>('/cash-sessions'),
  });
export function useCashMutations() {
  const done = useInvalidateBilling();
  return {
    open: useMutation({
      mutationFn: (openingFloat: number) =>
        postData<CashSession>('/cash-sessions/open', { openingFloat }),
      onSuccess: done,
    }),
    close: useMutation({
      mutationFn: (b: { countedAmount: number; notes?: string }) =>
        postData<{ expected: number; counted: number; difference: number }>(
          '/cash-sessions/close',
          b,
        ),
      onSuccess: done,
    }),
  };
}

export const useClaims = (p: ListParams) =>
  useQuery({
    queryKey: [...billingKeys.claims, p],
    queryFn: () => getData<Claim[]>('/insurance-claims', { params: clean(p) }),
  });
export function useClaimMutations() {
  const done = useInvalidateBilling();
  return {
    create: useMutation({
      mutationFn: (b: { invoiceIds: string[]; notes?: string }) =>
        postData<Claim>('/insurance-claims', b),
      onSuccess: done,
    }),
    status: useMutation({
      mutationFn: ({
        id,
        ...b
      }: {
        id: string;
        to: string;
        approvedAmount?: number;
        shortfallMode?: string;
        reason?: string;
      }) => postData<Claim>(`/insurance-claims/${id}/status`, b),
      onSuccess: done,
    }),
  };
}

export type InvoicePrint = {
  invoice: Invoice;
  clinic: {
    name: string;
    phone?: string;
    email?: string;
    addressLine1?: string;
    taxNumber?: string;
    commercialRegNo?: string;
    settings?: { invoiceFooter?: string };
  } | null;
  patient: { fullName: string; fileNumber: string; phone?: string } | null;
};
export const fetchInvoicePrint = (id: string) => getData<InvoicePrint>(`/invoices/${id}/print`);
export type ReceiptPrint = {
  payment: Payment;
  clinic: { name: string; phone?: string; addressLine1?: string; taxNumber?: string } | null;
  balanceAfter: number | null;
};
export const fetchReceipt = (id: string) => getData<ReceiptPrint>(`/payments/${id}/receipt`);

export const useEInvoices = (status?: string) =>
  useQuery({
    queryKey: ['einvoices', status],
    queryFn: () => getData<Invoice[]>('/einvoices', { params: status ? { status } : {} }),
  });
export function useResubmitEInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postData(`/einvoices/${id}/resubmit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['einvoices'] }),
  });
}
