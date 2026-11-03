import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import type { Communication, Patient } from '../api/patients';

/** Phase 3b slice 3: communication log, quick-add drawer and the follow-up chip. */

const state = vi.hoisted(() => ({
  items: [] as Communication[],
  dueCount: 0,
  save: vi.fn(),
  canWrite: true,
}));

const patient = { id: 'p1', fullName: 'Omar Khalil' } as Patient;
const past = new Date(Date.now() - 86_400_000).toISOString();
const entries: Communication[] = [
  {
    id: 'c1',
    version: 0,
    patientId: 'p1',
    at: '2026-10-01T09:00:00Z',
    channel: 'whatsapp',
    direction: 'out',
    summary: 'Sent the cleaning reminder',
    outcome: 'no_answer',
    followUpAt: past,
    staffId: 's1',
    staffName: 'Reception Person',
    createdAt: '2026-10-01T09:00:00Z',
    editable: true,
  },
  {
    id: 'c2',
    version: 0,
    patientId: 'p1',
    at: '2026-09-20T09:00:00Z',
    channel: 'call',
    direction: 'in',
    summary: 'Asked about prices',
    outcome: 'resolved',
    staffId: 's2',
    createdAt: '2026-09-20T09:00:00Z',
    editable: false,
  },
] as Communication[];

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: (p: string) => p !== 'patients.communication.write' || state.canWrite }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false, access: () => 'write' }),
}));
vi.mock('../pages/PatientWorkspace', () => ({ usePatientContext: () => ({ patient }) }));
vi.mock('../api/patients', async (orig) => ({
  ...(await orig<typeof import('../api/patients')>()),
  useCommunications: () => ({
    isLoading: false,
    isError: false,
    data: { data: state.items, meta: { total: state.items.length, page: 1, pages: 1, dueCount: state.dueCount } },
  }),
  useSaveCommunication: () => ({ mutateAsync: state.save, isPending: false }),
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
  await import('../components/CommunicationLog');
}, 30_000);
beforeEach(() => {
  state.items = entries;
  state.dueCount = 1;
  state.canWrite = true;
  state.save.mockReset().mockResolvedValue({});
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('communication log', () => {
  it('lists entries with outcome, author and the due follow-up, and marks it done', async () => {
    const { CommunicationTab } = await import('../components/CommunicationLog');
    wrap(<CommunicationTab />);
    expect(screen.getByText('1 follow-up due')).toBeInTheDocument();
    expect(screen.getByText('Sent the cleaning reminder')).toBeInTheDocument();
    expect(screen.getByText('No answer')).toBeInTheDocument();
    expect(screen.getByText(/Reception Person/)).toBeInTheDocument();
    expect(screen.getByText(/Follow-up due since/)).toBeInTheDocument();
    // Only the author's recent entry can be edited.
    expect(screen.getAllByRole('button', { name: 'Edit entry' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(state.save).toHaveBeenCalledWith({ id: 'c1', followUpDone: true });
  });

  it('validates and saves the quick-add drawer', async () => {
    const { CommunicationTab } = await import('../components/CommunicationLog');
    wrap(<CommunicationTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Log communication' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('What was said is required')).toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/What was said/), 'Confirmed tomorrow at 10');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.save).toHaveBeenCalled());
    expect(state.save.mock.calls[0]![0]).toEqual({ channel: 'call', direction: 'out', summary: 'Confirmed tomorrow at 10', outcome: 'reached' });
  });

  it('shows the empty state, read-only without write permission, in Arabic', async () => {
    await i18n.changeLanguage('ar');
    state.items = [];
    state.dueCount = 0;
    state.canWrite = false;
    const { CommunicationTab } = await import('../components/CommunicationLog');
    wrap(<CommunicationTab />);
    expect(screen.getByText('لم يُسجَّل أي تواصل بعد')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تسجيل تواصل' })).not.toBeInTheDocument();
  });

  it('shows the header chip only when follow-ups are due', async () => {
    const { FollowUpDueChip } = await import('../components/CommunicationLog');
    const { unmount } = wrap(<FollowUpDueChip patient={patient} />);
    expect(screen.getByTestId('follow-up-due')).toHaveAttribute('href', '/clinic/patients/p1/communication');
    unmount();
    state.dueCount = 0;
    wrap(<FollowUpDueChip patient={patient} />);
    expect(screen.queryByTestId('follow-up-due')).not.toBeInTheDocument();
  });
});
