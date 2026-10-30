import type { AppointmentStatus } from './scheduling.models';

/** Allowed transitions (06 §4). Terminal: completed, cancelled, no_show. */
export const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ['confirmed', 'arrived', 'cancelled', 'no_show'],
  confirmed: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_chair', 'cancelled'],
  in_chair: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses that hold the slot (locks + availability). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['scheduled', 'confirmed', 'arrived', 'in_chair', 'completed'];

/** Display-only status computed from status + time (06 §4): late / running over. */
export function displayStatus(a: { status: AppointmentStatus; start: Date; end: Date }, now = new Date()): string {
  if ((a.status === 'scheduled' || a.status === 'confirmed') && now.getTime() > a.start.getTime() + 10 * 60_000) return 'late';
  if (a.status === 'in_chair' && now.getTime() > a.end.getTime()) return 'running_over';
  return a.status;
}
