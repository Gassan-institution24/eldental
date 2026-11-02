import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { useUiStore } from '@/stores/uiStore';
import type { FamilyMember, Patient } from '../api/patients';

/** Patient profile overview (16 §3): glance row, preferences, family; each part only with its permission. */

const state = vi.hoisted(() => ({
  denied: new Set<string>(),
  plansEnabled: [] as boolean[],
  apptPatientIds: [] as (string | undefined)[],
  familyEnabled: [] as boolean[],
}));

const patient: Patient = {
  id: 'p1',
  version: 0,
  fileNumber: 'P-000001',
  name: { first: 'Lina', family: 'Haddad' },
  fullName: 'Lina Haddad',
  gender: 'female',
  dateOfBirth: '1990-04-12',
  phone: '+962791234567',
  preferredDentist: 'd1',
  preferredDentistName: 'Dr Ahmad',
  preferredLanguage: 'ar',
  communicationPrefs: { whatsapp: true, sms: false, email: true, marketing: false },
  medicalAlerts: ['condition:diabetes'],
  balance: 0,
  tags: ['VIP'],
  status: 'active',
  noShowCount: 2,
  createdAt: '2026-01-10T08:00:00Z',
} as Patient;

const family: FamilyMember[] = [
  {
    id: 'p2',
    fileNumber: 'P-000002',
    fullName: 'Omar Haddad',
    dateOfBirth: '2016-05-01',
    status: 'active',
    relation: 'dependant',
  },
];

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: (p: string) => !state.denied.has(p) }),
}));
vi.mock('../pages/PatientWorkspace', () => ({ usePatientContext: () => ({ patient }) }));
vi.mock('../components/PatientPicker', () => ({ PatientPicker: () => <div>patient-picker</div> }));
vi.mock('@/features/scheduling/api', () => ({
  usePatientAppointments: (id: string | undefined) => {
    state.apptPatientIds.push(id);
    return {
      isLoading: false,
      data: id
        ? [
            {
              id: 'a1',
              status: 'confirmed',
              start: '2030-01-15T09:00:00Z',
              end: '2030-01-15T09:30:00Z',
            },
          ]
        : undefined,
    };
  },
}));
vi.mock('@/features/clinical/api', () => ({
  usePlans: (_id: string, enabled: boolean) => {
    state.plansEnabled.push(enabled);
    return {
      isLoading: false,
      data: enabled
        ? [{ id: 'tp1', number: 'TP-1', title: 'Upper arch', status: 'in_progress' }]
        : undefined,
    };
  },
}));
vi.mock('../api/patients', async (orig) => ({
  ...(await orig<typeof import('../api/patients')>()),
  useMedicalHistory: () => ({ data: null, isLoading: false }),
  useFamily: (_id: string, enabled: boolean) => {
    state.familyEnabled.push(enabled);
    return { data: enabled ? family : undefined, isLoading: false, isError: false };
  },
  useLinkFamily: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkFamily: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

// PatientTabs pulls in MUI, forms and the clinical/scheduling hooks; load it once, outside the per-test timeout.
beforeAll(async () => {
  await import('../pages/PatientTabs');
}, 30_000);

beforeEach(() => {
  state.denied.clear();
  state.plansEnabled.length = 0;
  state.apptPatientIds.length = 0;
  state.familyEnabled.length = 0;
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  useUiStore.setState({ modePref: 'system' });
});

describe('patient overview', () => {
  it('shows the glance row, preferences and family', async () => {
    const { OverviewTab } = await import('../pages/PatientTabs');
    wrap(<OverviewTab />);
    expect(screen.getByText('Next visit')).toBeInTheDocument();
    expect(screen.getByText('Upper arch')).toBeInTheDocument();
    expect(screen.getByText('Missed appointments')).toBeInTheDocument();
    expect(screen.getByText('Dr Ahmad')).toBeInTheDocument();
    expect(screen.getByText('Arabic')).toBeInTheDocument();
    expect(screen.getByText('WhatsApp messages')).toBeInTheDocument();
    const member = screen.getByText('Omar Haddad').closest('div')!.parentElement!;
    expect(within(member).getByText('Dependant')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link family member' })).toBeInTheDocument();
  });

  it('hides what the role cannot open and does not fetch it', async () => {
    state.denied = new Set([
      'scheduling.appointment.read',
      'clinical.treatmentPlan.read',
      'patients.medicalHistory.read',
      'patients.patient.update',
    ]);
    const { OverviewTab } = await import('../pages/PatientTabs');
    wrap(<OverviewTab />);
    expect(screen.queryByText('Next visit')).not.toBeInTheDocument();
    expect(screen.queryByText('Open treatment plan')).not.toBeInTheDocument();
    expect(screen.queryByText('Medical history')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link family member' })).not.toBeInTheDocument();
    expect(state.plansEnabled.every((e) => !e)).toBe(true);
    expect(state.apptPatientIds.every((id) => id === undefined)).toBe(true);
  });

  it('renders in Arabic and dark mode', async () => {
    await i18n.changeLanguage('ar');
    useUiStore.setState({ modePref: 'dark' });
    const { OverviewTab } = await import('../pages/PatientTabs');
    wrap(<OverviewTab />);
    expect(screen.getByText('أفراد العائلة')).toBeInTheDocument();
    expect(screen.getByText('المواعيد الفائتة')).toBeInTheDocument();
    expect(screen.getByText('تابع')).toBeInTheDocument();
  });
});
