import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { FieldScope, makeFieldAccess } from '@/shared/rbac/fieldAccess';
import type { FieldAccess } from '@/shared/generated/rbac/rbac.types';
import type { Patient } from '../api/patients';

/** Patient details (Phase 3b slice 1): form rules for the new fields, flags, photo and ID badge. */

const state = vi.hoisted(() => ({
  fields: {} as Record<string, string>,
  patient: null as unknown as Patient,
  update: vi.fn(),
}));

const base = {
  id: 'p1',
  version: 3,
  fileNumber: 'P-000001',
  name: { first: 'Lina', family: 'Haddad' },
  fullName: 'Lina Haddad',
  gender: 'female',
  dateOfBirth: '1990-04-12',
  phone: '+962791234567',
  preferredLanguage: 'ar',
  communicationPrefs: { whatsapp: true, sms: false, email: true, marketing: false },
  medicalAlerts: [],
  balance: 0,
  tags: [],
  status: 'active',
  noShowCount: 0,
  createdAt: '2026-01-10T08:00:00Z',
} as unknown as Patient;

vi.mock('@/shared/rbac/usePermission', async () => {
  const { makeFieldAccess: make } = await import('@/shared/rbac/fieldAccess');
  return {
    usePermission: () => ({ can: () => true }),
    useFieldAccess: () => make(state.fields as Record<string, FieldAccess>),
  };
});
vi.mock('@/shared/hooks/useFileUrl', () => ({
  useFileUrl: (id: string | undefined) => ({ data: id ? `blob:${id}` : undefined }),
}));
vi.mock('@/features/staff/api', () => ({
  staffApi: { useList: () => ({ data: { data: [] } }) },
}));
vi.mock('../components/PatientPicker', () => ({ PatientPicker: () => <div>patient-picker</div> }));
vi.mock('../api/patients', async (orig) => {
  const real = await orig<typeof import('../api/patients')>();
  return {
    ...real,
    patientsApi: {
      ...real.patientsApi,
      useItem: () => ({ data: state.patient, isLoading: false, isError: false }),
      useCreate: () => ({ mutateAsync: vi.fn() }),
      useUpdate: () => ({ mutateAsync: state.update }),
    },
    useDuplicateCheck: () => ({ data: [] }),
  };
});

function wrap(node: ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/clinic/patients/:id/edit', element: node },
      { path: '*', element: <div>navigated</div> },
    ],
    { initialEntries: ['/clinic/patients/p1/edit'] },
  );
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
  await import('../pages/PatientFormPage');
}, 30_000);
beforeEach(() => {
  state.fields = {};
  state.update.mockReset().mockResolvedValue({});
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

const invalid = {
  ...base,
  heightCm: 10,
  flags: [{ code: 'other' }],
  referredBy: { type: 'campaign' },
} as unknown as Patient;

describe('patient form — details, flags and referral', () => {
  it('blocks invalid height, a note-less "other" flag and a nameless campaign (en)', async () => {
    state.patient = invalid;
    const { PatientEditPage } = await import('../pages/PatientFormPage');
    wrap(<PatientEditPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('The value must be at least 30')).toBeInTheDocument();
    expect(screen.getByText(/Describe the "other" flag is required/)).toBeInTheDocument();
    expect(screen.getByText('Campaign is required')).toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('shows the same errors in Arabic', async () => {
    await i18n.changeLanguage('ar');
    state.patient = invalid;
    const { PatientEditPage } = await import('../pages/PatientFormPage');
    wrap(<PatientEditPage />);
    await userEvent.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));
    expect(await screen.findByText('يجب ألا تقل القيمة عن 30')).toBeInTheDocument();
    expect(screen.getByText('الحملة مطلوب')).toBeInTheDocument();
  });

  it('saves valid details with the BMI hint and sends only what changed', async () => {
    state.patient = {
      ...base,
      heightCm: 170,
      weightKg: 65,
      flags: [{ code: 'anxious' }],
      referredBy: { type: 'campaign', name: 'Summer smiles' },
    } as unknown as Patient;
    const { PatientEditPage } = await import('../pages/PatientFormPage');
    wrap(<PatientEditPage />);
    expect(screen.getByText('BMI 22.5')).toBeInTheDocument();
    const occupation = screen.getByLabelText('Occupation');
    await userEvent.type(occupation, 'Teacher');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    const body = state.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'p1', version: 3, occupation: 'Teacher' });
    expect(body).not.toHaveProperty('referredBy');
  });

  it('hides fields the role cannot see', async () => {
    state.fields = { vitals: 'hidden', bloodType: 'hidden', flags: 'read' };
    state.patient = base;
    const { PatientEditPage } = await import('../pages/PatientFormPage');
    wrap(<PatientEditPage />);
    expect(screen.queryByLabelText('Height (cm)')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Blood type')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Occupation')).toBeInTheDocument();
  });
});

describe('patient header details', () => {
  const p = {
    ...base,
    photoFileId: 'f1',
    idVerifiedAt: '2026-02-01T10:00:00Z',
    idVerifiedByName: 'Sara',
    flags: [{ code: 'wheelchair' }, { code: 'other', note: 'Prefers mornings' }],
  } as unknown as Patient;

  function scoped(node: ReactNode, fields: Record<string, FieldAccess> = {}) {
    return wrap(<FieldScope value={makeFieldAccess(fields)}>{node}</FieldScope>);
  }

  it('shows non-medical flags, the photo and the ID badge', async () => {
    const { PatientAvatar, PatientFlags, IdVerifiedBadge } = await import('../components/PatientDetailsCards');
    scoped(
      <>
        <PatientAvatar patient={p} size={40} />
        <PatientFlags patient={p} />
        <IdVerifiedBadge patient={p} />
      </>,
    );
    expect(screen.getByTestId('flag-wheelchair')).toHaveTextContent('Wheelchair user');
    expect(screen.getByTestId('flag-other')).toHaveTextContent('Prefers mornings');
    expect(screen.getByTestId('patient-avatar').querySelector('img')).toHaveAttribute('src', 'blob:f1');
    expect(screen.getByTestId('id-verified')).toHaveTextContent('ID verified');
  });

  it('renders flags in Arabic and hides them without access', async () => {
    await i18n.changeLanguage('ar');
    const { PatientFlags } = await import('../components/PatientDetailsCards');
    const { unmount } = scoped(<PatientFlags patient={p} />);
    expect(screen.getByTestId('flag-wheelchair')).toHaveTextContent('يستخدم كرسيًا متحركًا');
    unmount();
    scoped(<PatientFlags patient={p} />, { flags: 'hidden' });
    expect(screen.queryByTestId('flag-wheelchair')).not.toBeInTheDocument();
  });
});
