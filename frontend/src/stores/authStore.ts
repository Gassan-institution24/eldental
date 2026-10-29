import { create } from 'zustand';

/** Session only: the access token lives in memory, never in localStorage (11_SECURITY.md §1). */
type AuthState = {
  accessToken: string | null;
  bootstrapped: boolean;
  setAccessToken: (token: string | null) => void;
  setBootstrapped: (v: boolean) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  bootstrapped: false,
  setAccessToken: (accessToken) => set({ accessToken }),
  setBootstrapped: (bootstrapped) => set({ bootstrapped }),
  clear: () => set({ accessToken: null }),
}));

export const getAccessToken = () => useAuthStore.getState().accessToken;
