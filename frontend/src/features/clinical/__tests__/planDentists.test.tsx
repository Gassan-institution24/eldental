import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlanDentists } from '../components/shared';

/** A new plan proposes a dentist; the owner and front desk are usually not one. */
const state = vi.hoisted(() => ({
  me: 'owner',
  dentists: [] as { id: string; name: string }[],
}));

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ session: { staff: { id: state.me } }, can: () => true }),
}));
vi.mock('@/features/scheduling/components/lookups', () => ({
  useSchedulingLookups: () => ({
    loading: false,
    dentists: state.dentists,
    dentistById: new Map(state.dentists.map((d) => [d.id, d])),
  }),
}));

beforeEach(() => {
  state.me = 'owner';
  state.dentists = [];
});

describe('usePlanDentists', () => {
  it('proposes the signed-in dentist', () => {
    state.me = 'd2';
    state.dentists = [
      { id: 'd1', name: 'Sara' },
      { id: 'd2', name: 'Omar' },
    ];
    const { result } = renderHook(() => usePlanDentists());
    expect(result.current.defaultId).toBe('d2');
    expect(result.current.options).toEqual([
      { value: 'd1', label: 'Sara' },
      { value: 'd2', label: 'Omar' },
    ]);
  });

  it('proposes the only dentist when the owner is not one', () => {
    state.dentists = [{ id: 'd1', name: 'Sara' }];
    expect(renderHook(() => usePlanDentists()).result.current.defaultId).toBe('d1');
  });

  it('leaves the choice open when the owner is not a dentist and there are several', () => {
    state.dentists = [
      { id: 'd1', name: 'Sara' },
      { id: 'd2', name: 'Omar' },
    ];
    expect(renderHook(() => usePlanDentists()).result.current.defaultId).toBe('');
  });
});
