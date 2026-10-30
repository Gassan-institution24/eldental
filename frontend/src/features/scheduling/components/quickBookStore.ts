import { create } from 'zustand';

export type QuickBookPreset = {
  patientId?: string;
  dentistId?: string;
  chairId?: string;
  start?: string;
  appointmentTypeId?: string;
  source?: 'staff' | 'walk_in' | 'recall';
  recallId?: string;
  waitlistId?: string;
  plannedItemIds?: string[];
  durationMin?: number;
};

type State = {
  isOpen: boolean;
  preset: QuickBookPreset;
  open: (preset: QuickBookPreset) => void;
  close: () => void;
};

/** Opens the quick-book drawer from anywhere (top bar, calendar, patient header). */
export const useQuickBook = create<State>((set) => ({
  isOpen: false,
  preset: {},
  open: (preset) => set({ isOpen: true, preset }),
  close: () => set({ isOpen: false, preset: {} }),
}));

type PanelState = { id: string | null; show: (id: string) => void; hide: () => void };

/** The appointment detail drawer, opened from the calendar, today board or patient tabs. */
export const useAppointmentPanel = create<PanelState>((set) => ({
  id: null,
  show: (id) => set({ id }),
  hide: () => set({ id: null }),
}));
