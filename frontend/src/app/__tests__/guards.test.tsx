import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { GuestGuard } from '../guards';

/** A signed-in user landing on /login (after a reload or an expired token) goes back to `?next=`. */
const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock('@/features/auth/api/session', () => ({
  useSession: () => ({ isLoading: false, isError: false, data: state.session }),
}));

function at(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <GuestGuard><div>login form</div></GuestGuard> },
      { path: '/clinic/patients', element: <div>patients page</div> },
      { path: '/clinic/dashboard', element: <div>dashboard</div> },
      { path: '/admin', element: <div>admin</div> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

const staff = { user: { kind: 'staff', mustChangePassword: false }, clinic: { id: 'c1', timezone: 'Asia/Amman' } };

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', bootstrapped: true });
  state.session = staff;
});

describe('GuestGuard', () => {
  it('sends a signed-in user back to the page they were on', async () => {
    at('/login?next=%2Fclinic%2Fpatients');
    expect(await screen.findByText('patients page')).toBeInTheDocument();
  });

  it('ignores a next that belongs to another area or another site', async () => {
    at('/login?next=%2Fadmin');
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('still shows the form to guests', async () => {
    useAuthStore.setState({ accessToken: null, bootstrapped: true });
    at('/login?next=%2Fclinic%2Fpatients');
    expect(await screen.findByText('login form')).toBeInTheDocument();
  });
});
