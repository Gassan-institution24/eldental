import { describe, expect, it } from 'vitest';
import { maskValue } from '../fieldPolicy';
import { PERMISSION_KEYS } from '../registry';
import { buildFieldPolicy, escalationViolations, resolveEffectiveGrants } from '../resolve';
import { ROLE_TEMPLATES, templateFor } from '../roleTemplates';

describe('resolveEffectiveGrants', () => {
  it('unions roles: all beats own, write > read > masked > hidden', () => {
    const r = resolveEffectiveGrants([
      [{ permission: 'staff.member.read', scope: 'own', fields: { phone: 'masked', basicSalary: 'hidden' } }],
      [{ permission: 'staff.member.read', scope: 'all', fields: { phone: 'read' } }],
    ]);
    expect(r['staff.member.read']?.scope).toBe('all');
    expect(r['staff.member.read']?.fields.phone).toBe('read');
    expect(r['staff.member.read']?.fields.basicSalary).toBe('hidden');
  });

  it('applies registry defaults for missing field entries', () => {
    const r = resolveEffectiveGrants([[{ permission: 'staff.member.read', scope: 'all' }]]);
    expect(r['staff.member.read']?.fields.name).toBe('read');
    expect(r['staff.member.read']?.fields.basicSalary).toBe('hidden');
    expect(r['staff.member.read']?.fields.nationalId).toBe('hidden');
  });

  it('non-maskable fields cannot be masked (fall back to hidden)', () => {
    const r = resolveEffectiveGrants([[{ permission: 'staff.member.read', scope: 'all', fields: { basicSalary: 'masked' } }]]);
    expect(r['staff.member.read']?.fields.basicSalary).toBe('hidden');
  });

  it('overrides replace the merged result; revoked removes it', () => {
    const roles = [[
      { permission: 'staff.member.read', scope: 'all' as const, fields: { basicSalary: 'read' as const } },
      { permission: 'patients.patient.read', scope: 'all' as const },
    ]];
    const r = resolveEffectiveGrants(roles, [
      { permission: 'staff.member.read', scope: 'all', fields: { name: 'read', phone: 'read', basicSalary: 'hidden' } },
      { permission: 'patients.patient.read', revoked: true },
    ]);
    expect(r['staff.member.read']?.fields.basicSalary).toBe('hidden');
    expect(r['patients.patient.read']).toBeUndefined();
  });

  it('own-only permissions cannot be widened to all', () => {
    const r = resolveEffectiveGrants([[{ permission: 'clinical.procedure.perform', scope: 'all' }]]);
    expect(r['clinical.procedure.perform']?.scope).toBe('own');
  });
});

describe('buildFieldPolicy', () => {
  it('writable needs both write level and a write action on the resource', () => {
    const readOnly = resolveEffectiveGrants([[{ permission: 'staff.member.read', scope: 'all', fields: { name: 'write' } }]]);
    expect(buildFieldPolicy(readOnly, 'staff.member').writable.has('name')).toBe(false);
    const rw = resolveEffectiveGrants([[{ permission: 'staff.member.update', scope: 'all', fields: { name: 'write' } }]]);
    expect(buildFieldPolicy(rw, 'staff.member', { actionPermission: 'staff.member.update' }).writable.has('name')).toBe(true);
    expect(buildFieldPolicy(rw, 'staff.member').writable.has('name')).toBe(false);
  });

  it('owner bypass sees and writes everything', () => {
    const p = buildFieldPolicy({}, 'staff.member', { bypass: true });
    expect(p.writable.has('basicSalary')).toBe(true);
  });
});

describe('masking', () => {
  it.each([
    ['phone', '+962791234567', '079•••••67'],
    ['email', 'owner@smile.local', 'o•••@s•••.local'],
    ['tail4', '9871234567', '•••• 4567'],
  ] as const)('%s', (kind, input, expected) => {
    expect(maskValue(kind, input)).toBe(expected);
  });
});

describe('escalation rule (04 §8.2)', () => {
  it('rejects permissions the granter does not hold or wider field rules', () => {
    const mine = { 'staff.member.read': { fields: { basicSalary: 'hidden' as const, name: 'read' as const } } };
    expect(escalationViolations(mine, [{ permission: 'staff.member.read', scope: 'all', fields: { name: 'read' } }])).toEqual([]);
    expect(escalationViolations(mine, [{ permission: 'staff.member.read', scope: 'all', fields: { basicSalary: 'read' } }])).toEqual(['staff.member.read:basicSalary']);
    expect(escalationViolations(mine, [{ permission: 'staff.member.update', scope: 'all' }])).toEqual(['staff.member.update']);
    expect(escalationViolations('root', [{ permission: 'staff.member.update', scope: 'all' }])).toEqual([]);
  });

  it('cannot widen a clinic restriction', () => {
    const mine = { 'platform.clinicData.read': { clinicIds: ['a'] } };
    expect(escalationViolations(mine, [{ permission: 'platform.clinicData.read', scope: 'all', clinicIds: ['a'] }])).toEqual([]);
    expect(escalationViolations(mine, [{ permission: 'platform.clinicData.read', scope: 'all' }])).toEqual(['platform.clinicData.read:clinicIds']);
  });
});

describe('system role templates (04 §5 snapshot)', () => {
  const eff = (key: string) => resolveEffectiveGrants([templateFor(key)!.permissions]);

  it('only known permissions are used', () => {
    for (const t of ROLE_TEMPLATES) for (const g of t.permissions) expect(PERMISSION_KEYS).toContain(g.permission);
  });

  it('owner has every permission', () => {
    expect(Object.keys(eff('owner')).sort()).toEqual([...PERMISSION_KEYS].sort());
  });

  it('receptionist: staff names + phones but never salaries; nationalId masked on patients; no export', () => {
    const r = eff('receptionist');
    const p = buildFieldPolicy(r, 'staff.member');
    expect(p.visible.has('name')).toBe(true);
    expect(p.visible.has('phone')).toBe(true);
    expect(p.visible.has('basicSalary')).toBe(false);
    expect(p.masked.has('basicSalary')).toBe(false);
    expect(buildFieldPolicy(r, 'patients.patient').masked.has('nationalId')).toBe(true);
    expect(r['patients.patient.export']).toBeUndefined();
    expect(r['scheduling.appointment.checkin']?.scope).toBe('all');
    expect(r['accounting.journal.read']).toBeUndefined();
  });

  it('dentist works on own records and cannot see invoice discounts', () => {
    const d = eff('dentist');
    expect(d['patients.patient.read']?.scope).toBe('own');
    expect(d['scheduling.appointment.book']?.scope).toBe('own');
    expect(d['clinical.chart.read']?.scope).toBe('all');
    expect(d['billing.invoice.read']?.fields.discounts).toBe('hidden');
    expect(d['staff.member.read']?.scope).toBe('own');
    expect(d['billing.payment.create']).toBeUndefined();
  });

  it('HR sees and edits compensation; accountant reads payroll but not salaries on staff', () => {
    expect(buildFieldPolicy(eff('hr_manager'), 'staff.member', { actionPermission: 'staff.member.update' }).writable.has('basicSalary')).toBe(true);
    const acc = eff('accountant');
    expect(buildFieldPolicy(acc, 'staff.member').visible.has('basicSalary')).toBe(false);
    expect(acc['hr.payroll.read']?.scope).toBe('all');
    expect(acc['accounting.period.manage']).toBeTruthy();
  });

  it('everyone can check in and request leave for themselves', () => {
    for (const k of ['dentist', 'hygienist', 'assistant', 'receptionist', 'accountant']) {
      expect(eff(k)['hr.attendance.checkin']?.scope).toBe('own');
      expect(eff(k)['hr.leave.request']?.scope).toBe('own');
    }
  });
});
