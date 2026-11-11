import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/axios';
import { useSetupSteps } from '../DashboardPage';

/** The setup checklist ticks steps from real clinic data and links each one to its page. */
vi.mock('@/features/auth/api/session', () => ({
  useSessionData: () => ({ clinic: { onboardingCompleted: false } }),
}));
vi.mock('@/shared/rbac/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));

let data: Record<string, unknown> = {};
const originalAdapter = api.defaults.adapter;

beforeEach(() => {
  api.defaults.adapter = (config: InternalAxiosRequestConfig) =>
    Promise.resolve({
      status: 200,
      statusText: '',
      headers: {},
      config,
      data: data[config.url ?? ''],
    } as AxiosResponse);
});
afterEach(() => {
  api.defaults.adapter = originalAdapter;
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const paged = (total: number) => ({ data: [], meta: { page: 1, limit: 1, total, pages: 1 } });

describe('useSetupSteps', () => {
  it('ticks steps from the clinic data and links each to its own page', async () => {
    data = {
      '/clinic': { data: { phone: '0791234567', addressLine1: 'Amman' } },
      '/chairs': { data: [{ id: 'c1' }] },
      '/staff': paged(1),
      '/procedures': paged(0),
    };
    const { result } = renderHook(() => useSetupSteps(), { wrapper });
    await waitFor(() => expect(result.current.doneCount).toBe(2));
    expect(result.current.show).toBe(true);
    expect(result.current.steps.map((s) => [s.k, s.done, s.to])).toEqual([
      ['profile', true, '/clinic/settings/general'],
      ['chairs', true, '/clinic/settings/chairs'],
      ['team', false, '/clinic/hr/staff'],
      ['procedures', false, '/clinic/settings/procedures'],
    ]);
  });

  it('hides the checklist once everything is done', async () => {
    data = {
      '/clinic': { data: { phone: '0791234567', addressLine1: 'Amman' } },
      '/chairs': { data: [{ id: 'c1' }] },
      '/staff': paged(3),
      '/procedures': paged(12),
    };
    const { result } = renderHook(() => useSetupSteps(), { wrapper });
    await waitFor(() => expect(result.current.doneCount).toBe(4));
    expect(result.current.show).toBe(false);
  });
});
