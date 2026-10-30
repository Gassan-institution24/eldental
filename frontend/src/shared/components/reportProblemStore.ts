import { create } from 'zustand';

type State = {
  isOpen: boolean;
  presetMessage?: string;
  open: (presetMessage?: string) => void;
  close: () => void;
};

/** Opens the global "Report a problem" dialog from anywhere (menus, error screens). */
export const useReportProblem = create<State>((set) => ({
  isOpen: false,
  open: (presetMessage) => set({ isOpen: true, presetMessage }),
  close: () => set({ isOpen: false, presetMessage: undefined }),
}));
