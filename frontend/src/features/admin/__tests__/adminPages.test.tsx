import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import type { PlatformUser } from '../api';

/** Superadmin screens mirror the server rules: per-log permissions, escalation, protected root. */

const perms = vi.hoisted(() => ({ held: new Set<string>(), root: false }));
vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({
    can: (p?: string) => !p || perms.root || p.split('|').some((x) => perms.held.has(x)),
    grant: () => undefined,
    session: { isOwner: false, user: { id: 'me', isRootSuperadmin: perms.root } },
  }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false }),
}));
vi.mock('@/features/auth/api/session', async (orig) => ({
  ...(await orig<typeof import('@/features/auth/api/session')>()),
  useSessionData: () => ({
    isOwner: false,
    user: { id: 'me', isRootSuperadmin: perms.root },
    grants: {},
  }),
}));

const admins: PlatformUser[] = [
  {
    id: 'root',
    displayName: 'Root Admin',
    email: 'root@x.test',
    phone: '',
    kind: 'platform',
    isRootSuperadmin: true,
    status: 'active',
    locked: false,
    mfaEnabled: true,
    lastLoginAt: null,
    lastActiveAt: null,
    createdAt: '',
    permissions: [],
  },
  {
    id: 'mona',
    displayName: 'Mona',
    email: 'mona@x.test',
    phone: '',
    kind: 'platform',
    isRootSuperadmin: false,
    status: 'active',
    locked: false,
    mfaEnabled: false,
    lastLoginAt: null,
    lastActiveAt: null,
    createdAt: '',
    permissions: ['platform.clinic.read'],
  },
];
vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  useSuperadmins: () => ({ data: admins, isLoading: false, error: null, refetch: vi.fn() }),
  usePlatformPermissions: () => ({
    data: [
      'platform.clinic.read',
      'platform.clinic.manage',
      'platform.user.read',
      'platform.superadmin.manage',
    ],
  }),
  useSuperadminMutations: () => ({
    invite: { mutateAsync: vi.fn() },
    permissions: { mutateAsync: vi.fn(), isPending: false },
    status: { mutateAsync: vi.fn() },
  }),
  useLogs: () => ({
    data: { data: [], meta: { total: 0 } },
    isLoading: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
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

beforeEach(() => {
  perms.held = new Set();
  perms.root = false;
});

describe('logs page', () => {
  it('shows a tab only for the logs the superadmin may read', async () => {
    perms.held = new Set(['platform.logs.audit.read', 'platform.logs.errors.read']);
    const { LogsPage } = await import('../pages/LogsPage');
    wrap(<LogsPage />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Audit', 'System errors']);
  }, 30_000);
});

describe('superadmins page', () => {
  it('never offers actions on the main superadmin, and only grants what the editor holds', async () => {
    perms.held = new Set(['platform.superadmin.manage', 'platform.clinic.read']);
    const user = userEvent.setup();
    const { SuperadminsPage } = await import('../pages/AccessPages');
    wrap(<SuperadminsPage />);
    const rootRow = screen.getByText('Root Admin').closest('[role="row"]') as HTMLElement;
    expect(within(rootRow).queryByRole('button', { name: /Permissions/ })).not.toBeInTheDocument();
    const monaRow = screen.getByText('Mona').closest('[role="row"]') as HTMLElement;
    await user.click(within(monaRow).getByRole('button', { name: /Permissions/ }));
    const dialog = await screen.findByRole('presentation');
    expect(within(dialog).getByRole('checkbox', { name: /View clinics/ })).toBeEnabled();
    expect(within(dialog).getByRole('checkbox', { name: /View clinics/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Manage clinics/ })).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /View all users/ })).toBeDisabled();
  }, 30_000);
});
