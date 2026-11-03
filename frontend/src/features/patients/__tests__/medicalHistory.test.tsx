import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import type { MedicalHistory, Patient } from '../api/patients';

/** Phase 3b slice 2: medicines, surgeries, lifestyle and pregnancy weeks in the history editor. */

const state = vi.hoisted(() => ({
  history: null as MedicalHistory | null,
  save: vi.fn(),
  canUpdate: true,
}));

const history = {
  id: 'h1',
  version: 2,
  conditions: ['pregnancy', 'anticoagulants'],
  pregnancyWeeks: 20,
  medicationsList: [{ name: 'Warfarin', dose: '5 mg', frequency: 'once daily' }],
  medications: 'Herbal tea',
  surgeries: [{ name: 'Appendectomy', year: 2015 }],
  lifestyle: { smoking: 'former', alcohol: 'none' },
  allergies: [],
  notes: '',
  createdAt: '2026-05-01T09:00:00Z',
} as unknown as MedicalHistory;

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: (p: string) => p !== 'patients.medicalHistory.update' || state.canUpdate }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false, access: () => 'write' }),
}));
vi.mock('../pages/PatientWorkspace', () => ({
  usePatientContext: () => ({ patient: { id: 'p1', fullName: 'Rana Saleh' } as Patient }),
}));
vi.mock('../api/patients', async (orig) => ({
  ...(await orig<typeof import('../api/patients')>()),
  useMedicalHistory: () => ({ data: state.history, isLoading: false, isError: false }),
  useMedicalVersions: () => ({ data: state.history ? [state.history] : [], isLoading: false, isError: false }),
  useSaveMedicalHistory: () => ({ mutateAsync: state.save }),
  useMedicineSearch: () => ({ data: [], isFetching: false }),
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
  await import('../components/MedicalHistory');
}, 30_000);
beforeEach(() => {
  state.history = history;
  state.canUpdate = true;
  state.save.mockReset().mockResolvedValue({ version: 3 });
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('medical history', () => {
  it('shows medicines, surgeries, lifestyle and pregnancy weeks', async () => {
    const { MedicalTab } = await import('../components/MedicalHistory');
    wrap(<MedicalTab />);
    expect(screen.getByText('Pregnant — week 20')).toBeInTheDocument();
    expect(screen.getByText('Warfarin')).toBeInTheDocument();
    expect(screen.getByText(/5 mg · once daily/)).toBeInTheDocument();
    expect(screen.getByText('Herbal tea')).toBeInTheDocument();
    expect(screen.getByText('Appendectomy (2015)')).toBeInTheDocument();
    expect(screen.getByText('Smoking: Former smoker')).toBeInTheDocument();
  });

  it('validates the editor and only asks for weeks when pregnant', async () => {
    const { MedicalTab } = await import('../components/MedicalHistory');
    wrap(<MedicalTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Update history' }));
    const weeks = screen.getByLabelText('Pregnancy (weeks)');
    await userEvent.clear(weeks);
    await userEvent.type(weeks, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Add medicine' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('The value must be at most 42')).toBeInTheDocument();
    expect(screen.getByText('Medicine is required')).toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();

    // Unticking "Pregnant" hides and clears the weeks.
    await userEvent.click(screen.getByLabelText('Pregnant'));
    expect(screen.queryByLabelText('Pregnancy (weeks)')).not.toBeInTheDocument();
    // Many typed interactions; the default 5 s is tight when the whole suite runs in parallel.
  }, 15_000);

  it('saves structured entries', async () => {
    const { MedicalTab } = await import('../components/MedicalHistory');
    wrap(<MedicalTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Update history' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add surgery' }));
    await userEvent.type(screen.getAllByLabelText(/Operation/)[1]!, 'Tonsillectomy');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    const body = state.save.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      pregnancyWeeks: 20,
      medicationsList: [{ name: 'Warfarin', dose: '5 mg', frequency: 'once daily' }],
      surgeries: [{ name: 'Appendectomy', year: 2015 }, { name: 'Tonsillectomy' }],
      lifestyle: { smoking: 'former', alcohol: 'none' },
    });
  });

  it('renders in Arabic and hides editing without permission', async () => {
    await i18n.changeLanguage('ar');
    state.canUpdate = false;
    const { MedicalTab, MedicalBackgroundCard } = await import('../components/MedicalHistory');
    wrap(
      <>
        <MedicalTab />
        <MedicalBackgroundCard patientId="p1" />
      </>,
    );
    expect(screen.getAllByText('حامل — الأسبوع 20').length).toBeGreaterThan(0);
    expect(screen.getByText('الخلفية الطبية')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تحديث التاريخ الطبي' })).not.toBeInTheDocument();
  });
});
