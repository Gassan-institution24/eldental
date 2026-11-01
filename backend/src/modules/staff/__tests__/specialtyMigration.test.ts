import { describe, expect, it } from 'vitest';
import { DENTAL_SPECIALTIES, specialtyFromText } from '@/shared/dental/specialties';
import { planSpecialtyMigration } from '../specialtyMigration';

describe('specialtyFromText', () => {
  it('maps codes, English and Arabic wording; leaves the rest unmapped', () => {
    for (const code of DENTAL_SPECIALTIES) expect(specialtyFromText(code)).toBe(code);
    expect(specialtyFromText('  Orthodontics ')).toBe('orthodontics');
    expect(specialtyFromText('Oral & Maxillofacial Surgery')).toBe('oral_surgery');
    expect(specialtyFromText('تقويم الأسنان')).toBe('orthodontics');
    expect(specialtyFromText('زراعة الأسنان')).toBe('implantology');
    expect(specialtyFromText('Cardiology')).toBeNull();
    expect(specialtyFromText('')).toBeNull();
  });
});

describe('planSpecialtyMigration', () => {
  it('maps clinical staff with known values and reports everything else without touching it', () => {
    const plan = planSpecialtyMigration([
      { _id: 1, staffType: 'dentist', specialty: 'endodontics' },
      { _id: 2, staffType: 'dentist', specialty: 'orthodontics' },
      { _id: 3, staffType: 'dentist', specialty: 'Laser therapy' },
      { _id: 4, staffType: 'receptionist', specialty: 'general' },
      { _id: 5, staffType: 'dentist', specialty: 'general', specialties: ['general'] },
      { _id: 6, staffType: 'dentist', specialty: '' },
      { _id: 7, staffType: 'hygienist' },
    ]);
    expect(plan.map((p) => [p.id, p.kind, p.kind === 'map' ? p.to : p.reason])).toEqual([
      [1, 'map', 'endodontics'],
      [2, 'map', 'orthodontics'],
      [3, 'unmapped', 'unknown_value'],
      [4, 'unmapped', 'not_clinical_staff'],
      [5, 'unmapped', 'already_structured'],
    ]);
  });
});
