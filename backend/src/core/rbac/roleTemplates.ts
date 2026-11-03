import { PERMISSION_KEYS, PERMISSIONS, RESOURCE_FIELDS } from './registry';
import type { FieldAccess, Grant, Scope } from './rbac.types';

/**
 * System role templates (04_ROLES_AND_PERMISSIONS.md §5). Seeded on clinic creation, cloned
 * per clinic and editable there. Field maps here are the source of truth for the table in §5.
 */
export type RoleTemplate = { key: string; systemKey: string; permissions: Grant[] };

function g(permission: string, scope: Scope = 'all', fields?: Record<string, FieldAccess>): Grant {
  if (!PERMISSIONS[permission]) throw new Error(`Unknown permission in template: ${permission}`);
  const allowed = PERMISSIONS[permission]?.scopes ?? ['all'];
  const s = allowed.includes(scope) ? scope : (allowed[0] ?? 'all');
  return fields ? { permission, scope: s, fields } : { permission, scope: s };
}

/** All fields of a resource at one level, optionally overriding some. */
function fieldsAll(resource: keyof typeof RESOURCE_FIELDS, level: FieldAccess, overrides: Record<string, FieldAccess> = {}) {
  const out: Record<string, FieldAccess> = {};
  for (const f of Object.keys(RESOURCE_FIELDS[resource])) out[f] = level;
  return { ...out, ...overrides };
}

/** Only the listed groups are visible (read), everything else hidden. */
function fieldsGroups(resource: keyof typeof RESOURCE_FIELDS, groups: string[], level: FieldAccess = 'read') {
  const out: Record<string, FieldAccess> = {};
  for (const [f, def] of Object.entries(RESOURCE_FIELDS[resource])) out[f] = groups.includes(def.group) ? level : 'hidden';
  return out;
}

const selfService: Grant[] = [
  g('hr.attendance.checkin', 'own'),
  g('hr.attendance.read', 'own'),
  g('hr.leave.request', 'own'),
  g('hr.leave.read', 'own'),
  g('hr.compensation.read', 'own'),
  g('hr.payroll.read', 'own', fieldsAll('hr.payroll', 'read')),
  g('logs.activity.read', 'own'),
];

const staffOwn = g('staff.member.read', 'own', fieldsAll('staff.member', 'read', { nationalId: 'masked', bank: 'masked' }));

const owner: RoleTemplate = {
  key: 'owner',
  systemKey: 'owner',
  permissions: PERMISSION_KEYS.map((k) => {
    const def = PERMISSIONS[k];
    const res = def?.resource as keyof typeof RESOURCE_FIELDS;
    return g(k, def?.scopes.includes('all') ? 'all' : 'own', RESOURCE_FIELDS[res] ? fieldsAll(res, 'write') : undefined);
  }),
};

const dentist: RoleTemplate = {
  key: 'dentist',
  systemKey: 'dentist',
  permissions: [
    staffOwn,
    g('patients.patient.read', 'own', fieldsAll('patients.patient', 'read', { nationalId: 'masked', balance: 'read' })),
    g('patients.patient.update', 'own', fieldsAll('patients.patient', 'write', { nationalId: 'hidden', balance: 'read', insurance: 'read' })),
    g('patients.patient.create', 'all', fieldsAll('patients.patient', 'write', { balance: 'read' })),
    g('patients.medicalHistory.read', 'own'),
    g('patients.medicalHistory.update', 'own'),
    g('patients.document.read', 'own'),
    g('patients.document.upload', 'own'),
    g('patients.communication.read', 'own'),
    g('patients.communication.write', 'own'),
    g('scheduling.appointment.read', 'own', fieldsAll('scheduling.appointment', 'read')),
    g('scheduling.appointment.book', 'own', fieldsAll('scheduling.appointment', 'write')),
    g('scheduling.appointment.update', 'own', fieldsAll('scheduling.appointment', 'write')),
    g('scheduling.appointment.cancel', 'own'),
    g('scheduling.schedule.read', 'all'),
    g('scheduling.schedule.manage', 'own'),
    g('clinical.chart.read', 'all'),
    g('clinical.chart.update', 'own'),
    g('clinical.treatmentPlan.read', 'own'),
    g('clinical.treatmentPlan.create', 'own'),
    g('clinical.treatmentPlan.update', 'own'),
    g('clinical.treatmentPlan.present', 'own'),
    g('clinical.procedure.perform', 'own'),
    g('clinical.procedure.void', 'own'),
    g('clinical.note.read', 'own'),
    g('clinical.note.write', 'own'),
    g('clinical.note.sign', 'own'),
    g('clinical.perio.read', 'own'),
    g('clinical.perio.write', 'own'),
    g('clinical.prescription.read', 'own'),
    g('clinical.prescription.write', 'own'),
    g('clinical.certificate.read', 'own'),
    g('clinical.certificate.issue', 'own'),
    g('clinical.instruction.read', 'own'),
    g('clinical.instruction.give', 'own'),
    g('clinical.labOrder.read', 'own'),
    g('clinical.labOrder.manage', 'own'),
    g('clinical.imaging.read', 'own'),
    g('clinical.imaging.upload', 'own'),
    g('billing.invoice.read', 'own', fieldsAll('billing.invoice', 'read', { discounts: 'hidden' })),
    g('reports.dashboard.read', 'own'),
    g('reports.production.read', 'own'),
    g('reports.operational.read', 'own'),
    ...selfService,
  ],
};

const hygienist: RoleTemplate = {
  key: 'hygienist',
  systemKey: 'hygienist',
  permissions: [
    staffOwn,
    g('patients.patient.read', 'own', fieldsAll('patients.patient', 'read', { nationalId: 'hidden', balance: 'hidden' })),
    g('patients.medicalHistory.read', 'own'),
    g('patients.document.read', 'own'),
    g('patients.communication.read', 'own'),
    g('scheduling.appointment.read', 'own', fieldsAll('scheduling.appointment', 'read')),
    g('scheduling.schedule.read', 'all'),
    g('scheduling.recall.manage', 'all'),
    g('clinical.chart.read', 'own'),
    g('clinical.chart.update', 'own'),
    g('clinical.perio.read', 'own'),
    g('clinical.perio.write', 'own'),
    g('clinical.note.read', 'own'),
    g('clinical.note.write', 'own'),
    g('clinical.imaging.read', 'own'),
    g('clinical.imaging.upload', 'own'),
    g('clinical.procedure.perform', 'own'),
    g('clinical.instruction.read', 'own'),
    g('clinical.instruction.give', 'own'),
    g('reports.dashboard.read', 'own'),
    g('reports.production.read', 'own'),
    ...selfService,
  ],
};

const assistant: RoleTemplate = {
  key: 'assistant',
  systemKey: 'assistant',
  permissions: [
    staffOwn,
    g('patients.patient.read', 'all', fieldsAll('patients.patient', 'read', { nationalId: 'hidden', balance: 'hidden' })),
    g('scheduling.appointment.read', 'all', fieldsAll('scheduling.appointment', 'read')),
    g('scheduling.schedule.read', 'all'),
    g('clinical.chart.read', 'own'),
    g('clinical.note.read', 'own'),
    g('clinical.perio.read', 'own'),
    g('clinical.imaging.read', 'own'),
    g('clinical.imaging.upload', 'all'),
    ...selfService,
  ],
};

const receptionist: RoleTemplate = {
  key: 'receptionist',
  systemKey: 'receptionist',
  permissions: [
    g('clinic.settings.read'),
    g('staff.member.read', 'all', fieldsGroups('staff.member', ['basic', 'contact', 'professional'])),
    g('patients.patient.read', 'all', fieldsAll('patients.patient', 'read', { nationalId: 'masked', balance: 'read' })),
    g('patients.patient.create', 'all', fieldsAll('patients.patient', 'write', { balance: 'read', medicalAlerts: 'read' })),
    g('patients.patient.update', 'all', fieldsAll('patients.patient', 'write', { nationalId: 'masked', balance: 'read', medicalAlerts: 'read' })),
    g('patients.patient.delete'),
    g('patients.patient.print'),
    g('patients.patient.import'),
    g('patients.medicalHistory.read', 'all'),
    g('patients.medicalHistory.update', 'all'),
    g('patients.document.read', 'all'),
    g('patients.document.upload', 'all'),
    g('patients.communication.read', 'all'),
    g('patients.communication.write', 'all'),
    g('scheduling.appointment.read', 'all', fieldsAll('scheduling.appointment', 'write')),
    g('scheduling.appointment.book', 'all', fieldsAll('scheduling.appointment', 'write')),
    g('scheduling.appointment.update', 'all', fieldsAll('scheduling.appointment', 'write')),
    g('scheduling.appointment.cancel', 'all'),
    g('scheduling.appointment.checkin'),
    g('scheduling.schedule.read', 'all'),
    g('scheduling.waitlist.manage'),
    g('scheduling.recall.manage'),
    g('clinical.chart.read', 'all'),
    g('clinical.treatmentPlan.read', 'all'),
    g('clinical.certificate.read', 'all'),
    g('clinical.instruction.read', 'all'),
    g('billing.invoice.read', 'all', fieldsAll('billing.invoice', 'read')),
    g('billing.invoice.create', 'all', fieldsAll('billing.invoice', 'write')),
    g('billing.invoice.update', 'all', fieldsAll('billing.invoice', 'write')),
    g('billing.invoice.issue'),
    g('billing.payment.read', 'all', fieldsAll('billing.payment', 'read')),
    g('billing.payment.create', 'all', fieldsAll('billing.payment', 'write')),
    g('billing.insurance.manage'),
    g('billing.cashSession.manage'),
    g('reports.dashboard.read', 'all'),
    g('reports.operational.read', 'all'),
    ...selfService,
  ],
};

const accountant: RoleTemplate = {
  key: 'accountant',
  systemKey: 'accountant',
  permissions: [
    g('clinic.settings.read'),
    g('staff.member.read', 'all', fieldsGroups('staff.member', ['basic'])),
    g('patients.patient.read', 'all', fieldsGroups('patients.patient', ['basic', 'financial'])),
    g('scheduling.appointment.read', 'all', fieldsAll('scheduling.appointment', 'read')),
    ...['read', 'create', 'update', 'issue', 'void', 'discount'].map((a) => g(`billing.invoice.${a}`, 'all', fieldsAll('billing.invoice', 'write'))),
    ...['read', 'create', 'refund'].map((a) => g(`billing.payment.${a}`, 'all', fieldsAll('billing.payment', 'write'))),
    g('billing.insurance.manage'),
    g('billing.cashSession.manage'),
    ...PERMISSION_KEYS.filter((k) => k.startsWith('accounting.')).map((k) => g(k)),
    g('hr.payroll.read', 'all', fieldsAll('hr.payroll', 'read')),
    g('hr.compensation.read', 'all', fieldsAll('hr.compensation', 'read')),
    g('reports.dashboard.read', 'all'),
    g('reports.operational.read', 'all'),
    g('reports.production.read', 'all'),
    ...selfService.filter((s) => s.permission !== 'hr.payroll.read' && s.permission !== 'hr.compensation.read'),
  ],
};

const hrManager: RoleTemplate = {
  key: 'hr_manager',
  systemKey: 'hr_manager',
  permissions: [
    g('clinic.settings.read'),
    ...['read', 'create', 'update', 'delete', 'export'].map((a) => g(`staff.member.${a}`, 'all', fieldsAll('staff.member', 'write'))),
    g('scheduling.schedule.read', 'all'),
    g('scheduling.schedule.manage', 'all'),
    ...PERMISSION_KEYS.filter((k) => k.startsWith('hr.')).map((k) => {
      const res = PERMISSIONS[k]?.resource as keyof typeof RESOURCE_FIELDS;
      return g(k, PERMISSIONS[k]?.scopes.includes('all') ? 'all' : 'own', RESOURCE_FIELDS[res] ? fieldsAll(res, 'write') : undefined);
    }),
    g('logs.activity.read', 'own'),
  ],
};

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [owner, dentist, hygienist, assistant, receptionist, accountant, hrManager];

export function templateFor(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.key === key);
}

/** Which template a staff type gets by default when invited. */
export const DEFAULT_ROLE_FOR_TYPE: Record<string, string> = {
  dentist: 'dentist',
  hygienist: 'hygienist',
  assistant: 'assistant',
  receptionist: 'receptionist',
  accountant: 'accountant',
  hr: 'hr_manager',
  manager: 'owner',
  other: 'assistant',
};
