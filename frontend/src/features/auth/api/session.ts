import { useQuery } from '@tanstack/react-query';
import { getData } from '@/lib/api/axios';
import { setClinicTimezone } from '@/lib/dates';
import { useAuthStore } from '@/stores/authStore';
import type { Session } from '../types';

export const authKeys = {
  me: ['auth', 'me'] as const,
};

/** `/auth/me` — user, clinic, staff, effective grants with field maps (04 §4.5). */
export function useSession() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: [...authKeys.me, token ? 'auth' : 'guest'],
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const s = await getData<Session>('/auth/me');
      if (s.clinic) setClinicTimezone(s.clinic.timezone);
      return s;
    },
  });
}

/** Current session or null (convenience for components rendered inside guards). */
export function useSessionData(): Session | null {
  return useSession().data ?? null;
}
