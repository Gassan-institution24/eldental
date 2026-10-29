import { create } from 'zustand';
import type { ColorMode } from '@/theme/createAppTheme';

type ModePref = ColorMode | 'system';

type UiState = {
  modePref: ModePref;
  arabicDigits: boolean;
  navCollapsed: boolean;
  setModePref: (m: ModePref) => void;
  toggleMode: (systemMode: ColorMode) => void;
  setArabicDigits: (v: boolean) => void;
  toggleNav: () => void;
};

const KEY = 'eld.ui';

/** UI preferences only (10_FRONTEND.md §1). Storage access is guarded: it may be blocked. */
function load(): Partial<UiState> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    return {};
  }
}

function save(s: Pick<UiState, 'modePref' | 'arabicDigits' | 'navCollapsed'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore: preferences are a convenience
  }
}

const initial = load();

export const useUiStore = create<UiState>((set, get) => ({
  modePref: initial.modePref ?? 'system',
  arabicDigits: initial.arabicDigits ?? false,
  navCollapsed: initial.navCollapsed ?? false,
  setModePref: (modePref) => {
    set({ modePref });
    save({ ...get(), modePref });
  },
  toggleMode: (systemMode) => {
    const current = get().modePref === 'system' ? systemMode : get().modePref;
    const modePref: ModePref = current === 'dark' ? 'light' : 'dark';
    set({ modePref });
    save({ ...get(), modePref });
  },
  setArabicDigits: (arabicDigits) => {
    set({ arabicDigits });
    save({ ...get(), arabicDigits });
  },
  toggleNav: () => {
    const navCollapsed = !get().navCollapsed;
    set({ navCollapsed });
    save({ ...get(), navCollapsed });
  },
}));
