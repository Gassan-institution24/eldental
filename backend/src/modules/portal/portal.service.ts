import { Types } from 'mongoose';
import { isProd, env } from '@/config/env';
import { recordAudit } from '@/core/audit/audit.service';
import { nextNumber } from '@/core/db/sequence';
import { ApiError } from '@/core/http/ApiError';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { issueOtp, verifyOtp } from '@/modules/auth/otp.service';
import { publicUser } from '@/modules/auth/auth.service';
import { InvoiceModel, PaymentModel } from '@/modules/billing/billing.models';
import { dues, toInvoiceDto } from '@/modules/billing/invoice.service';
import { toPaymentDto } from '@/modules/billing/payment.service';
import { AppointmentTypeModel, ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import { TreatmentPlanModel } from '@/modules/clinical/clinical.models';
import { acceptPlan as acceptPlanSvc, planDto } from '@/modules/clinical/treatment.service';
import { sendOtpWhatsApp } from '@/modules/notifications/whatsapp.hooks';
import { PatientModel } from '@/modules/patients/patient.models';
import { fullNameOf } from '@/modules/patients/patient.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { AppointmentModel } from '@/modules/scheduling/scheduling.models';
import { BOOKABLE_TYPES, availability, bookOnline, cancelOnline } from '@/modules/scheduling/scheduling.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { UserModel } from '@/modules/users/user.model';
import { toSearchName } from '@/shared/validation/normalize';

/**
 * Patient portal (01 §4.10, 04 §6.4). A patient account owns the clinic files linked to it
 * (`patients.userId`) and manages their dependants (`guardian.patientId` → one of those files).
 * Every read and write is limited to those records, across clinics.
 */

const LIVE = { $in: ['active', 'inactive'] };
type Rel = 'self' | 'dependant';
type Mine = { _id: Types.ObjectId; clinicId: Types.ObjectId; fileNumber: string; fullName: string; dateOfBirth?: string | null; gender?: string | null; phone?: { e164?: string | null } | null; relation: Rel };

export async function myPatients(userId: string): Promise<Mine[]> {
  return runWithoutTenant(async () => {
    const fields = 'clinicId fileNumber fullName dateOfBirth gender phone';
    const selves = await PatientModel.find({ userId: new Types.ObjectId(userId), status: LIVE }).select(fields).lean();
    const deps = selves.length
      ? await PatientModel.find({ 'guardian.patientId': { $in: selves.map((s) => s._id) }, _id: { $nin: selves.map((s) => s._id) }, status: LIVE }).select(fields).lean()
      : [];
    return [...selves.map((p) => ({ ...p, relation: 'self' as const })), ...deps.map((p) => ({ ...p, relation: 'dependant' as const }))] as Mine[];
  });
}

/** The patient record if it belongs to this account; 404 otherwise (never reveal others). */
async function mine(userId: string, patientId: string | Types.ObjectId): Promise<Mine> {
  const p = (await myPatients(userId)).find((m) => m._id.equals(patientId));
  if (!p) throw ApiError.notFound();
  return p;
}

type ClinicLite = { _id: Types.ObjectId; name: string; slug: string; timezone?: string | null; settings?: { cancellationWindowHours?: number | null; onlineBookingEnabled?: boolean | null } | null };

async function clinicsById(ids: Types.ObjectId[]): Promise<Map<string, ClinicLite>> {
  const rows = await runWithoutTenant(() => ClinicModel.find({ _id: { $in: ids } }).select('name slug timezone settings.cancellationWindowHours settings.onlineBookingEnabled').lean());
  return new Map(rows.map((c) => [String(c._id), c as ClinicLite]));
}

const clinicRef = (c?: ClinicLite) => (c ? { id: String(c._id), name: c.name, slug: c.slug } : undefined);

async function clinicBySlugOr404(slug: string, opts: { online?: boolean } = {}) {
  const c = await runWithoutTenant(() => ClinicModel.findOne({ slug, status: 'active' }).lean());
  if (!c || (opts.online && !c.settings?.onlineBookingEnabled)) throw ApiError.notFound();
  return c;
}

/* ---------- me ---------- */

export async function me(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthenticated();
  const patients = await myPatients(userId);
  const clinics = await clinicsById([...new Set(patients.map((p) => String(p.clinicId)))].map((id) => new Types.ObjectId(id)));
  return {
    user: publicUser(user),
    clinics: [...clinics.values()].map((c) => ({ ...clinicRef(c)!, onlineBooking: Boolean(c.settings?.onlineBookingEnabled) })),
    patients: patients.map((p) => ({
      id: String(p._id),
      clinic: clinicRef(clinics.get(String(p.clinicId))),
      fileNumber: p.fileNumber,
      fullName: p.fullName,
      dateOfBirth: p.dateOfBirth ?? undefined,
      gender: p.gender ?? undefined,
      relation: p.relation,
    })),
  };
}

export async function updateMe(userId: string, b: { displayName?: string; email?: string; locale?: 'ar' | 'en' }) {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthenticated();
  if (b.email && b.email !== user.email && (await UserModel.exists({ email: b.email, _id: { $ne: user._id } }))) throw ApiError.validation([{ path: 'email', code: 'duplicate' }]);
  const before = publicUser(user);
  if (b.displayName) user.displayName = b.displayName;
  if (b.email !== undefined) user.set('email', b.email || undefined);
  if (b.locale) user.locale = b.locale;
  await user.save();
  await recordAudit({ action: 'update', entity: 'user', entityId: user._id, actorUserId: userId, clinicId: null, before, after: publicUser(user), summary: 'portal profile' });
  return me(userId);
}

/* ---------- public clinic pages + online availability ---------- */

export async function onlineClinics() {
  const rows = await runWithoutTenant(() => ClinicModel.find({ status: 'active', 'settings.onlineBookingEnabled': true }).select('name slug phone address.line1').sort({ name: 1 }).limit(200).lean());
  return rows.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug, phone: c.phone?.e164 ?? undefined, address: c.address?.line1 ?? undefined }));
}

/** Clinic page: online appointment types and dentists, and the booking rules patients see. */
export async function clinicPage(slug: string) {
  const c = await clinicBySlugOr404(slug, { online: true });
  return runInTenant(c._id, async () => {
    const [types, dentists] = await Promise.all([
      AppointmentTypeModel.find({ allowOnline: true, isActive: true }).select('name systemKey code defaultDurationMin color').sort({ defaultDurationMin: 1 }).lean(),
      StaffModel.find({ status: 'active', bookableOnline: true, staffType: { $in: BOOKABLE_TYPES } }).select('name color specialties primarySpecialty').sort({ name: 1 }).lean(),
    ]);
    return {
      id: String(c._id),
      slug: c.slug,
      name: c.name,
      phone: c.phone?.e164 ?? undefined,
      email: c.email ?? undefined,
      address: c.address?.line1 ?? undefined,
      timezone: c.timezone,
      currency: c.currency,
      rules: {
        cancellationWindowHours: c.settings?.cancellationWindowHours ?? 24,
        minOnlineLeadHours: c.settings?.minOnlineLeadHours ?? 2,
        maxOnlineDaysAhead: c.settings?.maxOnlineDaysAhead ?? 60,
      },
      appointmentTypes: types.map((t) => ({ id: String(t._id), name: t.name ?? undefined, systemKey: t.systemKey ?? undefined, code: t.code, durationMin: t.defaultDurationMin, color: t.color })),
      dentists: dentists.map((d) => ({ id: String(d._id), name: d.name, color: d.color, specialties: d.specialties ?? [], primarySpecialty: d.primarySpecialty ?? undefined })),
    };
  });
}

export async function onlineAvailability(slug: string, q: { appointmentTypeId: string; dentistId?: string; from: string; to: string }) {
  const c = await clinicBySlugOr404(slug, { online: true });
  return runInTenant(c._id, () => availability(null, { ...q, online: true }));
}

/* ---------- link an existing clinic file (OTP to the phone on file) ---------- */

async function fileFor(slug: string, fileNumber: string) {
  const c = await clinicBySlugOr404(slug);
  const p = await runInTenant(c._id, () => PatientModel.findOne({ fileNumber, status: LIVE }).select('phone userId fileNumber').lean());
  if (!p?.phone?.e164) throw ApiError.validation([{ path: 'fileNumber', code: 'not_found' }]);
  return { clinic: c, patient: p as typeof p & { phone: { e164: string } } };
}

export async function linkStart(userId: string, b: { clinicSlug: string; fileNumber: string }, locale: 'ar' | 'en') {
  const { patient } = await fileFor(b.clinicSlug, b.fileNumber);
  if (patient.userId && String(patient.userId) !== userId) throw ApiError.conflict('PATIENT_ALREADY_LINKED', 'This file is linked to another account');
  const phone = patient.phone.e164;
  const issued = await issueOtp(phone, 'link_patient');
  if (!('code' in issued)) throw new ApiError(429, 'OTP_COOLDOWN', 'Wait before requesting another code', { seconds: issued.cooldown });
  await sendOtpWhatsApp(phone, locale, issued.code);
  // Development has no WhatsApp provider: hand the code back so the flow can be tried.
  return { phoneHint: `•••• ${phone.slice(-4)}`, expiresInMinutes: env.OTP_TTL_MINUTES, ...(isProd ? {} : { devCode: issued.code }) };
}

export async function linkConfirm(userId: string, b: { clinicSlug: string; fileNumber: string; code: string }) {
  const { clinic, patient } = await fileFor(b.clinicSlug, b.fileNumber);
  if (patient.userId && String(patient.userId) !== userId) throw ApiError.conflict('PATIENT_ALREADY_LINKED', 'This file is linked to another account');
  await verifyOtp(patient.phone.e164, 'link_patient', b.code);
  await runInTenant(clinic._id, async () => {
    await PatientModel.updateOne({ _id: patient._id }, { $set: { userId: new Types.ObjectId(userId) } });
    await recordAudit({ action: 'update', entity: 'patient', entityId: patient._id, actorUserId: userId, summary: 'portal account linked', after: { patientId: String(patient._id) } });
  });
  return me(userId);
}

/* ---------- dependants (guardian manages child profiles) ---------- */

export async function addDependant(userId: string, b: { guardianPatientId: string; first: string; family: string; dateOfBirth: string; gender: 'male' | 'female' }) {
  const g = await mine(userId, b.guardianPatientId);
  if (g.relation !== 'self') throw ApiError.notFound();
  await runInTenant(g.clinicId, async () => {
    const guardian = await PatientModel.findById(g._id).select('familyGroupId fullName phone');
    if (!guardian) throw ApiError.notFound();
    if (!guardian.familyGroupId) {
      guardian.familyGroupId = new Types.ObjectId();
      await PatientModel.updateOne({ _id: guardian._id }, { $set: { familyGroupId: guardian.familyGroupId } });
    }
    const name = { first: b.first, family: b.family };
    const prefix = (await runWithoutTenant(() => ClinicModel.findById(g.clinicId).select('settings.numbering.patient').lean()))?.settings?.numbering?.patient ?? 'P';
    const p = await PatientModel.create({
      fileNumber: await nextNumber('patient', prefix, { pad: 6 }),
      name,
      fullName: fullNameOf(name),
      searchName: toSearchName(fullNameOf(name)),
      gender: b.gender,
      dateOfBirth: b.dateOfBirth,
      ...(guardian.phone?.e164 ? { phone: guardian.phone } : {}),
      guardian: { patientId: guardian._id, name: guardian.fullName, relation: 'guardian', phone: guardian.phone?.e164 ?? '' },
      familyGroupId: guardian.familyGroupId,
      status: 'active',
    });
    await recordAudit({ action: 'create', entity: 'patient', entityId: p._id, actorUserId: userId, summary: 'dependant added from the portal', after: { fileNumber: p.fileNumber } });
  });
  return me(userId);
}

/* ---------- appointments ---------- */

type ApptRaw = { _id: Types.ObjectId; clinicId: Types.ObjectId; patientId?: Types.ObjectId | null; number?: string | null; start: Date; end: Date; status: string; dentistId: Types.ObjectId; appointmentTypeId?: Types.ObjectId | null; source?: string | null; patientNotes?: string | null };

async function appointmentDtos(rows: ApptRaw[], patients: Mine[]) {
  const [clinics, types, dentists] = await Promise.all([
    clinicsById(rows.map((r) => r.clinicId)),
    runWithoutTenant(() => AppointmentTypeModel.find({ _id: { $in: rows.map((r) => r.appointmentTypeId).filter(Boolean) } }).select('name systemKey code color').lean()),
    runWithoutTenant(() => StaffModel.find({ _id: { $in: rows.map((r) => r.dentistId) } }).select('name').lean()),
  ]);
  const typeById = new Map(types.map((t) => [String(t._id), t]));
  const dentistById = new Map(dentists.map((d) => [String(d._id), d.name]));
  const patientById = new Map(patients.map((p) => [String(p._id), p]));
  const now = Date.now();
  return rows.map((a) => {
    const clinic = clinics.get(String(a.clinicId));
    const windowH = clinic?.settings?.cancellationWindowHours ?? 24;
    const type = a.appointmentTypeId ? typeById.get(String(a.appointmentTypeId)) : undefined;
    const active = ['scheduled', 'confirmed'].includes(a.status);
    const cancelBy = new Date(a.start.getTime() - windowH * 3_600_000);
    return {
      id: String(a._id),
      number: a.number ?? '',
      clinic: clinicRef(clinic),
      patient: a.patientId ? { id: String(a.patientId), fullName: patientById.get(String(a.patientId))?.fullName ?? '' } : undefined,
      start: a.start,
      end: a.end,
      status: a.status,
      upcoming: active && a.start.getTime() > now,
      dentist: { id: String(a.dentistId), name: dentistById.get(String(a.dentistId)) ?? '' },
      appointmentType: type ? { name: type.name ?? undefined, systemKey: type.systemKey ?? undefined, code: type.code, color: type.color } : undefined,
      online: a.source === 'online',
      notes: a.patientNotes ?? '',
      canCancel: active && now < cancelBy.getTime(),
      cancelBy,
      cancellationWindowHours: windowH,
    };
  });
}

export async function appointments(userId: string) {
  const patients = await myPatients(userId);
  if (!patients.length) return [];
  const rows = await runWithoutTenant(() => AppointmentModel.find({ patientId: { $in: patients.map((p) => p._id) } }).sort({ start: -1 }).limit(200).lean());
  return appointmentDtos(rows as ApptRaw[], patients);
}

/** Books for a file of this account at the clinic; with no file there yet, one is opened for the account holder. */
export async function book(userId: string, b: { clinicSlug: string; patientId?: string; appointmentTypeId: string; dentistId: string; start: Date; notes?: string }) {
  const clinic = await clinicBySlugOr404(b.clinicSlug, { online: true });
  const patients = await myPatients(userId);
  let patient = b.patientId ? patients.find((p) => p._id.equals(b.patientId!)) : patients.find((p) => p.relation === 'self' && p.clinicId.equals(clinic._id));
  if (b.patientId && !patient) throw ApiError.notFound();
  if (patient && !patient.clinicId.equals(clinic._id)) throw ApiError.validation([{ path: 'patientId', code: 'invalid' }]);
  if (!patient) patient = await openFileFor(userId, clinic._id);
  const created = await runInTenant(clinic._id, () => bookOnline({ patientId: String(patient._id), dentistId: b.dentistId, appointmentTypeId: b.appointmentTypeId, start: b.start, patientNotes: b.notes, userId }));
  const [dto] = await appointmentDtos([created as unknown as ApptRaw], [patient]);
  return dto!;
}

/** First online booking at a clinic: a new file from the verified account (name + phone). */
async function openFileFor(userId: string, clinicId: Types.ObjectId): Promise<Mine> {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw ApiError.unauthenticated();
  const [first = user.displayName, ...rest] = user.displayName.trim().split(/\s+/);
  const name = { first, family: rest.join(' ') || first };
  return runInTenant(clinicId, async () => {
    const prefix = (await runWithoutTenant(() => ClinicModel.findById(clinicId).select('settings.numbering.patient').lean()))?.settings?.numbering?.patient ?? 'P';
    const p = await PatientModel.create({
      fileNumber: await nextNumber('patient', prefix, { pad: 6 }),
      userId: user._id,
      name,
      fullName: fullNameOf(name),
      searchName: toSearchName(fullNameOf(name)),
      ...(user.phone?.e164 ? { phone: user.phone } : {}),
      ...(user.email ? { email: user.email } : {}),
      preferredLanguage: user.locale === 'en' ? 'en' : 'ar',
      referralSource: 'online booking',
      status: 'active',
    });
    await recordAudit({ action: 'create', entity: 'patient', entityId: p._id, actorUserId: userId, summary: 'registered by online booking', after: { fileNumber: p.fileNumber } });
    return { _id: p._id, clinicId, fileNumber: p.fileNumber, fullName: p.fullName, phone: p.phone, relation: 'self' as const };
  });
}

export async function cancel(userId: string, appointmentId: string, comment?: string) {
  const patients = await myPatients(userId);
  const appt = await runWithoutTenant(() => AppointmentModel.findOne({ _id: appointmentId, patientId: { $in: patients.map((p) => p._id) } }).select('clinicId').lean());
  if (!appt) throw ApiError.notFound();
  const done = await runInTenant(appt.clinicId, () => cancelOnline(appointmentId, patients.map((p) => p._id), userId, comment));
  const [dto] = await appointmentDtos([done as unknown as ApptRaw], patients);
  return dto!;
}

/* ---------- treatment plans ---------- */

/** Plans the clinic has shared: drafts stay internal, cancelled ones are hidden. */
const SHARED_PLANS = { $in: ['presented', 'accepted', 'partially_accepted', 'rejected', 'in_progress', 'completed'] };

export async function plans(userId: string) {
  const patients = await myPatients(userId);
  if (!patients.length) return [];
  const rows = await runWithoutTenant(() => TreatmentPlanModel.find({ patientId: { $in: patients.map((p) => p._id) }, status: SHARED_PLANS }).sort({ createdAt: -1 }).limit(100).lean());
  const [clinics, procs, dentists] = await Promise.all([
    clinicsById(rows.map((r) => r.clinicId)),
    runWithoutTenant(() => ClinicProcedureModel.find({ _id: { $in: rows.flatMap((r) => r.items.map((i) => i.clinicProcedureId)) } }).select('name systemKey code').lean()),
    runWithoutTenant(() => StaffModel.find({ _id: { $in: rows.map((r) => r.dentistId) } }).select('name').lean()),
  ]);
  const procById = new Map(procs.map((p) => [String(p._id), p]));
  const dentistById = new Map(dentists.map((d) => [String(d._id), d.name]));
  const patientById = new Map(patients.map((p) => [String(p._id), p.fullName]));
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const dto = planDto(r as never);
    const expired = Boolean(dto.validUntil && String(dto.validUntil) < today);
    return {
      id: dto.id,
      number: dto.number,
      title: dto.title,
      status: dto.status,
      clinic: clinicRef(clinics.get(String(r.clinicId))),
      patient: { id: dto.patientId, fullName: patientById.get(dto.patientId) ?? '' },
      dentist: dentistById.get(dto.dentistId) ?? '',
      phases: dto.phases,
      items: dto.items.map((i) => {
        const proc = procById.get(i.clinicProcedureId);
        return { id: i.id, phaseIndex: i.phaseIndex, code: i.code, name: proc?.name ?? undefined, systemKey: proc?.systemKey ?? undefined, toothNumbers: i.toothNumbers, surfaces: i.surfaces, quantity: i.quantity, insuranceEstimate: i.insuranceEstimate, patientEstimate: i.patientEstimate, status: i.status };
      }),
      totals: dto.totals,
      presentedAt: dto.presentedAt,
      validUntil: dto.validUntil,
      acceptance: dto.acceptance ? { at: (dto.acceptance as { at?: Date }).at, signerName: (dto.acceptance as { signerName?: string }).signerName } : undefined,
      notes: dto.notes,
      canAccept: dto.status === 'presented' && !expired,
      expired,
    };
  });
}

export async function acceptPlan(userId: string, planId: string, b: { itemIds?: string[]; signature: string; signerName: string }, ip?: string) {
  const patients = await myPatients(userId);
  const plan = await runWithoutTenant(() => TreatmentPlanModel.findOne({ _id: planId, patientId: { $in: patients.map((p) => p._id) }, status: SHARED_PLANS }).select('clinicId status validUntil items._id').lean());
  if (!plan) throw ApiError.notFound();
  if (plan.status !== 'presented') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'This plan is not waiting for your approval');
  if (plan.validUntil && String(plan.validUntil) < new Date().toISOString().slice(0, 10)) throw ApiError.conflict('PLAN_EXPIRED', 'This plan has expired, please contact the clinic');
  const known = new Set(plan.items.map((i) => String(i._id)));
  if (b.itemIds?.some((id) => !known.has(id))) throw ApiError.validation([{ path: 'itemIds', code: 'invalid' }]);
  await runInTenant(plan.clinicId, () => acceptPlanSvc(null, planId, { ...b, byPatient: true, ...(ip ? { ip } : {}) }));
  return (await plans(userId)).find((p) => p.id === planId)!;
}

/* ---------- invoices, payments and their printable versions ---------- */

export async function billing(userId: string) {
  const patients = await myPatients(userId);
  if (!patients.length) return { invoices: [], payments: [], balances: [] };
  const ids = patients.map((p) => p._id);
  const [invoices, payments, balances] = await runWithoutTenant(() =>
    Promise.all([
      InvoiceModel.find({ patientId: { $in: ids }, status: { $ne: 'draft' } }).sort({ issueDate: -1, createdAt: -1 }).limit(200).lean(),
      PaymentModel.find({ patientId: { $in: ids }, status: { $ne: 'void' } }).sort({ receivedAt: -1 }).limit(200).lean(),
      PatientModel.find({ _id: { $in: ids } }).select('balance clinicId fullName').lean(),
    ]),
  );
  const clinics = await clinicsById([...invoices, ...payments, ...balances].map((r) => r.clinicId as Types.ObjectId));
  const name = new Map(patients.map((p) => [String(p._id), p.fullName]));
  return {
    invoices: invoices.map((i) => {
      const d = dues(i);
      return {
        id: String(i._id),
        number: i.number ?? '',
        type: i.type,
        status: i.status,
        issueDate: i.issueDate ?? undefined,
        dueDate: i.dueDate ?? undefined,
        total: i.total ?? 0,
        patientTotal: i.patientTotal ?? i.total ?? 0,
        insuranceTotal: i.insuranceTotal ?? 0,
        patientDue: d.patientDue,
        clinic: clinicRef(clinics.get(String(i.clinicId))),
        patient: { id: String(i.patientId), fullName: name.get(String(i.patientId)) ?? '' },
      };
    }),
    payments: payments.map((p) => ({
      id: String(p._id),
      number: p.number,
      receiptNumber: p.receiptNumber ?? undefined,
      date: p.date,
      amount: p.amount,
      method: p.method,
      status: p.status,
      clinic: clinicRef(clinics.get(String(p.clinicId))),
      patient: p.patientId ? { id: String(p.patientId), fullName: name.get(String(p.patientId)) ?? '' } : undefined,
    })),
    balances: balances.map((b) => ({ patient: { id: String(b._id), fullName: b.fullName }, clinic: clinicRef(clinics.get(String(b.clinicId))), balance: b.balance ?? 0 })),
  };
}

/** Same shape as the clinic's `/invoices/:id/print`, for the shared print dialog. */
export async function invoicePrint(userId: string, invoiceId: string) {
  const patients = await myPatients(userId);
  const inv = await runWithoutTenant(() => InvoiceModel.findOne({ _id: invoiceId, patientId: { $in: patients.map((p) => p._id) }, status: { $ne: 'draft' } }).lean());
  if (!inv) throw ApiError.notFound();
  const patient = patients.find((p) => p._id.equals(inv.patientId))!;
  const dentistIds = [inv.dentistId, ...(inv.lines ?? []).map((l) => l.dentistId)].filter(Boolean);
  const [clinic, staff] = await Promise.all([
    runWithoutTenant(() => ClinicModel.findById(inv.clinicId).select('name phone email addressLine1 taxNumber commercialRegNo settings.invoiceFooter currency').lean()),
    runWithoutTenant(() => StaffModel.find({ _id: { $in: dentistIds } }).select('name').lean()),
  ]);
  const names = new Map(staff.map((s) => [String(s._id), s.name]));
  return { invoice: toInvoiceDto(inv as never, patient, names), clinic, patient: { fullName: patient.fullName, fileNumber: patient.fileNumber, phone: patient.phone?.e164 ?? undefined } };
}

/** Same shape as the clinic's `/payments/:id/receipt`. */
export async function receipt(userId: string, paymentId: string) {
  const patients = await myPatients(userId);
  const p = await runWithoutTenant(() => PaymentModel.findOne({ _id: paymentId, patientId: { $in: patients.map((x) => x._id) } }).lean());
  if (!p) throw ApiError.notFound();
  const patient = patients.find((x) => x._id.equals(p.patientId!))!;
  const [clinic, invoices, bal] = await Promise.all([
    runWithoutTenant(() => ClinicModel.findById(p.clinicId).select('name phone addressLine1 taxNumber currency').lean()),
    runWithoutTenant(() => InvoiceModel.find({ _id: { $in: (p.allocations ?? []).map((a) => a.invoiceId) } }).select('number').lean()),
    runWithoutTenant(() => PatientModel.findById(p.patientId).select('balance').lean()),
  ]);
  const payment = toPaymentDto(p as never, { patient, invoices: new Map(invoices.map((i) => [String(i._id), i.number ?? ''])) });
  return { payment, clinic, balanceAfter: bal?.balance ?? null };
}
