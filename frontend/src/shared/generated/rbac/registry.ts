// SHARED FILE — synced to the frontend (src/shared/generated/rbac).
// Permissions are code, roles are data (04_ROLES_AND_PERMISSIONS.md §1). Labels are i18n keys.
import type { FieldDef, PermissionDef, Scope } from './rbac.types';

const OWN_ALL: readonly Scope[] = ['own', 'all'];
const ALL: readonly Scope[] = ['all'];
const OWN: readonly Scope[] = ['own'];

function p(resource: string, scopes: readonly Scope[]) {
  return (action: string): [string, PermissionDef] => {
    const key = `${resource}.${action}`;
    return [key, { resource, scopes, labelKey: `perm.${key}` }];
  };
}

const defs: [string, PermissionDef][] = [
  // clinic
  ...['read', 'update'].map(p('clinic.settings', ALL)),
  p('clinic.chair', ALL)('manage'),
  p('clinic.appointmentType', ALL)('manage'),
  p('clinic.procedure', ALL)('manage'),
  // staff
  p('staff.member', OWN_ALL)('read'),
  ...['create', 'update', 'delete', 'export'].map(p('staff.member', ALL)),
  p('staff.role', ALL)('manage'),
  // patients
  ...['read', 'update'].map(p('patients.patient', OWN_ALL)),
  ...['create', 'delete', 'export', 'print'].map(p('patients.patient', ALL)),
  ...['read', 'update'].map(p('patients.medicalHistory', OWN_ALL)),
  ...['read', 'upload', 'delete'].map(p('patients.document', OWN_ALL)),
  ...['read', 'write'].map(p('patients.communication', OWN_ALL)),
  // scheduling
  ...['read', 'book', 'update', 'cancel'].map(p('scheduling.appointment', OWN_ALL)),
  p('scheduling.appointment', ALL)('checkin'),
  ...['read', 'manage'].map(p('scheduling.schedule', OWN_ALL)),
  p('scheduling.waitlist', ALL)('manage'),
  p('scheduling.recall', ALL)('manage'),
  // clinical
  ...['read', 'update'].map(p('clinical.chart', OWN_ALL)),
  ...['read', 'create', 'update', 'present'].map(p('clinical.treatmentPlan', OWN_ALL)),
  p('clinical.procedure', OWN)('perform'),
  p('clinical.procedure', OWN_ALL)('void'),
  ...['read', 'write', 'sign'].map(p('clinical.note', OWN_ALL)),
  ...['read', 'write'].map(p('clinical.perio', OWN_ALL)),
  ...['read', 'write'].map(p('clinical.prescription', OWN_ALL)),
  ...['read', 'manage'].map(p('clinical.labOrder', OWN_ALL)),
  ...['read', 'upload'].map(p('clinical.imaging', OWN_ALL)),
  p('clinical.consent', ALL)('manage'),
  // billing
  p('billing.invoice', OWN_ALL)('read'),
  ...['create', 'update', 'issue', 'void', 'discount'].map(p('billing.invoice', ALL)),
  ...['read', 'create', 'refund'].map(p('billing.payment', ALL)),
  p('billing.insurance', ALL)('manage'),
  p('billing.cashSession', ALL)('manage'),
  // accounting
  ...['read', 'manage'].map(p('accounting.account', ALL)),
  ...['read', 'create', 'post', 'reverse'].map(p('accounting.journal', ALL)),
  p('accounting.period', ALL)('manage'),
  p('accounting.supplier', ALL)('manage'),
  ...['create', 'approve'].map(p('accounting.expense', ALL)),
  ...['read', 'export'].map(p('accounting.report', ALL)),
  p('accounting.einvoice', ALL)('manage'),
  // hr
  p('hr.shift', ALL)('manage'),
  p('hr.attendance', OWN_ALL)('read'),
  p('hr.attendance', OWN)('checkin'),
  p('hr.attendance', ALL)('adjust'),
  p('hr.leave', OWN)('request'),
  p('hr.leave', OWN_ALL)('read'),
  p('hr.leave', ALL)('approve'),
  p('hr.leaveType', ALL)('manage'),
  ...['read', 'update'].map(p('hr.compensation', OWN_ALL)),
  p('hr.payroll', OWN_ALL)('read'),
  ...['run', 'approve'].map(p('hr.payroll', ALL)),
  // inventory
  ...['read', 'manage'].map(p('inventory.item', ALL)),
  p('inventory.stock', ALL)('adjust'),
  // reports
  p('reports.operational', OWN_ALL)('read'),
  p('reports.production', OWN_ALL)('read'),
  p('reports.dashboard', OWN_ALL)('read'),
  // logs
  p('logs.audit', ALL)('read'),
  p('logs.activity', OWN_ALL)('read'),
  p('logs.issues', ALL)('read'),
];

export const PERMISSIONS: Readonly<Record<string, PermissionDef>> = Object.fromEntries(defs);
export type PermissionKey = string;
export const PERMISSION_KEYS: readonly string[] = defs.map(([k]) => k);

/** Module → resource tree for the role editor (04 §7). */
export const MODULES = ['clinic', 'staff', 'patients', 'scheduling', 'clinical', 'billing', 'accounting', 'hr', 'inventory', 'reports', 'logs'] as const;

export function resourceOf(permission: string): string {
  return PERMISSIONS[permission]?.resource ?? permission.split('.').slice(0, 2).join('.');
}

export function actionOf(permission: string): string {
  return permission.split('.').slice(2).join('.');
}

/** Actions that write the resource (field `write` needs one of these). */
export const WRITE_ACTIONS = new Set(['create', 'update', 'manage', 'upload', 'write', 'book', 'perform', 'adjust', 'request']);

type Fields = Record<string, FieldDef>;

/**
 * Field registry (04 §4.1). Every resource holding personal, financial or clinical data
 * declares its fields. Missing grant entries fall back to `default`.
 */
export const RESOURCE_FIELDS = {
  'staff.member': {
    name: { group: 'basic', default: 'read' },
    jobTitle: { group: 'basic', default: 'read' },
    staffType: { group: 'basic', default: 'read' },
    photo: { group: 'basic', default: 'read', paths: ['avatarFileId'] },
    color: { group: 'basic', default: 'read' },
    status: { group: 'basic', default: 'read' },
    fileNumber: { group: 'basic', default: 'read' },
    phone: { group: 'contact', default: 'read', maskable: true, mask: 'phone' },
    email: { group: 'contact', default: 'read', maskable: true, mask: 'email' },
    address: { group: 'contact', default: 'hidden' },
    nationalId: { group: 'identity', default: 'hidden', maskable: true, mask: 'tail4', sensitive: true },
    dateOfBirth: { group: 'identity', default: 'hidden' },
    gender: { group: 'identity', default: 'read' },
    nationality: { group: 'identity', default: 'hidden' },
    specialties: { group: 'professional', default: 'read', paths: ['specialties', 'primarySpecialty'] },
    licenseNumber: { group: 'professional', default: 'read' },
    licenseExpiry: { group: 'professional', default: 'read' },
    bookableOnline: { group: 'professional', default: 'read' },
    employment: { group: 'employment', default: 'hidden' },
    shift: { group: 'employment', default: 'hidden', paths: ['shiftId'] },
    basicSalary: { group: 'compensation', default: 'hidden', sensitive: true, paths: ['compensation.basicSalary', 'compensation.currency', 'compensation.payFrequency'] },
    allowances: { group: 'compensation', default: 'hidden', sensitive: true, paths: ['compensation.allowances', 'compensation.deductions', 'compensation.socialSecurity'] },
    commission: { group: 'compensation', default: 'hidden', sensitive: true, paths: ['compensation.commission'] },
    bank: { group: 'compensation', default: 'hidden', maskable: true, mask: 'tail4', sensitive: true },
    roles: { group: 'access', default: 'read', paths: ['roleIds', 'isOwner'] },
  },
  'patients.patient': {
    name: { group: 'basic', default: 'read' },
    fileNumber: { group: 'basic', default: 'read' },
    gender: { group: 'basic', default: 'read' },
    dateOfBirth: { group: 'basic', default: 'read' },
    status: { group: 'basic', default: 'read' },
    tags: { group: 'basic', default: 'read' },
    preferredDentist: { group: 'basic', default: 'read', paths: ['preferredDentistId'] },
    preferredLanguage: { group: 'basic', default: 'read' },
    phone: { group: 'contact', default: 'read', maskable: true, mask: 'phone' },
    altPhone: { group: 'contact', default: 'read', maskable: true, mask: 'phone' },
    email: { group: 'contact', default: 'read', maskable: true, mask: 'email' },
    address: { group: 'contact', default: 'read' },
    communicationPrefs: { group: 'contact', default: 'read' },
    nationalId: { group: 'identity', default: 'hidden', maskable: true, mask: 'tail4', sensitive: true, paths: ['nationalId', 'passportNo'] },
    guardian: { group: 'family', default: 'read', paths: ['guardian', 'familyGroupId'] },
    emergencyContact: { group: 'family', default: 'read' },
    referralSource: { group: 'basic', default: 'read' },
    referredBy: { group: 'basic', default: 'read' },
    legacyFileNumber: { group: 'basic', default: 'read' },
    photo: { group: 'basic', default: 'read', paths: ['photoFileId', 'photoUrl'] },
    flags: { group: 'basic', default: 'read' },
    maritalStatus: { group: 'identity', default: 'read' },
    occupation: { group: 'identity', default: 'read' },
    nationality: { group: 'identity', default: 'read' },
    idVerification: { group: 'identity', default: 'read', paths: ['idVerifiedAt', 'idVerifiedBy', 'idVerifiedByName'] },
    bloodType: { group: 'clinical', default: 'read' },
    vitals: { group: 'clinical', default: 'read', paths: ['heightCm', 'weightKg', 'bmi'] },
    insurance: { group: 'financial', default: 'read' },
    balance: { group: 'financial', default: 'hidden' },
    medicalAlerts: { group: 'clinical', default: 'read' },
    notes: { group: 'basic', default: 'read' },
  },
  'billing.invoice': {
    patient: { group: 'basic', default: 'read', paths: ['patientId', 'billTo', 'insurancePolicyId'] },
    dentist: { group: 'basic', default: 'read', paths: ['dentistId', 'dentist', 'doctors', 'multipleDoctors'] },
    lines: { group: 'lines', default: 'read', paths: ['lines.description', 'lines.quantity', 'lines.performedProcedureId', 'lines.clinicProcedureId', 'lines.toothNumbers'] },
    prices: { group: 'lines', default: 'read', paths: ['lines.unitPrice', 'lines.lineTotal', 'lines.taxAmount', 'lines.taxRateId', 'lines.patientShare', 'lines.insuranceShare'] },
    discounts: { group: 'lines', default: 'read', paths: ['lines.discount', 'discountTotal', 'discountReason'] },
    totals: { group: 'totals', default: 'read', paths: ['subtotal', 'taxTotal', 'total', 'amountPaid'] },
    balanceDue: { group: 'totals', default: 'read' },
    insuranceShare: { group: 'totals', default: 'read', paths: ['insuranceTotal', 'patientTotal'] },
  },
  'billing.payment': {
    patient: { group: 'basic', default: 'read', paths: ['patientId', 'payerType', 'insuranceCompanyId'] },
    amount: { group: 'basic', default: 'read', paths: ['amount', 'unallocated', 'allocations'] },
    method: { group: 'basic', default: 'read', paths: ['method', 'depositAccountId', 'cheque'] },
    reference: { group: 'basic', default: 'read', maskable: true, mask: 'tail4' },
  },
  'hr.payroll': {
    basic: { group: 'pay', default: 'hidden', sensitive: true },
    earnings: { group: 'pay', default: 'hidden', sensitive: true, paths: ['earnings', 'overtime'] },
    deductions: { group: 'pay', default: 'hidden', sensitive: true, paths: ['deductions', 'absenceDeduction', 'unpaidLeaveDeduction'] },
    commission: { group: 'pay', default: 'hidden', sensitive: true },
    socialSecurity: { group: 'pay', default: 'hidden', sensitive: true },
    incomeTax: { group: 'pay', default: 'hidden', sensitive: true },
    net: { group: 'pay', default: 'hidden', sensitive: true, paths: ['gross', 'net', 'totalDeductions'] },
  },
  'hr.compensation': {
    basicSalary: { group: 'compensation', default: 'read', sensitive: true },
    allowances: { group: 'compensation', default: 'read', sensitive: true },
    commission: { group: 'compensation', default: 'read', sensitive: true },
    bank: { group: 'compensation', default: 'read', maskable: true, mask: 'tail4', sensitive: true },
  },
  'scheduling.appointment': {
    patient: { group: 'basic', default: 'read', paths: ['patientId'] },
    notes: { group: 'basic', default: 'read' },
    patientNotes: { group: 'basic', default: 'read' },
  },
} as const satisfies Record<string, Fields>;

export type ResourceKey = keyof typeof RESOURCE_FIELDS;

export function fieldsOf(resource: string): Fields | undefined {
  return (RESOURCE_FIELDS as Record<string, Fields>)[resource];
}

/** Every field-group in display order for the role editor. */
export const FIELD_GROUP_ORDER = ['basic', 'contact', 'identity', 'family', 'professional', 'employment', 'compensation', 'access', 'financial', 'clinical', 'lines', 'totals', 'pay'];
