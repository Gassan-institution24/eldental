import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { crudRouter, updateOf } from '@/core/crud/crudRouter';
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
import { localDate, startOfLocalDay, addDays } from '@/shared/dates';
import { instructionGiveBody, instructionTemplateBody } from '@/shared/patients';
import { objectId } from '@/shared/validation/fields';
import { PerformedProcedureModel } from './clinical.models';
import { InstructionTemplateModel, PatientInstructionModel } from './instruction.model';

/** Post-treatment instructions: clinic templates and what each patient was given (07 §15). */
export const instructionRouter = Router();

const idParams = z.object({ id: objectId() });
const templateBody = instructionTemplateBody();
const giveBody = instructionGiveBody();

instructionRouter.use(
  crudRouter({
    path: '/instruction-templates',
    entity: 'instructionTemplate',
    tag: 'clinical',
    model: InstructionTemplateModel as never,
    perms: { read: ['clinical.instruction.give', 'clinic.settings.read'], create: 'clinic.settings.update' },
    createSchema: templateBody,
    updateSchema: updateOf(templateBody.shape),
    sortable: ['name', 'createdAt'],
    defaultSort: { createdAt: 1 },
    searchFrom: (b) => b.name as string,
    unpaged: true,
  }),
);

type GivenDoc = {
  _id: Types.ObjectId;
  patientId: Types.ObjectId;
  templateId?: Types.ObjectId | null;
  appointmentId?: Types.ObjectId | null;
  title: string;
  body: string;
  givenBy: Types.ObjectId;
  givenAt: Date;
};

export function instructionDto(i: GivenDoc, givenByName?: string) {
  return {
    id: String(i._id),
    patientId: String(i.patientId),
    templateId: i.templateId ? String(i.templateId) : undefined,
    appointmentId: i.appointmentId ? String(i.appointmentId) : undefined,
    title: i.title,
    body: i.body,
    givenBy: String(i.givenBy),
    givenByName,
    givenAt: i.givenAt,
  };
}

/** `own` = instructions I gave, for patients in my scope. */
const ownFilter = (auth: AuthContext, perm: string) => (scopeFor(auth, perm) === 'own' && auth.staffId ? { givenBy: new Types.ObjectId(auth.staffId) } : {});

async function staffNames(ids: Types.ObjectId[]) {
  return new Map((await StaffModel.find({ _id: { $in: ids } }).select('name').lean()).map((s) => [String(s._id), s.name as string]));
}

instructionRouter.get(
  '/patients/:id/instructions',
  authorize('clinical.instruction.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await loadScopedPatient(req.auth!, params(req, idParams).id);
    const list = (await PatientInstructionModel.find({ patientId: p._id, ...ownFilter(req.auth!, 'clinical.instruction.read') })
      .sort({ givenAt: -1 })
      .limit(100)
      .lean()) as unknown as GivenDoc[];
    const names = await staffNames(list.map((i) => i.givenBy));
    ok(res, list.map((i) => instructionDto(i, names.get(String(i.givenBy)))));
  }),
);

/** Templates whose procedure codes match what was performed for this patient today (clinic time). */
instructionRouter.get(
  '/patients/:id/instructions/suggestions',
  authorize('clinical.instruction.give'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const p = await loadScopedPatient(req.auth!, params(req, idParams).id);
    const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('timezone').lean());
    const tz = clinic?.timezone ?? 'Asia/Amman';
    const today = localDate(new Date(), tz);
    const from = startOfLocalDay(today, tz);
    const to = startOfLocalDay(addDays(today, 1), tz);
    const codes = [...new Set((await PerformedProcedureModel.find({ patientId: p._id, status: 'completed', performedAt: { $gte: from, $lt: to } }).select('code').lean()).map((x) => x.code).filter((c): c is string => Boolean(c)))];
    const templates = codes.length ? await InstructionTemplateModel.find({ isActive: true, procedureCodes: { $in: codes } }).select('_id').lean() : [];
    ok(res, { codes, templateIds: templates.map((t) => String(t._id)) });
  }),
);

instructionRouter.post(
  '/patients/:id/instructions',
  authorize('clinical.instruction.give'),
  validate({ params: idParams, body: giveBody }),
  asyncHandler(async (req, res) => {
    if (!req.auth!.staffId) throw ApiError.forbidden();
    const p = await loadScopedPatient(req.auth!, params(req, idParams).id);
    const b = body(req, giveBody);
    const missing = [
      ...(b.templateId && !(await InstructionTemplateModel.exists({ _id: b.templateId })) ? [{ path: 'templateId', code: 'not_found' }] : []),
      ...(b.appointmentId && !(await AppointmentModel.exists({ _id: b.appointmentId, patientId: p._id })) ? [{ path: 'appointmentId', code: 'not_found' }] : []),
    ];
    if (missing.length) throw ApiError.validation(missing);
    const i = await PatientInstructionModel.create({ ...b, patientId: p._id, givenBy: req.auth!.staffId, givenAt: new Date() });
    await recordAudit({ action: 'create', entity: 'patientInstruction', entityId: i._id, after: { patientId: String(p._id), templateId: b.templateId } });
    const names = await staffNames([i.givenBy]);
    created(res, instructionDto(i.toObject() as unknown as GivenDoc, names.get(String(i.givenBy))));
  }),
);

/** Everything the print needs; shared with the patient portal. */
export async function instructionPrintData(i: GivenDoc, patient: { fullName: string; fileNumber: string }) {
  const [clinic, names] = await Promise.all([runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('name phone email address').lean()), staffNames([i.givenBy])]);
  return {
    instruction: instructionDto(i, names.get(String(i.givenBy))),
    patient: { fullName: patient.fullName, fileNumber: patient.fileNumber },
    clinic: clinic ? { name: clinic.name, phone: clinic.phone?.e164 ?? undefined, email: clinic.email ?? undefined, addressLine1: clinic.address?.line1 ?? undefined } : null,
  };
}

instructionRouter.get(
  '/patient-instructions/:id/print',
  authorize('clinical.instruction.read'),
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const i = await PatientInstructionModel.findOne({ _id: params(req, idParams).id, ...ownFilter(req.auth!, 'clinical.instruction.read') }).lean();
    if (!i) throw ApiError.notFound();
    const patient = await loadScopedPatient(req.auth!, String(i.patientId));
    await recordAudit({ action: 'print', entity: 'patientInstruction', entityId: i._id });
    ok(res, await instructionPrintData(i as unknown as GivenDoc, patient));
  }),
);

registerTimelineSource('clinical.instruction.read', async (patientId, auth) => {
  const list = await PatientInstructionModel.find({ patientId, ...ownFilter(auth, 'clinical.instruction.read') }).sort({ givenAt: -1 }).limit(30).select('title givenAt').lean();
  return list.map((i) => ({ at: i.givenAt, kind: 'instruction.given', title: i.title, ref: 'instructions' }));
});

onPatientMerge(async (sourceId, targetId) => {
  await PatientInstructionModel.updateMany({ patientId: sourceId }, { $set: { patientId: targetId } });
});

registerPath({ method: 'get', path: '/patients/:id/instructions', tags: ['clinical'], summary: 'Instructions given to a patient', params: idParams });
registerPath({ method: 'get', path: '/patients/:id/instructions/suggestions', tags: ['clinical'], summary: "Templates matching today's performed procedures", params: idParams });
registerPath({ method: 'post', path: '/patients/:id/instructions', tags: ['clinical'], summary: 'Give instructions (text snapshot)', params: idParams, body: giveBody });
registerPath({ method: 'get', path: '/patient-instructions/:id/print', tags: ['clinical'], summary: 'Printable instructions', params: idParams });
