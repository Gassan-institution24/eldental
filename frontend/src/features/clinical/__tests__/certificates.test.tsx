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
import type { Certificate, CertificatePrint } from '../documentsApi';

/** Phase 3b slice 4: certificates tab, issue drawer and the letterhead print. */

const state = vi.hoisted(() => ({
  list: [] as Certificate[],
  issue: vi.fn(),
  canIssue: true,
}));

const cert: Certificate = {
  id: 'c1',
  number: 'MC-2026-000001',
  patientId: 'p1',
  type: 'sick_leave',
  dentistId: 'd1',
  dentistName: 'Dr Ahmad',
  from: '2026-05-01',
  to: '2026-05-03',
  days: 3,
  diagnosis: 'Acute pulpitis',
  body: 'Rest after the extraction.',
  issuedAt: '2026-05-01T09:00:00Z',
  status: 'issued',
};
const printData: CertificatePrint = {
  certificate: { ...cert, status: 'void', voidReason: 'Wrong dates' },
  patient: { fullName: 'Hala Odeh', fileNumber: 'P-000009' },
  dentist: { name: 'Dr Ahmad', licenseNumber: 'JDA-123' },
  clinic: { name: 'Smile Clinic', phone: '+96265000000' },
};

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: (p: string) => p !== 'clinical.certificate.issue' || state.canIssue }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false, access: () => 'write' }),
}));
vi.mock('@/features/patients/pages/PatientWorkspace', () => ({
  usePatientContext: () => ({ patient: { id: 'p1', fullName: 'Hala Odeh' } as Patient }),
}));
vi.mock('@/shared/hooks/useFileUrl', () => ({ useFileUrl: () => ({ data: undefined }) }));
vi.mock('../documentsApi', async (orig) => ({
  ...(await orig<typeof import('../documentsApi')>()),
  useCertificates: () => ({ data: state.list, isLoading: false, isError: false }),
  useIssueCertificate: () => ({ mutateAsync: state.issue }),
  useVoidCertificate: () => ({ mutateAsync: vi.fn() }),
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
  await import('../pages/CertificatesTab');
}, 30_000);
beforeEach(() => {
  state.list = [cert];
  state.canIssue = true;
  state.issue.mockReset().mockResolvedValue({ ...cert, number: 'MC-2026-000002' });
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('medical certificates', () => {
  it('lists certificates with type, period, dentist and actions', async () => {
    const { CertificatesTab } = await import('../pages/CertificatesTab');
    wrap(<CertificatesTab />);
    const row = screen.getByText('MC-2026-000001').closest('tr')!;
    expect(within(row).getByText('Sick leave')).toBeInTheDocument();
    expect(within(row).getByText(/3 days/)).toBeInTheDocument();
    expect(within(row).getByText('Dr Ahmad')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('suggests the wording, requires the text and issues', async () => {
    const { CertificatesTab } = await import('../pages/CertificatesTab');
    wrap(<CertificatesTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Issue certificate' }));
    const body = (await screen.findByLabelText(/Certificate text/)) as HTMLTextAreaElement;
    await waitFor(() => expect(body.value).toMatch(/Hala Odeh .* rest for 1 day/));
    await userEvent.clear(body);
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    expect(await screen.findByText('Certificate text is required')).toBeInTheDocument();
    expect(state.issue).not.toHaveBeenCalled();
    await userEvent.type(body, 'Two days of rest.');
    await userEvent.click(screen.getByRole('button', { name: 'Issue' }));
    await waitFor(() => expect(state.issue).toHaveBeenCalled());
    expect(state.issue.mock.calls[0]![0]).toMatchObject({ type: 'sick_leave', body: 'Two days of rest.' });
  });

  it('prints on the letterhead with the dentist and a signature line, marking void ones', async () => {
    const { CertificatePrintDialog } = await import('../pages/CertificatesTab');
    wrap(<CertificatePrintDialog id="c1" onClose={() => {}} fetcher={() => Promise.resolve(printData)} />);
    const sheet = await screen.findByTestId('certificate-print');
    expect(within(sheet).getByText('Smile Clinic')).toBeInTheDocument();
    expect(within(sheet).getByText('MC-2026-000001')).toBeInTheDocument();
    expect(within(sheet).getByText('Hala Odeh')).toBeInTheDocument();
    expect(within(sheet).getByText('Dr Ahmad')).toBeInTheDocument();
    expect(within(sheet).getByText('License no. JDA-123')).toBeInTheDocument();
    expect(within(sheet).getByText('Signature')).toBeInTheDocument();
    expect(within(sheet).getByText('VOID — Wrong dates')).toBeInTheDocument();
  });

  it('is read-only without the issue permission, in Arabic', async () => {
    await i18n.changeLanguage('ar');
    state.canIssue = false;
    const { CertificatesTab } = await import('../pages/CertificatesTab');
    wrap(<CertificatesTab />);
    expect(screen.getByText('إجازة مرضية')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إصدار شهادة' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'إلغاء' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طباعة' })).toBeInTheDocument();
  });
});
