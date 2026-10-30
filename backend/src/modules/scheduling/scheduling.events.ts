import { logger } from '@/config/logger';
import { on } from '@/core/events/bus';
import { defineJob, defineRepeatable, enqueue, removeJob } from '@/core/jobs/queue';
import { queueEmail, layout } from '@/core/notifications/email/email.service';
import { tr, type Lang } from '@/core/i18n/messages';
import { broadcastToClinic } from '@/core/realtime/socket';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { PatientModel } from '@/modules/patients/patient.models';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { addDays, localDate, localTime } from '@/shared/dates';
import { waitlistMatches } from './planning.service';
import { AppointmentModel, RecallModel, WaitingListModel } from './scheduling.models';

/** Side effects of scheduling events (06 §3, §5): sockets, reminders, recall/waitlist links. */

const HOUR = 3_600_000;
const reminderJobId = (id: string, h: number) => `appt:${id}:${h}h`;

async function planReminders(clinicId: string, appointmentId: string): Promise<void> {
  const [clinic, appt] = await Promise.all([
    runWithoutTenant(() => ClinicModel.findById(clinicId).select('settings.reminderHours').lean()),
    runInTenant(clinicId, () => AppointmentModel.findById(appointmentId).select('start status').lean()),
  ]);
  const hours = clinic?.settings?.reminderHours ?? [24, 2];
  for (const h of hours) await removeJob('reminders', reminderJobId(appointmentId, h));
  if (!appt || !['scheduled', 'confirmed'].includes(appt.status)) return;
  for (const h of hours) {
    const delay = appt.start.getTime() - h * HOUR - Date.now();
    if (delay > 0) await enqueue('reminders', 'appointment.reminder', { clinicId, appointmentId, hours: h }, { delay, jobId: reminderJobId(appointmentId, h) });
  }
}

type MailKind = 'booked' | 'rescheduled' | 'cancelled' | 'reminder';

/** Patient message by email (WhatsApp is added by the notifications module when configured). */
async function notifyPatient(clinicId: string, appointmentId: string, kind: MailKind): Promise<void> {
  await runInTenant(clinicId, async () => {
    const appt = await AppointmentModel.findById(appointmentId).lean();
    if (!appt) return;
    const [patient, dentist, clinic] = await Promise.all([
      PatientModel.findById(appt.patientId).select('email preferredLanguage communicationPrefs').lean(),
      StaffModel.findById(appt.dentistId).select('name').lean(),
      runWithoutTenant(() => ClinicModel.findById(clinicId).select('name timezone').lean()),
    ]);
    const prefs = (patient?.communicationPrefs ?? {}) as { email?: boolean; reminders?: boolean };
    if (!patient?.email || prefs.email === false || (kind === 'reminder' && prefs.reminders === false)) return;
    const lang = (patient.preferredLanguage ?? 'ar') as Lang;
    const tz = clinic?.timezone ?? 'Asia/Amman';
    const p = { clinic: clinic?.name ?? '', dentist: dentist?.name ?? '', date: localDate(appt.start, tz), time: localTime(appt.start, tz) };
    const subject = tr(lang, `email.${kind}.subject`, p);
    await queueEmail({ to: patient.email, lang, subject, ...layout(lang, { title: subject, paragraphs: [tr(lang, `email.${kind}.body`, p)] }) });
  });
}

const changed = (clinicId: string, appointmentId: string, kind: string) => broadcastToClinic(clinicId, 'appointment:changed', { id: appointmentId, kind });

on('appointment.booked', async ({ clinicId, appointmentId }) => {
  changed(clinicId, appointmentId, 'booked');
  const appt = await runInTenant(clinicId, () => AppointmentModel.findById(appointmentId).select('recallId waitlistId').lean());
  if (appt?.recallId) await runInTenant(clinicId, () => RecallModel.updateOne({ _id: appt.recallId }, { $set: { status: 'booked', appointmentId } }));
  if (appt?.waitlistId) await runInTenant(clinicId, () => WaitingListModel.updateOne({ _id: appt.waitlistId }, { $set: { status: 'booked', appointmentId } }));
  await planReminders(clinicId, appointmentId);
  await notifyPatient(clinicId, appointmentId, 'booked');
});

on('appointment.rescheduled', async ({ clinicId, appointmentId }) => {
  changed(clinicId, appointmentId, 'rescheduled');
  await planReminders(clinicId, appointmentId);
  await notifyPatient(clinicId, appointmentId, 'rescheduled');
});

on('appointment.statusChanged', async ({ clinicId, appointmentId, to }) => {
  changed(clinicId, appointmentId, to);
  if (to === 'cancelled' || to === 'no_show') await planReminders(clinicId, appointmentId);
});

on('appointment.cancelled', async ({ clinicId, appointmentId }) => {
  await notifyPatient(clinicId, appointmentId, 'cancelled');
  // Tell reception about waiting-list patients who fit the freed time (06 §6).
  const result = await runInTenant(clinicId, async () => {
    const appt = await AppointmentModel.findById(appointmentId).select('dentistId start').lean();
    const clinic = await runWithoutTenant(() => ClinicModel.findById(clinicId).select('timezone').lean());
    return appt ? waitlistMatches({ dentistId: String(appt.dentistId), start: appt.start }, clinic?.timezone ?? 'Asia/Amman') : [];
  });
  if (result.length) broadcastToClinic(clinicId, 'waitlist:match', { appointmentId, entryIds: result.map((w) => String(w._id)) });
});

defineJob('reminders', 'appointment.reminder', async (data) => {
  const clinicId = String(data.clinicId);
  const appointmentId = String(data.appointmentId);
  const appt = await runInTenant(clinicId, () => AppointmentModel.findById(appointmentId).select('status').lean());
  if (!appt || !['scheduled', 'confirmed'].includes(appt.status)) return;
  await notifyPatient(clinicId, appointmentId, 'reminder');
  await runInTenant(clinicId, () => AppointmentModel.updateOne({ _id: appointmentId }, { $set: { [Number(data.hours) >= 24 ? 'reminders.sent24hAt' : 'reminders.sent2hAt']: new Date() } }));
});

/** Daily: recalls within 14 days become `due` (06 §7). */
defineJob('recalls', 'recalls.markDue', async () => {
  const clinics = await runWithoutTenant(() => ClinicModel.find({ status: { $ne: 'deleted' } }).select('timezone').lean());
  for (const c of clinics) {
    const soon = addDays(localDate(new Date(), c.timezone ?? 'Asia/Amman'), 14);
    const r = await runInTenant(c._id, () => RecallModel.updateMany({ status: 'upcoming', dueDate: { $lte: soon } }, { $set: { status: 'due' } }));
    if (r.modifiedCount) logger.info({ clinicId: String(c._id), count: r.modifiedCount }, 'recalls due');
  }
});
defineRepeatable('recalls', 'recalls.markDue', { pattern: '0 6 * * *', tz: 'Asia/Amman' });
