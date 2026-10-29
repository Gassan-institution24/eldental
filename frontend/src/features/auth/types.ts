import type { FieldAccess, Scope } from '@/shared/generated/rbac/rbac.types';

export type Grant = { scope: Scope; fields: Record<string, FieldAccess>; clinicIds?: string[] };

export type SessionUser = {
  id: string;
  kind: 'platform' | 'staff' | 'patient';
  displayName: string;
  email?: string;
  phone?: string;
  locale: 'ar' | 'en';
  isRootSuperadmin: boolean;
  mfaEnabled: boolean;
  mustChangePassword: boolean;
};

export type SessionClinic = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  locale: 'ar' | 'en';
  status: 'active' | 'suspended';
  subscriptionStatus: string;
  readOnly: boolean;
  onboardingCompleted: boolean;
};

export type SessionStaff = { id: string; name: string; staffType: string; isOwner: boolean; color?: string };

export type ClinicChoice = { id: string; name: string; slug: string; isOwner: boolean };

export type Session = {
  user: SessionUser;
  clinic: SessionClinic | null;
  staff: SessionStaff | null;
  patientIds?: string[];
  grants: Record<string, Grant>;
  isOwner: boolean;
  clinics: ClinicChoice[];
  impersonation?: { byUserId: string; byName: string } | null;
  readOnly: boolean;
};

export type LoginResponse = {
  accessToken?: string;
  user?: SessionUser;
  clinics?: ClinicChoice[];
  clinicId?: string | null;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  mfaToken?: string;
};
