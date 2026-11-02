import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';

/** Patient list filters live in the URL and reach the API; a filtered empty list offers "Clear filters". */

const state = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: () => true }),
  useFieldAccess: () => ({
    canSee: () => true,
    canEdit: () => true,
    isMasked: () => false,
    access: () => 'read',
  }),
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/features/staff/api', () => ({
  staffApi: {
    useList: () => ({ data: { data: [{ id: 'd1', name: 'Dr Ahmad' }] } }),
  },
}));
vi.mock('../api/patients', () => ({
  patientsApi: {
    useList: (p: Record<string, unknown>) => {
      state.calls.push(p);
      return {
        data: { data: [], meta: { total: 0 } },
        isLoading: false,
        isFetching: false,
        error: null,
        refetch: vi.fn(),
      };
    },
  },
}));

function wrap(path: string) {
  return import('../pages/PatientListPage').then(({ PatientListPage }) => {
    const router = createMemoryRouter([{ path: '*', element: <PatientListPage /> }], {
      initialEntries: [path],
    });
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <AppThemeProvider>
          <RouterProvider router={router} />
        </AppThemeProvider>
      </QueryClientProvider>,
    );
  });
}

beforeAll(async () => {
  await import('../pages/PatientListPage');
}, 30_000);

beforeEach(() => {
  state.calls.length = 0;
});

describe('patient list filters', () => {
  it('sends URL filters to the API and offers to clear them when nothing matches', async () => {
    await wrap('/?status=deceased&tag=VIP&dentistId=d1');
    expect(state.calls.at(-1)).toMatchObject({ status: 'deceased', tag: 'VIP', dentistId: 'd1' });
    expect(screen.getByText('No patients match these filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    const last = state.calls.at(-1)!;
    expect(last.status ?? last.tag ?? last.dentistId).toBeUndefined();
    expect(screen.getByText('No patients yet')).toBeInTheDocument();
  });
});
