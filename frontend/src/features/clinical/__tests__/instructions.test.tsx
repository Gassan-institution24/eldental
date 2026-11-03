import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import type { Patient } from '@/features/patients/api/patients';
import type { CertificatePrint, GivenInstruction, InstructionPrint, InstructionTemplate } from '../documentsApi';
import type { PortalDocuments } from '@/features/portal/api';

/** Phase 3b slice 5: instructions tab (suggestions, snapshot), print, and the portal's "My documents". */

const state = vi.hoisted(() => ({
  given: [] as GivenInstruction[],
  give: vi.fn(),
  suggested: [] as string[],
}));

const templates: InstructionTemplate[] = [
  { id: '64b000000000000000000a01', version: 0, name: null, body: null, systemKey: 'filling', procedureCodes: ['D2391'], isActive: true },
  { id: '64b000000000000000000a02', version: 0, name: null, body: null, systemKey: 'extraction', procedureCodes: ['D7140'], isActive: true },
  { id: '64b000000000000000000a03', version: 0, name: 'Old template', body: 'x', procedureCodes: [], isActive: false },
];
const docs: PortalDocuments = {
  certificates: [
    { id: 'c1', number: 'MC-2026-000001', type: 'sick_leave', from: '2026-05-01', to: '2026-05-02', days: 2, status: 'issued', issuedAt: '2026-05-01T09:00:00Z', dentistName: 'Dr Ahmad', clinic: { id: 'k1', name: 'Smile Clinic', slug: 'smile' }, patient: { id: 'p1', fullName: 'Hala Odeh' } },
  ],
  instructions: [{ id: 'i1', title: 'After your filling', givenAt: '2026-05-01T09:00:00Z', givenByName: 'Dr Ahmad', clinic: { id: 'k1', name: 'Smile Clinic', slug: 'smile' }, patient: { id: 'p1', fullName: 'Hala Odeh' } }],
};
const insPrint: InstructionPrint = {
  instruction: { id: 'i1', patientId: 'p1', title: 'After your filling', body: 'No chewing for 2 hours.', givenBy: 'd1', givenByName: 'Dr Ahmad', givenAt: '2026-05-01T09:00:00Z' },
  patient: { fullName: 'Hala Odeh', fileNumber: 'P-000009' },
  clinic: { name: 'Smile Clinic' },
};
const portalFetch = vi.hoisted(() => ({ cert: vi.fn(), ins: vi.fn() }));

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: () => true }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false, access: () => 'write' }),
}));
vi.mock('@/features/patients/pages/PatientWorkspace', () => ({
  usePatientContext: () => ({ patient: { id: 'p1', fullName: 'Hala Odeh' } as Patient }),
}));
vi.mock('../documentsApi', async (orig) => {
  const real = await orig<typeof import('../documentsApi')>();
  return {
    ...real,
    instructionTemplatesApi: { ...real.instructionTemplatesApi, useAll: () => ({ data: templates, isLoading: false }) },
    useInstructions: () => ({ data: state.given, isLoading: false, isError: false }),
    useInstructionSuggestions: () => ({ data: { codes: ['D7140'], templateIds: state.suggested } }),
    useGiveInstruction: () => ({ mutateAsync: state.give }),
  };
});
vi.mock('@/features/portal/api', async (orig) => ({
  ...(await orig<typeof import('@/features/portal/api')>()),
  usePortalMe: () => ({ isLoading: false, data: { user: { id: 'u1', displayName: 'Hala' }, clinics: [], patients: [{ id: 'p1', fullName: 'Hala Odeh' }] } }),
  usePortalDocuments: () => ({ isLoading: false, isError: false, data: docs }),
  fetchPortalCertificatePrint: portalFetch.cert,
  fetchPortalInstructionPrint: portalFetch.ins,
}));

function wrap(node: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element: node }]);
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

beforeAll(async () => {
  await import('../pages/InstructionsPages');
  await import('@/features/portal/pages/DocumentsPage');
}, 30_000);
beforeEach(() => {
  state.given = [];
  state.suggested = ['64b000000000000000000a02'];
  state.give.mockReset().mockResolvedValue({});
  portalFetch.cert.mockReset().mockResolvedValue({
    certificate: { ...docs.certificates[0]!, patientId: 'p1', dentistId: 'd1', body: 'Rest.' },
    patient: { fullName: 'Hala Odeh', fileNumber: 'P-000009' },
    dentist: { name: 'Dr Ahmad' },
    clinic: { name: 'Smile Clinic' },
  } satisfies CertificatePrint);
  portalFetch.ins.mockReset().mockResolvedValue(insPrint);
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('instructions', () => {
  it('suggests today’s template, fills the translated text and saves a snapshot', async () => {
    const { InstructionsTab } = await import('../pages/InstructionsPages');
    wrap(<InstructionsTab />);
    expect(screen.getByText('No instructions given yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Give instructions' }));
    await userEvent.click(await screen.findByTestId('suggested-64b000000000000000000a02'));
    expect(screen.getByLabelText(/^Title/)).toHaveValue('After a tooth extraction');
    expect((screen.getByLabelText(/^Instructions/) as HTMLTextAreaElement).value).toMatch(/Bite firmly on the gauze/);
    // Inactive templates are not offered.
    expect(within(screen.getByTestId('template-select')).queryByText('Old template')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Give' }));
    await waitFor(() => expect(state.give).toHaveBeenCalled());
    expect(state.give.mock.calls[0]![0]).toMatchObject({ templateId: '64b000000000000000000a02', title: 'After a tooth extraction' });
  });

  it('requires a title and text when writing from scratch, in Arabic', async () => {
    await i18n.changeLanguage('ar');
    state.suggested = [];
    const { InstructionsTab } = await import('../pages/InstructionsPages');
    wrap(<InstructionsTab />);
    await userEvent.click(screen.getByRole('button', { name: 'إعطاء تعليمات' }));
    await userEvent.click(await screen.findByRole('button', { name: 'إعطاء' }));
    expect(await screen.findByText('العنوان مطلوب')).toBeInTheDocument();
    expect(state.give).not.toHaveBeenCalled();
  });

  it('prints the snapshot on the letterhead', async () => {
    const { InstructionPrintDialog } = await import('../pages/InstructionsPages');
    wrap(<InstructionPrintDialog id="i1" onClose={() => {}} fetcher={() => Promise.resolve(insPrint)} />);
    const sheet = await screen.findByTestId('instruction-print');
    expect(within(sheet).getByText('Smile Clinic')).toBeInTheDocument();
    expect(within(sheet).getByText('No chewing for 2 hours.')).toBeInTheDocument();
    expect(within(sheet).getByText(/Given by Dr Ahmad/)).toBeInTheDocument();
  });
});

describe('portal: my documents', () => {
  it('lists certificates and instructions and prints through the portal endpoints', async () => {
    const { DocumentsPage } = await import('@/features/portal/pages/DocumentsPage');
    wrap(<DocumentsPage />);
    expect(screen.getByText('Sick leave')).toBeInTheDocument();
    expect(screen.getByText(/MC-2026-000001/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View & print' }));
    expect(await screen.findByTestId('certificate-print')).toBeInTheDocument();
    expect(portalFetch.cert).toHaveBeenCalledWith('c1');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    await userEvent.click(screen.getByRole('tab', { name: /Instructions/ }));
    expect(screen.getByText('After your filling')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View & print' }));
    expect(await screen.findByTestId('instruction-print')).toBeInTheDocument();
    expect(portalFetch.ins).toHaveBeenCalledWith('i1');
  });

  it('renders in Arabic', async () => {
    await i18n.changeLanguage('ar');
    const { DocumentsPage } = await import('@/features/portal/pages/DocumentsPage');
    wrap(<DocumentsPage />);
    expect(screen.getByText('مستنداتي')).toBeInTheDocument();
    expect(screen.getByText('إجازة مرضية')).toBeInTheDocument();
  });
});
