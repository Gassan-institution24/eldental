import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { useUiStore } from '@/stores/uiStore';
import type { Invoice } from '../api';

/** Doctor column, multiple-doctor marker, doctor filter and the invoice doctor picker (09 §3.1). */

const perm = vi.hoisted(() => ({ scope: 'all' as 'all' | 'own', owner: false }));
const calls = vi.hoisted(() => ({
  list: [] as Record<string, unknown>[],
  create: [] as Record<string, unknown>[],
  update: [] as Record<string, unknown>[],
}));
const doctors = vi.hoisted(() => ({
  list: [
    { id: 'a0000000000000000000000a', name: 'Dr Ahmad' },
    { id: 'b0000000000000000000000b', name: 'Dr Lina' },
  ],
}));

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({
    can: () => true,
    grant: (p: string) =>
      p === 'billing.invoice.read'
        ? { permission: p, scope: perm.scope }
        : { permission: p, scope: 'all' },
    session: { isOwner: perm.owner, user: { isRootSuperadmin: false } },
  }),
  useFieldAccess: () => ({
    canSee: () => true,
    canEdit: () => true,
    isMasked: () => false,
    access: () => 'write',
  }),
}));

const shared: Invoice = {
  id: 'i1',
  version: 0,
  type: 'invoice',
  status: 'issued',
  number: 'INV-2026-000001',
  patientId: 'p1',
  patient: { fullName: 'Rami Nasser', fileNumber: 'P-1' },
  dentistId: doctors.list[0]!.id,
  dentist: doctors.list[0],
  doctors: doctors.list,
  multipleDoctors: true,
  lines: [],
  invoiceDiscount: 0,
  discountReason: '',
  subtotal: 40_000,
  discountTotal: 0,
  taxTotal: 0,
  total: 40_000,
  insuranceTotal: 0,
  patientTotal: 40_000,
  amountPaid: 0,
  insurancePaid: 0,
  creditedTotal: 0,
  writtenOff: 0,
  balanceDue: 40_000,
  patientDue: 40_000,
  insuranceDue: 0,
  installmentPlan: [],
  notes: '',
  createdAt: '2026-11-01T08:00:00Z',
} as Invoice;

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  useInvoices: (p: Record<string, unknown>) => {
    calls.list.push(p);
    return {
      data: { data: [shared], meta: { total: 1 } },
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useBillingDentists: () => ({ data: doctors.list, isLoading: false }),
  useInvoiceMutations: () => ({
    create: {
      mutateAsync: vi.fn(
        async (b: Record<string, unknown>) => (calls.create.push(b), { id: 'new' }),
      ),
    },
    update: {
      mutateAsync: vi.fn(
        async (b: Record<string, unknown>) => (calls.update.push(b), { id: 'i1' }),
      ),
    },
  }),
}));
vi.mock('@/features/clinic-settings/api', () => ({
  taxRatesApi: { useAll: () => ({ data: [] }) },
}));
vi.mock('@/features/clinical/components/shared', () => ({
  useProcedureLookup: () => ({ items: [], byId: new Map(), label: () => '' }),
}));
vi.mock('@/features/patients/api/patients', () => ({ usePolicies: () => ({ data: [] }) }));
vi.mock('@/features/patients/components/PatientPicker', () => ({
  PatientPicker: () => <div>patient-picker</div>,
}));

function wrap(node: ReactNode, path = '/') {
  const router = createMemoryRouter([{ path: '*', element: node }], { initialEntries: [path] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppThemeProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </AppThemeProvider>
    </QueryClientProvider>,
  );
}

// The invoice pages are large; load them once outside the per-test timeout.
beforeAll(async () => {
  await Promise.all([import('../pages/InvoicePages'), import('../components/InvoiceDoctors')]);
}, 30_000);

beforeEach(() => {
  perm.scope = 'all';
  perm.owner = false;
  calls.list.length = 0;
  calls.create.length = 0;
  calls.update.length = 0;
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  useUiStore.setState({ modePref: 'system' });
});

describe('invoice doctor column', () => {
  it('lists a Doctor column bound to the dentist field', async () => {
    const { useInvoiceColumns } = await import('../pages/InvoicePages');
    const { result } = renderHook(() => useInvoiceColumns());
    const col = result.current.find((c) => c.field === 'dentist');
    expect(col).toMatchObject({ headerName: 'Doctor', fieldKey: 'dentist' });
    // The first test pays for loading the invoice pages module.
  }, 30_000);

  it('shows the doctor and a "Multiple doctors" marker, in English and Arabic, light and dark', async () => {
    const { InvoiceDoctorCell } = await import('../components/InvoiceDoctors');
    const { unmount } = wrap(<InvoiceDoctorCell invoice={shared} />);
    expect(screen.getByText('Dr Ahmad')).toBeInTheDocument();
    expect(screen.getByTestId('multiple-doctors')).toHaveTextContent('Multiple doctors');
    unmount();
    await i18n.changeLanguage('ar');
    useUiStore.setState({ modePref: 'dark' });
    wrap(
      <InvoiceDoctorCell
        invoice={{ ...shared, multipleDoctors: false, doctors: [doctors.list[0]!] }}
      />,
    );
    expect(screen.getByText('Dr Ahmad')).toBeInTheDocument();
    expect(screen.queryByTestId('multiple-doctors')).not.toBeInTheDocument();
    wrap(<InvoiceDoctorCell invoice={{ multipleDoctors: false }} />);
    expect(screen.getByText('لم يُحدَّد طبيب')).toBeInTheDocument();
  });
});

describe('doctor filter', () => {
  it('reads the doctor filter from the URL (shareable) and sends it to the list query', async () => {
    const { InvoicesPage } = await import('../pages/InvoicePages');
    wrap(<InvoicesPage />, '/?dentistId=b0000000000000000000000b');
    const filter = screen.getByLabelText('Doctor');
    expect(filter).toHaveTextContent('Dr Lina');
    expect(calls.list.at(-1)).toMatchObject({ dentistId: doctors.list[1]!.id });
  });

  it('offers every billable doctor plus "All doctors"', async () => {
    const user = userEvent.setup();
    const { InvoicesPage } = await import('../pages/InvoicePages');
    wrap(<InvoicesPage />);
    expect(calls.list.at(-1)).not.toHaveProperty('dentistId');
    await user.click(screen.getByLabelText('Doctor'));
    const options = within(await screen.findByRole('listbox'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['All doctors', 'Dr Ahmad', 'Dr Lina']);
  });

  it('selecting a doctor updates the URL filter and the list query', async () => {
    const user = userEvent.setup();
    const { InvoicesPage } = await import('../pages/InvoicePages');
    wrap(<InvoicesPage />);
    await user.click(screen.getByRole('combobox', { name: 'Doctor' }));
    await user.click(
      within(await screen.findByRole('listbox')).getByRole('option', { name: 'Dr Lina' }),
    );
    await waitFor(() =>
      expect(calls.list.at(-1)).toMatchObject({ dentistId: doctors.list[1]!.id }),
    );
    expect(screen.getByRole('combobox', { name: 'Doctor' })).toHaveTextContent('Dr Lina');
  });

  it('is hidden for doctors who only see their own invoices', async () => {
    perm.scope = 'own';
    const { InvoicesPage } = await import('../pages/InvoicePages');
    wrap(<InvoicesPage />, '/?dentistId=b0000000000000000000000b');
    expect(screen.queryByLabelText('Doctor')).not.toBeInTheDocument();
    // A doctor id in the URL is ignored: own scope can't be widened from the UI either.
    expect(calls.list.at(-1)).not.toHaveProperty('dentistId');
  });
});

describe('manual invoice doctor picker', () => {
  it('requires a responsible doctor when the clinic has several', async () => {
    const user = userEvent.setup();
    const { InvoiceEditor } = await import('../components/InvoiceEditor');
    wrap(
      <InvoiceEditor
        patient={{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', fullName: 'Rami' }}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/^Description/), 'Whitening');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText(/Responsible doctor is required/i)).toBeInTheDocument();
    expect(calls.create).toHaveLength(0);
  });

  it('defaults to the given doctor and sends it for manual lines', async () => {
    const user = userEvent.setup();
    const { InvoiceEditor } = await import('../components/InvoiceEditor');
    wrap(
      <InvoiceEditor
        patient={{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', fullName: 'Rami' }}
        dentistId={doctors.list[1]!.id}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/^Description/), 'Whitening');
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(calls.create).toHaveLength(1));
    expect(calls.create[0]).toMatchObject({
      dentistId: doctors.list[1]!.id,
      lines: [{ dentistId: doctors.list[1]!.id }],
    });
  });

  it('pre-selects the only doctor of a one-doctor clinic', async () => {
    const saved = doctors.list;
    doctors.list = [saved[0]!];
    try {
      const { InvoiceEditor } = await import('../components/InvoiceEditor');
      wrap(
        <InvoiceEditor
          patient={{ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', fullName: 'Rami' }}
          onClose={vi.fn()}
        />,
      );
      await waitFor(() =>
        expect(screen.getByLabelText(/Responsible doctor/)).toHaveTextContent('Dr Ahmad'),
      );
    } finally {
      doctors.list = saved;
    }
  });

  it('locks the doctor of a line that comes from a recorded procedure', async () => {
    const user = userEvent.setup();
    const { InvoiceEditor } = await import('../components/InvoiceEditor');
    const draft = {
      ...shared,
      patientId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'draft',
      lines: [
        {
          id: 'd0000000000000000000000d',
          performedProcedureId: 'c0000000000000000000000c',
          description: 'D0120',
          toothNumbers: [],
          quantity: 1,
          unitPrice: 10_000,
          discount: 0,
          taxAmount: 0,
          lineTotal: 10_000,
          insuranceShare: 0,
          patientShare: 10_000,
          dentistId: doctors.list[1]!.id,
          dentistName: 'Dr Lina',
          dentistLocked: true,
        },
      ],
    } as Invoice;
    wrap(<InvoiceEditor invoice={draft} onClose={vi.fn()} />);
    const locked = screen.getByTestId('line-doctor-locked-0');
    expect(locked).toBeDisabled();
    expect(locked).toHaveValue('Dr Lina');
    expect(screen.getByText(/can't be changed on the invoice/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(calls.update).toHaveLength(1));
    // The performer is never sent for a procedure line, so billing can't reassign it.
    const line = (calls.update[0]!.lines as Record<string, unknown>[])[0]!;
    expect(line).toMatchObject({
      id: 'd0000000000000000000000d',
      performedProcedureId: 'c0000000000000000000000c',
    });
    expect(line).not.toHaveProperty('dentistId');
    expect(calls.update[0]).toMatchObject({ dentistId: doctors.list[0]!.id });
  });
});
