import { requestContext } from '@/core/context/requestContext';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import type { AuthContext } from '@/core/auth/auth.types';
import { ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { StaffModel } from '@/modules/staff/staff.model';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { addEntry } from './chart.service';
import { ToothChartModel } from './clinical.models';
import { createPlan, performProcedure, presentPlan } from './treatment.service';

/** Demo clinic: a few charts with findings, a presented plan and some completed work. */
registerDemoSeeder({
  name: 'clinical.demo',
  order: 40,
  run: async (clinicId) => {
    await runInTenant(clinicId, async () => {
      if ((await ToothChartModel.countDocuments({})) > 0) return;
      const dentist = await StaffModel.findOne({ staffType: 'dentist', status: 'active' }).sort({ createdAt: 1 }).lean();
      const owner = await StaffModel.findOne({ isOwner: true }).lean();
      const patients = await PatientModel.find({ status: 'active' }).sort({ createdAt: 1 }).limit(4).lean();
      const proc = async (code: string) => (await ClinicProcedureModel.findOne({ code }).select('_id').lean())?._id;
      if (!dentist || !patients.length) return;
      // Seed as the owner acting for the dentist, so own-scope rules don't get in the way.
      const auth = { userId: String(owner?.userId ?? dentist.userId), staffId: String(dentist._id), clinicId, kind: 'staff', isOwner: true, isRoot: false, permVersion: 0, readOnly: false, grants: {}, tokenId: 'seed' } as AuthContext;
      await requestContext.run({ clinicId, userId: auth.userId, staffId: auth.staffId }, async () => {
        const [p1, p2, p3] = patients;
        if (p1) {
          await addEntry(auth, p1._id, { toothNumber: 36, surfaces: ['M', 'O'], kind: 'finding', conditionCode: 'caries' });
          await addEntry(auth, p1._id, { toothNumber: 16, kind: 'existing', conditionCode: 'crown' });
          await addEntry(auth, p1._id, { toothNumber: 48, kind: 'existing', setStatus: 'missing' });
          const filling = await proc('D2391');
          const rct = await proc('D3330');
          if (filling && rct) {
            const plan = await createPlan(auth, { patientId: String(p1._id), title: '', items: [{ clinicProcedureId: String(filling), toothNumbers: [36], surfaces: ['M', 'O'] }, { clinicProcedureId: String(rct), toothNumbers: [46] }] });
            await presentPlan(auth, plan.id);
          }
        }
        const prophy = await proc('D1110');
        if (p2 && prophy) await performProcedure(auth, { patientId: String(p2._id), clinicProcedureId: String(prophy) });
        const ext = await proc('D7140');
        if (p3 && ext) {
          await addEntry(auth, p3._id, { toothNumber: 26, surfaces: ['O'], kind: 'finding', conditionCode: 'filling' });
          await performProcedure(auth, { patientId: String(p3._id), clinicProcedureId: String(ext), toothNumbers: [38] });
        }
      });
    });
  },
});
