/** Design tokens (16_UX_UI_AND_VALIDATION.md §2). Components never hard-code colours. */
export const primaryScale = {
  50: '#EEF0FF',
  100: '#E0E3FF',
  200: '#C6CAFF',
  300: '#A3A6FE',
  400: '#8180F9',
  500: '#6461F1',
  600: '#4F46E5',
  700: '#4338CA',
  800: '#3730A3',
  900: '#312E81',
} as const;

export const brand = {
  indigo: '#4F46E5',
  violet: '#7C3AED',
  cyan: '#06B6D4',
  mint: '#10B981',
  navy: '#0B1020',
  navy2: '#111936',
  /** Signature gradient used for primary CTAs, highlights and the brand mark. */
  gradient: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 55%, #06B6D4 100%)',
  gradientSoft:
    'linear-gradient(135deg, rgba(79,70,229,.12) 0%, rgba(124,58,237,.10) 55%, rgba(6,182,212,.12) 100%)',
  sidebar: 'linear-gradient(180deg, #0B1020 0%, #111936 100%)',
} as const;

export const tokens = {
  light: {
    primary: '#4F46E5',
    secondary: '#06B6D4',
    background: '#F5F6FB',
    paper: '#FFFFFF',
    border: '#E6E8F0',
    textPrimary: '#0F172A',
    textSecondary: '#5B6478',
    elevated: '0 1px 2px rgba(16,24,40,.04), 0 12px 32px -12px rgba(16,24,40,.12)',
  },
  dark: {
    primary: '#8B87FF',
    secondary: '#22D3EE',
    background: '#0A0F1E',
    paper: '#11172B',
    border: 'rgba(148,163,184,.14)',
    textPrimary: '#E8ECF7',
    textSecondary: '#94A0B8',
    elevated: '0 1px 2px rgba(0,0,0,.4), 0 16px 40px -16px rgba(0,0,0,.6)',
  },
  semantic: { success: '#10B981', warning: '#F59E0B', error: '#EF4444', info: '#0EA5E9' },
  radius: { card: 16, input: 12, button: 12, dialog: 20 },
  motionMs: 180,
} as const;

/** Status colours used by <StatusChip> (one mapping for the whole app). */
export type StatusTone =
  'grey' | 'blue' | 'amber' | 'purple' | 'green' | 'red' | 'redOutline' | 'teal';

export const STATUS_TONES: Record<string, StatusTone> = {
  // appointments
  scheduled: 'grey',
  confirmed: 'blue',
  arrived: 'amber',
  in_chair: 'purple',
  completed: 'green',
  cancelled: 'redOutline',
  no_show: 'red',
  // invoices
  draft: 'grey',
  issued: 'blue',
  partially_paid: 'amber',
  paid: 'green',
  void: 'redOutline',
  // plans / leave / payroll / generic
  presented: 'blue',
  accepted: 'green',
  partially_accepted: 'amber',
  rejected: 'red',
  in_progress: 'purple',
  pending: 'amber',
  approved: 'green',
  calculated: 'blue',
  posted: 'green',
  reversed: 'redOutline',
  active: 'green',
  inactive: 'grey',
  suspended: 'red',
  disabled: 'grey',
  locked: 'red',
  terminated: 'redOutline',
  trialing: 'blue',
  past_due: 'amber',
  new: 'blue',
  acknowledged: 'amber',
  resolved: 'green',
  ignored: 'grey',
  open: 'green',
  closed: 'grey',
  soft_closed: 'amber',
  submitted: 'blue',
  partially_approved: 'amber',
  sent: 'blue',
  received: 'teal',
  fitted: 'green',
  remake: 'amber',
  due: 'amber',
  contacted: 'blue',
  booked: 'green',
  dismissed: 'grey',
  waiting: 'amber',
  offered: 'blue',
  removed: 'grey',
  queued: 'grey',
  failed: 'red',
  delivered: 'green',
  final: 'green',
  present: 'green',
  absent: 'red',
  on_leave: 'blue',
  holiday: 'teal',
};

/** Patient-facing accent: calmer cyan → mint, used on the portal and its sign-in screens. */
export const patientGradient = 'linear-gradient(135deg, #0891B2 0%, #06B6D4 45%, #10B981 100%)';
