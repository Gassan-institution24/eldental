import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { asyncHandler } from '@/core/http/asyncHandler';
import { ApiError } from '@/core/http/ApiError';
import { created, ok } from '@/core/http/response';
import { registerPath } from '@/core/openapi/registry';
import { authorize, scopeFor } from '@/core/rbac/authorize';
import { currentClinicId, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { body, params, validate } from '@/core/validation/validate';
import { registerTimelineSource } from '@/modules/patients/patient.routes';
import { loadScopedPatient, onPatientMerge } from '@/modules/patients/patient.service';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { AppointmentModel } from '@/modules/scheduling/scheduling.models';
import { StaffModel } from '@/modules/staff/staff.model';
import { certificateBody, certificateDays, certificateVoidBody } from '@/shared/patients';
import { objectId } from '@/shared/validation/fields';
import { CertificateModel } from './certificate.model';

/** Medical certificates: sick leave, medical report, attendance (07 §14). Immutable; void only. */
export const certificateRouter = Router();

const idParams = z.object({ id: objectId() });
const issueBody = certificateBody();
const voidBody = certificateVoidBody();

type CertDoc = {
  _id: Types.ObjectId;
  number: string;
  patientId: Types.ObjectId;
  type: string;
  dentistId: Types.ObjectId;
  appointmentId?: Types.ObjectId | null;
  from: string;
  to: string;
  days: number;
  diagnosis?: string;
  body: string;
  recommendations?: string;
  issuedAt: Date;
  status: 'issued' | 'void';
  voidReason?: string;
  voidedAt?: Date;
  printedAt?: Date;
};

export function certificateDto(c: CertDoc, dentistName?: string) {
  return {
    id: String(c._id),
    number: c.number,
    patientId: String(c.patientId),
    type: c.type,
    dentistId: String(c.dentistId),
    dentistName,
    appointmentId: c.appointmentId ? String(c.appointmentId) : undefined,
    from: c.from,
    to: c.to,
    days: c.days,
    diagnosis: c.diagnosis || undefined,
    body: c.body,
    recommendations: c.recommendations || undefined,
    issuedAt: c.issuedAt,
    status: c.status,
    voidReason: c.voidReason,
    voidedAt: c.voidedAt,
  };
}

/** Everything the letterhead print needs; shared with the patient portal. */
export async function certificatePrintData(c: CertDoc, patient: { fullName: string; fileNumber: string; dateOfBirth?: string | null; gender?: string | null }) {
  const [dentist, clinic] = await Promise.all([
    StaffModel.findById(c.dentistId).select('name licenseNumber primarySpecialty specialties signatureFileId stampFileId').lean(),
    runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name phone email address logoFileId').lean()),
  ]);
  return {
    certificate: certificateDto(c, dentist?.name as string | undefined),
    patient: { fullName: patient.fullName, fileNumber: patient.fileNumber, dateOfBirth: patient.dateOfBirth ?? undefined, gender: patient.gender ?? undefined },
    dentist: dentist
      ? {
          name: dentist.name as string,
          licenseNumber: (dentist.licenseNumber as string | undefined) ?? undefined,
          primarySpecialty: (dentist.primarySpecialty as string | undefined) ?? undefined,
          signatureFileId: dentist.signatureFileId ? String(dentist.signatureFileId) : undefined,
          stampFileId: dentist.stampFileId ? String(dentist.stampFileId) : undefined,
        }
      : null,
    clinic: clinic ? { name: clinic.name, phone: clinic.phone?.e164 ?? undefined, email: clinic.email ?? undefined, addressLine1: clinic.address?.line1 ?? undefined } : null,
  };
}

/** `own` = certificates I issued, for patients in my patient scope. */
const ownFilter = (auth: AuthContext, perm: string) => (scopeFor(auth, perm) === 'own' && auth.staffId ? { dentistId: new Types.ObjectId(auth.staffId) } : {});

async function names(list: CertDoc[]) {
  const ids = [...new Set(list.map((c) => String(c.dentistId)))];
  return new Map((await StaffModel.find({ _id: { $in: ids } }).select('name').lean()).map((s) => [String(s._id), s.name as string]));
}

async function loadCertificate(auth: AuthContext, id: string, perm: string) {
  const c = await CertificateModel.findOne({ _id: new Types.ObjectId(id), ...ownFilter(auth, perm) });
  if (!c) throw ApiError.notFound();
  const patient = await loadScopedPatient(auth, String(c.patientId));
  return { c, patient };
}

certificateRouter.get(
  '/patients/:id/certificates',
  authorize('clinical.certificate.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await loadScopedPatient(req.auth!, params(req, idParams).id);
    const list = (await CertificateModel.find({ patientId: p._id, ...ownFilter(req.auth!, 'clinical.certificate.read') })
      .sort({ issuedAt: -1 })
      .limit(100)
      .lean()) as unknown as CertDoc[];
    const n = await names(list);
    ok(res, list.map((c) => certificateDto(c, n.get(String(c.dentistId)))));
  }),
);

certificateRouter.post(
  '/patients/:id/certificates',
  authorize('clinical.certificate.issue'),
  validate({ params: idParams, body: issueBody }),
  asyncHandler(async (req, res) => {
    const p = await loadScopedPatient(req.auth!, params(req, idParams).id);
    const staff = req.auth!.staffId ? await StaffModel.findById(req.auth!.staffId).select('name staffType').lean() : null;
    if (!staff || !['dentist', 'hygienist'].includes(staff.staffType as string)) throw ApiError.forbidden('DENTIST_REQUIRED', 'Only dentists issue certificates');
    const b = body(req, issueBody);
    if (b.appointmentId && !(await AppointmentModel.exists({ _id: b.appointmentId, patientId: p._id })))
      throw ApiError.validation([{ path: 'appointmentId', code: 'not_found' }]);
    const to = b.to ?? b.from;
    const c = await CertificateModel.create({
      ...b,
      to,
      days: certificateDays(b.from, to),
      patientId: p._id,
      dentistId: staff._id,
      issuedAt: new Date(),
      number: await nextNumber('certificate', 'MC', { year: new Date().getUTCFullYear() }),
    });
    await recordAudit({ action: 'create', entity: 'medicalCertificate', entityId: c._id, summary: `${c.number} ${b.type}`, after: { patientId: String(p._id), type: b.type, days: c.days } });
    created(res, certificateDto(c.toObject() as unknown as CertDoc, staff.name as string));
  }),
);

certificateRouter.post(
  '/certificates/:id/void',
  authorize('clinical.certificate.issue'),
  validate({ params: idParams, body: voidBody }),
  asyncHandler(async (req, res) => {
    const { c } = await loadCertificate(req.auth!, params(req, idParams).id, 'clinical.certificate.issue');
    if (c.status === 'void') throw ApiError.conflict('CERTIFICATE_VOID', 'This certificate is already void');
    c.status = 'void';
    c.voidReason = body(req, voidBody).reason;
    c.voidedAt = new Date();
    if (req.auth!.staffId) c.voidedBy = new Types.ObjectId(req.auth!.staffId);
    await c.save();
    await recordAudit({ action: 'status_change', entity: 'medicalCertificate', entityId: c._id, summary: c.number, after: { patientId: String(c.patientId) } });
    ok(res, certificateDto(c.toObject() as unknown as CertDoc));
  }),
);

certificateRouter.get(
  '/certificates/:id/print',
  authorize('clinical.certificate.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { c, patient } = await loadCertificate(req.auth!, params(req, idParams).id, 'clinical.certificate.read');
    c.printedAt = new Date();
    await c.save();
    await recordAudit({ action: 'print', entity: 'medicalCertificate', entityId: c._id, summary: c.number });
    ok(res, await certificatePrintData(c.toObject() as unknown as CertDoc, patient));
  }),
);

registerTimelineSource('clinical.certificate.read', async (patientId, auth) => {
  const list = await CertificateModel.find({ patientId, ...ownFilter(auth, 'clinical.certificate.read') })
    .sort({ issuedAt: -1 })
    .limit(30)
    .select('number type status issuedAt')
    .lean();
  return list.map((c) => ({ at: c.issuedAt, kind: c.status === 'void' ? 'certificate.void' : `certificate.${c.type}`, title: c.number, ref: 'certificates' }));
});

onPatientMerge(async (sourceId, targetId) => {
  await CertificateModel.updateMany({ patientId: sourceId }, { $set: { patientId: targetId } });
});

registerPath({ method: 'get', path: '/patients/:id/certificates', tags: ['clinical'], summary: 'Medical certificates of a patient', params: idParams });
registerPath({ method: 'post', path: '/patients/:id/certificates', tags: ['clinical'], summary: 'Issue a certificate (dentist)', params: idParams, body: issueBody });
registerPath({ method: 'post', path: '/certificates/:id/void', tags: ['clinical'], summary: 'Void a certificate (cannot be edited)', params: idParams, body: voidBody });
registerPath({ method: 'get', path: '/certificates/:id/print', tags: ['clinical'], summary: 'Printable certificate (letterhead, dentist)', params: idParams });
