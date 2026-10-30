import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { deleteData, getData, getPaged, patchData, postData } from '@/lib/api/axios';
import { resourceHooks, type Entity } from '@/shared/api/resource';
import { useSeedName } from '@/shared/hooks/useSeedName';

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type Account = Entity & {
  code: string;
  name: string | null;
  systemKey?: string;
  type: (typeof ACCOUNT_TYPES)[number];
  subtype: string;
  parentId?: string;
  isGroup: boolean;
  isSystem: boolean;
  normalBalance: 'debit' | 'credit';
  isActive: boolean;
};

export const useAccounts = (enabled = true) =>
  useQuery({
    queryKey: ['accounts'],
    enabled,
    staleTime: 60_000,
    queryFn: () => getData<Account[]>('/accounts'),
  });

/** Account label in the UI language until the clinic renames it (03 §1.1). */
export function useAccountLookup(enabled = true) {
  const q = useAccounts(enabled);
  const seedName = useSeedName('accounts');
  const list = useMemo(() => q.data ?? [], [q.data]);
  const byId = useMemo(() => new Map(list.map((a) => [a.id, a])), [list]);
  const name = useCallback(
    (a?: Account | string) => {
      const acc = typeof a === 'string' ? byId.get(a) : a;
      return acc ? seedName({ name: acc.name, systemKey: acc.systemKey ?? acc.code }) : '';
    },
    [byId, seedName],
  );
  const label = useCallback(
    (a?: Account | string) => {
      const acc = typeof a === 'string' ? byId.get(a) : a;
      return acc ? `${acc.code} · ${name(acc)}` : '';
    },
    [byId, name],
  );
  const postable = useMemo(() => list.filter((a) => !a.isGroup && a.isActive), [list]);
  const bySystem = useCallback((key: string) => list.find((a) => a.systemKey === key), [list]);
  return { ...q, list, byId, name, label, postable, bySystem };
}

export function useAccountMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['accounts'] });
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<Account>('/accounts', b),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<Account>(`/accounts/${id}`, b),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteData(`/accounts/${id}`),
      onSuccess: done,
    }),
  };
}

export type JournalLine = {
  accountId: string;
  debit: number;
  credit: number;
  description: string;
  patientId?: string;
  supplierId?: string;
  staffId?: string;
  dentistId?: string;
};
export type Journal = {
  id: string;
  number?: string;
  date: string;
  source: string;
  sourceId?: string;
  memo: string;
  total: number;
  status: 'draft' | 'posted' | 'reversed';
  reversalOfId?: string;
  reversedById?: string;
  postedAt?: string;
  lines: JournalLine[];
};

export const useJournals = (p: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: ['journals', p],
    queryFn: () =>
      getPaged<Journal>(
        '/journals',
        Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')),
      ),
  });
export function useJournalMutations() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['journals'] });
    void qc.invalidateQueries({ queryKey: ['reports'] });
  };
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<Journal>('/journals', b),
      onSuccess: done,
    }),
    post: useMutation({
      mutationFn: (id: string) => postData<Journal>(`/journals/${id}/post`),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => deleteData(`/journals/${id}`),
      onSuccess: done,
    }),
    reverse: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        postData<Journal>(`/journals/${id}/reverse`, { reason }),
      onSuccess: done,
    }),
  };
}

export type FiscalYear = {
  id: string;
  year: number;
  startDate: string;
  endDate: string;
  status: 'open' | 'closed';
  periods: {
    id: string;
    year: number;
    month: number;
    startDate: string;
    endDate: string;
    status: 'open' | 'soft_closed' | 'closed';
  }[];
};
export const useFiscalPeriods = () =>
  useQuery({
    queryKey: ['fiscal-periods'],
    queryFn: () => getData<FiscalYear[]>('/fiscal-periods'),
  });
export function usePeriodMutations() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ['fiscal-periods'] });
  return {
    status: useMutation({
      mutationFn: ({ id, ...b }: { id: string; status: string; reason?: string }) =>
        postData(`/fiscal-periods/${id}/status`, b),
      onSuccess: done,
    }),
    closeYear: useMutation({
      mutationFn: (year: number) => postData(`/fiscal-years/${year}/close`),
      onSuccess: done,
    }),
  };
}

export type Supplier = Entity & {
  name: string;
  kind: 'lab' | 'supplies' | 'equipment' | 'services' | 'other';
  taxNumber?: string;
  contact?: { phone?: string; email?: string; person?: string; address?: string };
  balance: number;
  notes?: string;
  isActive: boolean;
};
export const suppliersApi = resourceHooks<Supplier>('/suppliers');

export type Bill = Entity & {
  number: string;
  supplierRef: string;
  supplierId: string;
  supplierName?: string;
  billDate: string;
  dueDate?: string;
  lines: {
    description: string;
    expenseAccountId: string;
    amount: number;
    taxRateId?: string;
    taxAmount: number;
  }[];
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: 'draft' | 'posted' | 'partially_paid' | 'paid' | 'void';
  notes: string;
};
export const useBills = (p: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: ['supplier-bills', p],
    queryFn: () =>
      getPaged<Bill>(
        '/supplier-bills',
        Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')),
      ),
  });
export type SupplierPayment = {
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  date: string;
  amount: number;
  method: string;
  reference?: string;
};
export const useSupplierPayments = () =>
  useQuery({
    queryKey: ['supplier-payments'],
    queryFn: () => getData<SupplierPayment[]>('/supplier-payments'),
  });
export function useBillMutations() {
  const qc = useQueryClient();
  const done = () => {
    for (const k of ['supplier-bills', 'supplier-payments', '/suppliers', 'reports', 'journals'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<Bill>('/supplier-bills', b),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: { id: string } & Record<string, unknown>) =>
        patchData<Bill>(`/supplier-bills/${id}`, b),
      onSuccess: done,
    }),
    post: useMutation({
      mutationFn: (id: string) => postData<Bill>(`/supplier-bills/${id}/post`),
      onSuccess: done,
    }),
    void: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        postData<Bill>(`/supplier-bills/${id}/void`, { reason }),
      onSuccess: done,
    }),
    pay: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData('/supplier-payments', b),
      onSuccess: done,
    }),
  };
}

export type Expense = {
  id: string;
  number: string;
  date: string;
  categoryAccountId: string;
  amount: number;
  taxAmount: number;
  paidFromAccountId: string;
  payee: string;
  description: string;
  status: 'pending_approval' | 'approved' | 'void';
};
export const useExpenses = (p: Record<string, string | number | undefined>) =>
  useQuery({
    queryKey: ['expenses', p],
    queryFn: () =>
      getPaged<Expense>(
        '/expenses',
        Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined && v !== '')),
      ),
  });
export function useExpenseMutations() {
  const qc = useQueryClient();
  const done = () => {
    for (const k of ['expenses', 'reports', 'journals'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
  return {
    create: useMutation({
      mutationFn: (b: Record<string, unknown>) => postData<Expense>('/expenses', b),
      onSuccess: done,
    }),
    approve: useMutation({
      mutationFn: (id: string) => postData<Expense>(`/expenses/${id}/approve`),
      onSuccess: done,
    }),
    void: useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) =>
        postData<Expense>(`/expenses/${id}/void`, { reason }),
      onSuccess: done,
    }),
  };
}

/** Any `/reports/*` endpoint, cached per parameters. */
export function useReport<T>(
  name: string,
  params: Record<string, string | undefined>,
  enabled = true,
) {
  const p = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  );
  return useQuery({
    queryKey: ['reports', name, p],
    enabled,
    queryFn: () => getData<T>(`/reports/${name}`, { params: p }),
  });
}
