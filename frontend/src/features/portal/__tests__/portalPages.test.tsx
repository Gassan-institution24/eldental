import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { useUiStore } from '@/stores/uiStore';
import type { PortalAppointment } from '../api';

/** Patient portal pages (01 §4.10): booking flow and the cancellation window. */

const calls = vi.hoisted(() => ({ book: [] as Record<string, unknown>[], cancel: [] as string[] }));
const appts = vi.hoisted(() => ({ list: [] as PortalAppointment[] }));

const START = '2030-01-15T07:00:00.000Z';

const data = vi.hoisted(() => {
  const clinic = { id: 'c1', name: 'Smile Clinic', slug: 'smile' };
  const start = '2030-01-15T07:00:00.000Z';
  return {
    me: {
      isLoading: false,
      data: {
        user: { id: 'u1', displayName: 'Lina Haddad', locale: 'en' },
        clinics: [{ ...clinic, onlineBooking: true }],
        patients: [
          { id: 'p1', fileNumber: 'P-000001', fullName: 'Lina Haddad', relation: 'self', clinic },
          {
            id: 'p2',
            fileNumber: 'P-000002',
            fullName: 'Omar Haddad',
            relation: 'dependant',
            clinic,
          },
        ],
      },
    },
    clinics: { isLoading: false, data: [clinic] },
    page: {
      isLoading: false,
      data: {
        ...clinic,
        rules: { cancellationWindowHours: 24, minOnlineLeadHours: 2, maxOnlineDaysAhead: 60 },
        appointmentTypes: [
          { id: 't1', systemKey: 'exam', code: 'EX', durationMin: 30, color: '#4F46E5' },
        ],
        dentists: [{ id: 'd1', name: 'Dr Ahmad', color: '#0E7C86', specialties: [] }],
      },
    },
    slots: {
      isLoading: false,
      data: {
        durationMin: 30,
        days: [{ date: '2030-01-15', slots: [{ start, end: start, dentistId: 'd1' }] }],
      },
      refetch: () => undefined,
    },
    booked: {
      id: 'a1',
      number: 'APT-1',
      start,
      end: start,
      status: 'scheduled',
      upcoming: true,
      dentist: { id: 'd1', name: 'Dr Ahmad' },
      clinic,
      online: true,
      notes: '',
      canCancel: true,
      cancelBy: start,
      cancellationWindowHours: 24,
    },
  };
});

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  usePortalMe: () => data.me,
  useOnlineClinics: () => data.clinics,
  useClinicPage: () => data.page,
  useOnlineSlots: () => data.slots,
  useBookOnline: () => ({
    isPending: false,
    mutateAsync: async (b: Record<string, unknown>) => {
      calls.book.push(b);
      return data.booked;
    },
  }),
  usePortalAppointments: () => ({ isLoading: false, data: appts.list }),
  useCancelAppointment: () => ({
    isPending: false,
    mutateAsync: async ({ id }: { id: string }) => {
      calls.cancel.push(id);
    },
  }),
}));

function wrap(node: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element: node }]);
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppThemeProvider>
        <RouterProvider router={router} />
      </AppThemeProvider>
    </QueryClientProvider>,
  );
}

const appt = (over: Partial<PortalAppointment>): PortalAppointment => ({
  id: 'a1',
  number: 'APT-1',
  start: START,
  end: START,
  status: 'scheduled',
  upcoming: true,
  dentist: { id: 'd1', name: 'Dr Ahmad' },
  clinic: { id: 'c1', name: 'Smile Clinic', slug: 'smile' },
  patient: { id: 'p1', fullName: 'Lina Haddad' },
  online: true,
  notes: '',
  canCancel: true,
  cancelBy: START,
  cancellationWindowHours: 24,
  ...over,
});

beforeAll(async () => {
  await Promise.all([import('../pages/BookPage'), import('../pages/AppointmentsPage')]);
}, 30_000);

beforeEach(async () => {
  calls.book.length = 0;
  calls.cancel.length = 0;
  appts.list = [];
  await i18n.changeLanguage('en');
});
afterEach(() => useUiStore.setState({ modePref: 'system' }));

describe('portal booking', () => {
  it('books the chosen family member, service and time, then confirms', async () => {
    const { BookPage } = await import('../pages/BookPage');
    wrap(<BookPage />);
    const confirm = screen.getByRole('button', { name: 'Confirm booking' });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByText('Omar Haddad'));
    const slotButton = screen.getAllByRole('button').find((b) => b.textContent?.includes(':00'))!;
    await userEvent.click(slotButton);
    await userEvent.type(screen.getByLabelText('Note for the clinic'), 'Loose tooth');
    await userEvent.click(confirm);
    expect(calls.book).toEqual([
      {
        clinicSlug: 'smile',
        patientId: 'p2',
        appointmentTypeId: 't1',
        dentistId: 'd1',
        start: START,
        notes: 'Loose tooth',
      },
    ]);
    expect(await screen.findByText('Your appointment is booked')).toBeInTheDocument();
  });
});

describe('portal appointments', () => {
  it('offers cancel before the window and a call-the-clinic note after it', async () => {
    appts.list = [
      appt({ id: 'a1' }),
      appt({ id: 'a2', canCancel: false, start: '2030-01-16T07:00:00.000Z' }),
    ];
    const { AppointmentsPage } = await import('../pages/AppointmentsPage');
    wrap(<AppointmentsPage />);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    expect(screen.getByText(/Less than 24 hours to go/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    expect(calls.cancel).toEqual(['a1']);
  });

  it('renders in Arabic and dark mode', async () => {
    await i18n.changeLanguage('ar');
    useUiStore.setState({ modePref: 'dark' });
    appts.list = [appt({})];
    const { AppointmentsPage } = await import('../pages/AppointmentsPage');
    wrap(<AppointmentsPage />);
    expect(screen.getByRole('heading', { name: 'مواعيدي' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
  });
});
