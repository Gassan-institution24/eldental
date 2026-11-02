import { Types } from 'mongoose';
import { logger } from '@/config/logger';
import { nextNumber } from '@/core/db/sequence';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { hashPassword } from '@/modules/auth/auth.service';
import { TreatmentPlanModel } from '@/modules/clinical/clinical.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { fullNameOf } from '@/modules/patients/patient.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { UserModel } from '@/modules/users/user.model';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { toSearchName } from '@/shared/validation/normalize';

export const DEMO_PATIENT_EMAIL = 'patient@smile.local';

/**
 * Demo clinic only: online booking on, and a portal account linked to the patient who has the
 * presented plan (so plans, appointments and invoices all show), with one child dependant.
 */
registerDemoSeeder({
  name: 'portal.demo',
  order: 90,
  run: async (clinicId) => {
    await runWithoutTenant(() => ClinicModel.updateOne({ _id: clinicId }, { $set: { 'settings.onlineBookingEnabled': true } }));
    if (await UserModel.exists({ email: DEMO_PATIENT_EMAIL })) return;
    await runInTenant(clinicId, async () => {
      const plan = await TreatmentPlanModel.findOne({ status: 'presented' }).select('patientId').lean();
      const patient = await PatientModel.findOne(plan ? { _id: plan.patientId } : { status: 'active' }).sort({ createdAt: 1 });
      if (!patient?.phone?.e164 || patient.userId) return;
      if (await UserModel.exists({ 'phone.e164': patient.phone.e164 })) return;
      const user = await UserModel.create({
        kind: 'patient',
        displayName: patient.fullName,
        email: DEMO_PATIENT_EMAIL,
        phone: patient.phone,
        locale: 'ar',
        passwordHash: await hashPassword('Password123!'),
        phoneVerifiedAt: new Date(),
        emailVerifiedAt: new Date(),
      });
      patient.userId = user._id;
      patient.familyGroupId ??= new Types.ObjectId();
      await patient.save();
      const name = { first: 'سلمى', family: patient.name?.family ?? 'حداد' };
      await PatientModel.create({
        fileNumber: await nextNumber('patient', 'P', { pad: 6 }),
        name,
        fullName: fullNameOf(name),
        searchName: toSearchName(fullNameOf(name)),
        gender: 'female',
        dateOfBirth: '2016-03-14',
        phone: patient.phone,
        guardian: { patientId: patient._id, name: patient.fullName, relation: 'guardian', phone: patient.phone.e164 },
        familyGroupId: patient.familyGroupId,
        status: 'active',
      });
      logger.info({ email: DEMO_PATIENT_EMAIL, file: patient.fileNumber }, 'demo portal patient');
    });
  },
});
