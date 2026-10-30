import { Types } from 'mongoose';
import { nextNumber } from '@/core/db/sequence';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { AppointmentTypeModel, ChairModel } from '@/modules/clinic/clinic.models';
import { PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { addDays, atLocal, localDate } from '@/shared/dates';
import { AppointmentModel, DentistScheduleModel, RecallModel, SlotLockModel, WaitingListModel } from './scheduling.models';

const WEEK = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, blocks: [{ start: '09:00', end: '13:00' }, { start: '14:00', end: '18:00' }] }));
const SATURDAY = { weekday: 6, blocks: [{ start: '10:00', end: '14:00' }] };

/** Demo clinic: weekly schedules for every dentist and a realistic week of appointments. */
registerDemoSeeder({
  name: 'scheduling.demo',
  order: 30,
  run: async (clinicId) => {
    const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('timezone').lean());
    const tz = clinic?.timezone ?? 'Asia/Amman';
    await runInTenant(clinicId, async () => {
      if ((await DentistScheduleModel.countDocuments({})) > 0) return;
      const [dentists, chairs, types, patients] = await Promise.all([
        StaffModel.find({ staffType: { $in: ['dentist', 'hygienist'] }, status: 'active' }).sort({ createdAt: 1 }).lean(),
        ChairModel.find({ isActive: true }).sort({ sortOrder: 1 }).lean(),
        AppointmentTypeModel.find({}).lean(),
        PatientModel.find({ status: 'active' }).sort({ createdAt: 1 }).lean(),
      ]);
      const today = localDate(new Date(), tz);
      for (const [i, d] of dentists.entries()) {
        const chair = chairs[i % Math.max(chairs.length, 1)];
        await StaffModel.updateOne({ _id: d._id }, { $set: { bookableOnline: true, ...(chair ? { defaultChairId: chair._id } : {}) } });
        await DentistScheduleModel.create({
          staffId: d._id,
          effectiveFrom: addDays(today, -30),
          slotGranularityMin: 15,
          weekly: [...WEEK, SATURDAY].map((w) => ({ weekday: w.weekday, blocks: w.blocks.map((b) => ({ ...b, ...(chair ? { chairId: chair._id } : {}), onlineBookable: true })) })),
        });
      }
      if (!patients.length || !dentists.length) return;

      // Today and the next few days: a mix of statuses so the board and calendar look alive.
      const plan: { day: number; time: string; status: string; type?: string }[] = [
        { day: 0, time: '09:00', status: 'completed', type: 'exam' },
        { day: 0, time: '10:00', status: 'in_chair', type: 'filling' },
        { day: 0, time: '11:00', status: 'arrived', type: 'cleaning' },
        { day: 0, time: '12:00', status: 'confirmed', type: 'consultation' },
        { day: 0, time: '14:30', status: 'scheduled', type: 'root_canal' },
        { day: 0, time: '16:00', status: 'scheduled', type: 'exam' },
        { day: 1, time: '09:30', status: 'confirmed', type: 'cleaning' },
        { day: 1, time: '11:00', status: 'scheduled', type: 'extraction' },
        { day: 2, time: '10:00', status: 'scheduled', type: 'ortho' },
        { day: 3, time: '15:00', status: 'scheduled', type: 'crown' },
        { day: -1, time: '10:00', status: 'completed', type: 'exam' },
        { day: -1, time: '12:00', status: 'no_show', type: 'cleaning' },
      ];
      const byKey = new Map(types.map((t) => [t.systemKey ?? '', t]));
      let n = 0;
      for (const [di, d] of dentists.slice(0, 2).entries()) {
        for (const p of plan) {
          const date = addDays(today, p.day);
          const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
          if (weekday === 5) continue;
          const type = byKey.get(p.type ?? '') ?? types[0];
          const start = atLocal(date, p.time, tz);
          const end = new Date(start.getTime() + (type?.defaultDurationMin ?? 30) * 60_000);
          const patient = patients[(n + di * 5) % patients.length]!;
          n += 1;
          const chair = chairs[di % Math.max(chairs.length, 1)];
          const id = new Types.ObjectId();
          const at = new Date(start.getTime() - 86_400_000);
          await AppointmentModel.create({
            _id: id,
            number: await nextNumber('appointment', 'APT'),
            patientId: patient._id,
            dentistId: d._id,
            chairId: chair?._id,
            appointmentTypeId: type?._id,
            start,
            end,
            status: p.status,
            statusHistory: [{ to: 'scheduled', at }, ...(p.status !== 'scheduled' ? [{ from: 'scheduled', to: p.status, at: start }] : [])],
            ...(['arrived', 'in_chair', 'completed'].includes(p.status) ? { checkInAt: new Date(start.getTime() - 10 * 60_000) } : {}),
            ...(['in_chair', 'completed'].includes(p.status) ? { seatedAt: start } : {}),
            ...(p.status === 'completed' ? { completedAt: end, noProceduresReason: 'demo' } : {}),
          });
          if (p.status !== 'no_show') {
            const locks = [];
            for (let t = start.getTime(); t < end.getTime(); t += 5 * 60_000) {
              locks.push({ resourceType: 'dentist', resourceId: d._id, bucketStart: new Date(t), appointmentId: id });
              if (chair) locks.push({ resourceType: 'chair', resourceId: chair._id, bucketStart: new Date(t), appointmentId: id });
            }
            await SlotLockModel.insertMany(locks.map((l) => ({ ...l, clinicId })));
          }
        }
      }

      // A few recalls and waiting-list entries.
      for (const [i, p] of patients.slice(0, 5).entries()) {
        await RecallModel.create({ patientId: p._id, type: i % 2 ? 'checkup' : 'cleaning', dueDate: addDays(today, i * 7 - 10), status: i * 7 - 10 <= 14 ? 'due' : 'upcoming', dentistId: dentists[0]?._id });
      }
      for (const [i, p] of patients.slice(6, 9).entries()) {
        await WaitingListModel.create({ patientId: p._id, dentistId: dentists[i % dentists.length]?._id, preferredDays: [0, 1, 2], priority: i === 0 ? 'high' : 'normal', notes: '' });
      }
    });
  },
});
