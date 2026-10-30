import { nextNumber } from '@/core/db/sequence';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { toSearchName } from '@/shared/validation/normalize';
import { InsuranceCompanyModel, MedicalHistoryModel, PatientModel } from './patient.models';
import { fullNameOf } from './patient.service';

/** Sample people for the demo clinic only (clearly fictional, Jordanian-style names). */
const DEMO: { first: string; father?: string; family: string; gender: 'male' | 'female'; dob: string; phone: string; alerts?: string[] }[] = [
  { first: 'لينا', father: 'سامي', family: 'حداد', gender: 'female', dob: '1990-04-12', phone: '+962791110001' },
  { first: 'عمر', father: 'خالد', family: 'صالح', gender: 'male', dob: '1985-09-03', phone: '+962791110002', alerts: ['condition:diabetes'] },
  { first: 'مايا', family: 'خوري', gender: 'female', dob: '1996-01-22', phone: '+962791110003' },
  { first: 'يوسف', father: 'أحمد', family: 'العلي', gender: 'male', dob: '1978-11-30', phone: '+962791110004', alerts: ['condition:anticoagulants'] },
  { first: 'Sara', family: 'Nasser', gender: 'female', dob: '1992-06-18', phone: '+962791110005', alerts: ['allergy:Penicillin'] },
  { first: 'Ahmad', family: 'Jaber', gender: 'male', dob: '1988-02-14', phone: '+962791110006' },
  { first: 'نور', father: 'محمد', family: 'الزعبي', gender: 'female', dob: '2001-07-07', phone: '+962791110007' },
  { first: 'كريم', family: 'منصور', gender: 'male', dob: '1975-12-01', phone: '+962791110008', alerts: ['condition:heart_disease'] },
  { first: 'Dana', family: 'Haddadin', gender: 'female', dob: '1999-03-25', phone: '+962791110009' },
  { first: 'فراس', father: 'عادل', family: 'القاسم', gender: 'male', dob: '1983-05-16', phone: '+962791110010' },
  { first: 'ريم', family: 'الشريف', gender: 'female', dob: '1994-10-09', phone: '+962791110011' },
  { first: 'Omar', family: 'Khalil', gender: 'male', dob: '1970-08-21', phone: '+962791110012' },
];

registerDemoSeeder({
  name: 'patients.demo',
  order: 20,
  run: async (clinicId) => {
    await runInTenant(clinicId, async () => {
      if ((await PatientModel.countDocuments({})) > 0) return;
      for (const d of DEMO) {
        const name = { first: d.first, father: d.father, family: d.family };
        const p = await PatientModel.create({
          fileNumber: await nextNumber('patient', 'P', { pad: 6 }),
          name,
          fullName: fullNameOf(name),
          searchName: toSearchName(fullNameOf(name)),
          gender: d.gender,
          dateOfBirth: d.dob,
          phone: { e164: d.phone, countryCode: '962', number: d.phone.slice(4) },
          medicalAlerts: d.alerts ?? [],
        });
        if (d.alerts?.length) {
          await MedicalHistoryModel.create({
            patientId: p._id,
            version: 1,
            answers: { conditions: d.alerts.filter((a) => a.startsWith('condition:')).map((a) => a.slice(10)) },
            allergies: d.alerts.filter((a) => a.startsWith('allergy:')).map((a) => ({ substance: a.slice(8), severity: 'severe' })),
          });
        }
      }
      if ((await InsuranceCompanyModel.countDocuments({})) === 0) {
        await InsuranceCompanyModel.insertMany([
          { name: 'Sample Health Insurance', searchName: 'sample health insurance', code: 'SHI', defaultCoveragePercent: 80 },
          { name: 'تأمين تجريبي', searchName: toSearchName('تأمين تجريبي'), code: 'DEMO', defaultCoveragePercent: 70 },
        ]);
      }
    });
  },
});
