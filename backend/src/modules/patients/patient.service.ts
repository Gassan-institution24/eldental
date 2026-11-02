import { Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { withTransaction } from '@/core/db/transaction';
import { nextNumber } from '@/core/db/sequence';
import { ApiError } from '@/core/http/ApiError';
import { pageMeta } from '@/core/http/response';
import { fieldPolicyOf } from '@/core/rbac/authorize';
import { applyFieldPolicy, assertQueryable, assertWritable, projectionFor, sortFields } from '@/core/rbac/fieldPolicy';
import { StaffModel } from '@/modules/staff/staff.model';
import { decrypt, encrypt, searchHash } from '@/shared/crypto';
import { parseSort, skipOf } from '@/shared/pagination';
import { normalizePhone } from '@/shared/validation/fields';
import { escapeRegex, toSearchName } from '@/shared/validation/normalize';
import { InsurancePolicyModel, MedicalHistoryModel, PatientModel, type Patient } from './patient.models';
import type { PatientCreate, PatientListQuery } from './patient.schemas';

const RESOURCE = 'patients.patient';
const SORTABLE = ['fileNumber', 'name', 'createdAt', 'lastVisitAt', 'balance', 'dateOfBirth'] as const;
const SORT_MAP: Record<string, string> = { name: 'searchName' };
const DB_PATHS: Record<string, readonly string[]> = {
  nationalId: ['nationalIdEnc', 'nationalIdLast4', 'nationalIdHash', 'passportNo'],
  insurance: [],
  preferredDentist: ['preferredDentistId'],
};

/**
 * "Own" patients = patients with an appointment or treatment by the user (04 §3). Scheduling
 * and clinical register their sources; preferred dentist always counts.
 */
type OwnSource = (staffId: string) => Promise<Types.ObjectId[]>;
const ownSources: OwnSource[] = [];
export function registerOwnPatientSource(fn: OwnSource): void {
  ownSources.push(fn);
}

export async function ownPatientFilter(auth: AuthContext): Promise<Record<string, unknown>> {
  if (auth.scope !== 'own' || !auth.staffId) return {};
  const ids = (await Promise.all(ownSources.map((s) => s(auth.staffId!)))).flat();
  return { $or: [{ _id: { $in: ids } }, { preferredDentistId: new Types.ObjectId(auth.staffId) }] };
}

async function scoped(auth: AuthContext, filter: Record<string, unknown>) {
  const own = await ownPatientFilter(auth);
  return Object.keys(own).length ? { $and: [filter, own] } : filter;
}

export function fullNameOf(n: { first: string; father?: string | null; grandfather?: string | null; family: string }) {
  return [n.first, n.father, n.grandfather, n.family].filter(Boolean).join(' ');
}

type Raw = Partial<Patient> & { _id: Types.ObjectId; __v?: number; nationalIdEnc?: string };

export function toPatientDto(p: Raw) {
  return {
    id: String(p._id),
    version: p.__v ?? 0,
    fileNumber: p.fileNumber,
    name: p.name,
    fullName: p.fullName,
    gender: p.gender ?? undefined,
    dateOfBirth: p.dateOfBirth ?? undefined,
    nationalId: p.nationalIdEnc ? decrypt(p.nationalIdEnc) : p.nationalIdLast4 ? `******${p.nationalIdLast4}` : undefined,
    passportNo: p.passportNo ?? undefined,
    phone: p.phone?.e164 ?? undefined,
    altPhone: p.altPhone?.e164 ?? undefined,
    email: p.email ?? undefined,
    address: p.address,
    guardian: p.guardian?.name ? { ...p.guardian, patientId: p.guardian.patientId ? String(p.guardian.patientId) : undefined } : undefined,
    familyGroupId: p.familyGroupId ? String(p.familyGroupId) : undefined,
    emergencyContact: p.emergencyContact?.name ? p.emergencyContact : undefined,
    referralSource: p.referralSource ?? undefined,
    preferredDentist: p.preferredDentistId ? String(p.preferredDentistId) : undefined,
    preferredLanguage: p.preferredLanguage,
    communicationPrefs: p.communicationPrefs,
    medicalAlerts: p.medicalAlerts ?? [],
    balance: p.balance ?? 0,
    tags: p.tags ?? [],
    notes: p.notes ?? '',
    status: p.status,
    mergedIntoId: p.mergedIntoId ? String(p.mergedIntoId) : undefined,
    lastVisitAt: p.lastVisitAt,
    noShowCount: p.noShowCount ?? 0,
    hasPortalAccount: Boolean(p.userId),
    createdAt: p.createdAt,
  };
}

function serialize(auth: AuthContext, raw: Raw) {
  return applyFieldPolicy(toPatientDto(raw), fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`));
}

function plusFields(auth: AuthContext) {
  const p = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  return p.visible.has('nationalId') || p.masked.has('nationalId') ? '+nationalIdEnc' : '';
}

export async function listPatients(auth: AuthContext, q: PatientListQuery) {
  const policy = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  assertQueryable([...sortFields(q.sort)], policy);
  const filter: Record<string, unknown> = { status: q.status ?? { $ne: 'merged' } };
  if (q.tag) filter.tags = q.tag;
  if (q.dentistId) filter.preferredDentistId = new Types.ObjectId(q.dentistId);
  if (q.q) Object.assign(filter, searchFilter(q.q, policy.visible.has('nationalId')));
  const finalFilter = await scoped(auth, filter);
  const sortIn = parseSort(q.sort, SORTABLE, { createdAt: -1 });
  const sort = Object.fromEntries(Object.entries(sortIn).map(([k, v]) => [SORT_MAP[k] ?? k, v]));
  const query = PatientModel.find(finalFilter).select(projectionFor(policy, DB_PATHS)).sort(sort).skip(skipOf(q)).limit(q.limit);
  const plus = plusFields(auth);
  if (plus) query.select(plus);
  const [items, total] = await Promise.all([query.lean(), PatientModel.countDocuments(finalFilter)]);
  return { data: items.map((p) => serialize(auth, p as Raw)), meta: pageMeta(q.page, q.limit, total) };
}

/** Name (both scripts), phone, file number, and national ID (only if visible — no inference). */
function searchFilter(q: string, canSearchNationalId: boolean): Record<string, unknown> {
  const term = toSearchName(q);
  const or: Record<string, unknown>[] = [{ searchName: { $regex: escapeRegex(term) } }, { fileNumber: { $regex: `^${escapeRegex(q.trim().toUpperCase())}` } }];
  const digits = q.replace(/\D/g, '');
  if (digits.length >= 4) {
    const e164 = normalizePhone(q);
    or.push(e164 ? { 'phone.e164': e164 } : { 'phone.e164': { $regex: escapeRegex(digits.replace(/^0/, '')) } });
    if (canSearchNationalId && digits.length === 10) or.push({ nationalIdHash: searchHash(digits) });
  }
  return { $or: or };
}

/** Fast typeahead for pickers and the global search. */
export async function searchPatients(auth: AuthContext, q: string, limit: number) {
  const policy = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  const filter = await scoped(auth, { ...searchFilter(q, policy.visible.has('nationalId')), status: { $in: ['active', 'inactive'] } });
  const items = await PatientModel.find(filter).select('fileNumber fullName phone dateOfBirth gender medicalAlerts balance status').sort({ lastVisitAt: -1, createdAt: -1 }).limit(limit).lean();
  return items.map((p) => {
    const dto = applyFieldPolicy({ id: String(p._id), fileNumber: p.fileNumber, fullName: p.fullName, phone: p.phone?.e164, dateOfBirth: p.dateOfBirth, gender: p.gender, medicalAlerts: p.medicalAlerts, balance: p.balance, status: p.status }, policy);
    return dto;
  });
}

export async function getPatient(auth: AuthContext, id: string) {
  const policy = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  const query = PatientModel.findOne(await scoped(auth, { _id: new Types.ObjectId(id) })).select(projectionFor(policy, DB_PATHS));
  const plus = plusFields(auth);
  if (plus) query.select(plus);
  const raw = await query.lean();
  if (!raw) throw ApiError.notFound();
  const dto = serialize(auth, raw as Raw);
  // The profile shows the dentist's name; most roles can't read the staff directory.
  const dentist = dto.preferredDentist ? await StaffModel.findById(dto.preferredDentist).select('name').lean() : null;
  return { ...dto, ...(dentist ? { preferredDentistName: dentist.name } : {}) };
}

/** Loads the document after checking scope; 404 outside scope/tenant. */
export async function loadScopedPatient(auth: AuthContext, id: string) {
  const doc = await PatientModel.findOne(await scoped(auth, { _id: new Types.ObjectId(id) })).select('+nationalIdEnc');
  if (!doc) throw ApiError.notFound();
  return doc;
}

function phoneObj(e164: string | null | undefined) {
  return e164 ? { e164, countryCode: e164.slice(1, 4), number: e164.slice(4) } : undefined;
}

/** Maps a validated body onto storage fields (encryption, search name). */
function toModel(b: Partial<PatientCreate> & { nationalId?: string | null }) {
  const out: Record<string, unknown> = {};
  for (const k of ['gender', 'dateOfBirth', 'passportNo', 'email', 'address', 'emergencyContact', 'referralSource', 'preferredLanguage', 'communicationPrefs', 'tags', 'notes'] as const) {
    if (k in b) out[k] = b[k];
  }
  if (b.name) {
    out.name = b.name;
    out.fullName = fullNameOf(b.name);
    out.searchName = toSearchName(fullNameOf(b.name));
  }
  if ('phone' in b) out.phone = phoneObj(b.phone);
  if ('altPhone' in b) out.altPhone = phoneObj(b.altPhone);
  if ('nationalId' in b) {
    out.nationalIdEnc = b.nationalId ? encrypt(b.nationalId) : undefined;
    out.nationalIdHash = b.nationalId ? searchHash(b.nationalId) : undefined;
    out.nationalIdLast4 = b.nationalId ? b.nationalId.slice(-4) : undefined;
  }
  if ('guardian' in b) out.guardian = b.guardian ? { ...b.guardian, patientId: b.guardian.patientId ? new Types.ObjectId(b.guardian.patientId) : undefined } : undefined;
  if ('preferredDentistId' in b) out.preferredDentistId = b.preferredDentistId ? new Types.ObjectId(b.preferredDentistId) : undefined;
  return out;
}

/** Field keys touched by the body → write check against the field policy. */
function fieldBody(b: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...b };
  if ('preferredDentistId' in b) {
    out.preferredDentist = b.preferredDentistId;
    delete out.preferredDentistId;
  }
  return out;
}

export async function createPatient(auth: AuthContext, b: PatientCreate) {
  assertWritable(fieldBody(b), fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.create`));
  const doc = await withTransaction(async (session) => {
    const fileNumber = await nextNumber('patient', 'P', { pad: 6, session });
    const [created] = await PatientModel.create([{ ...toModel(b), fileNumber, status: 'active', ...(b.guardian?.patientId ? { familyGroupId: await familyOf(b.guardian.patientId) } : {}) }], { session });
    return created!;
  });
  await recordAudit({ action: 'create', entity: 'patient', entityId: doc._id, after: { fileNumber: doc.fileNumber }, resource: RESOURCE });
  return getPatient({ ...auth, scope: 'all' }, String(doc._id));
}

async function familyOf(guardianPatientId: string): Promise<Types.ObjectId> {
  const g = await PatientModel.findById(guardianPatientId).select('familyGroupId').lean();
  if (!g) throw ApiError.validation([{ path: 'guardian.patientId', code: 'not_found' }]);
  if (g.familyGroupId) return g.familyGroupId;
  // Atomic update: a projected document can't be save()d (required fields aren't loaded).
  const familyGroupId = new Types.ObjectId();
  await PatientModel.updateOne({ _id: g._id, familyGroupId: { $exists: false } }, { $set: { familyGroupId } });
  const after = await PatientModel.findById(g._id).select('familyGroupId').lean();
  return after?.familyGroupId ?? familyGroupId;
}

export async function updatePatient(auth: AuthContext, id: string, body: Partial<PatientCreate> & { version: number; status?: string; nationalId?: string | null }) {
  const { version, status, ...changes } = body;
  assertWritable(fieldBody({ ...changes, ...(status ? { status } : {}) }), fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.update`));
  const doc = await loadScopedPatient(auth, id);
  if ((doc.__v ?? 0) !== version) throw ApiError.conflict('VERSION_CONFLICT', 'The record was changed by someone else.');
  if (doc.status === 'merged') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Merged patients cannot be edited');
  const before = toPatientDto(doc.toObject() as Raw);
  const merged = { dateOfBirth: doc.dateOfBirth ?? undefined, guardian: doc.guardian?.name ? doc.guardian : undefined, ...changes };
  if (merged.dateOfBirth && Date.now() - Date.parse(merged.dateOfBirth) < 18 * 365.25 * 86_400_000 && !merged.guardian) {
    throw ApiError.validation([{ path: 'guardian.name', code: 'guardian_required' }]);
  }
  for (const [k, v] of Object.entries(toModel(changes))) doc.set(k, v);
  if (status) doc.status = status as typeof doc.status;
  if (changes.guardian?.patientId) doc.familyGroupId = await familyOf(changes.guardian.patientId);
  await doc.save();
  await recordAudit({ action: 'update', entity: 'patient', entityId: id, before, after: toPatientDto(doc.toObject() as Raw), resource: RESOURCE });
  return getPatient(auth, id);
}

export async function deletePatient(auth: AuthContext, id: string) {
  const doc = await loadScopedPatient(auth, id);
  if (doc.balance !== 0) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Patient has a balance', { balance: doc.balance });
  await (doc as unknown as { softDelete: () => Promise<void> }).softDelete();
  await recordAudit({ action: 'delete', entity: 'patient', entityId: id });
}

export async function restorePatient(id: string) {
  const doc = await PatientModel.findOne({ _id: id }).setOptions({ withDeleted: true });
  if (!doc) throw ApiError.notFound();
  await (doc as unknown as { restore: () => Promise<void> }).restore();
  await recordAudit({ action: 'restore', entity: 'patient', entityId: id });
}

/** Possible duplicates by phone / national ID (a warning, not a block — 16 §5.2). Only records in the caller's scope. */
export async function findDuplicates(auth: AuthContext, q: { phone?: string; nationalId?: string; excludeId?: string }) {
  const or: Record<string, unknown>[] = [];
  const e164 = q.phone ? normalizePhone(q.phone) : null;
  if (e164) or.push({ 'phone.e164': e164 });
  if (q.nationalId && /^\d{10}$/.test(q.nationalId)) or.push({ nationalIdHash: searchHash(q.nationalId) });
  if (!or.length) return [];
  const filter = await scoped(auth, { $or: or, status: { $ne: 'merged' }, ...(q.excludeId ? { _id: { $ne: new Types.ObjectId(q.excludeId) } } : {}) });
  const items = await PatientModel.find(filter).select('fileNumber fullName phone').limit(5).lean();
  return items.map((p) => ({ id: String(p._id), fileNumber: p.fileNumber, fullName: p.fullName, phone: p.phone?.e164 }));
}

/* ---------- family (familyGroupId is part of the `guardian` field) ---------- */

/** Members of the patient's family group that the caller may see, with their relation to this patient. */
export async function familyMembers(auth: AuthContext, id: string) {
  const policy = fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.read`);
  const p = await loadScopedPatient(auth, id);
  if (!policy.visible.has('guardian') || !p.familyGroupId) return [];
  const rows = await PatientModel.find(await scoped(auth, { familyGroupId: p.familyGroupId, _id: { $ne: p._id }, status: { $ne: 'merged' } }))
    .select('fileNumber fullName gender dateOfBirth status guardian.patientId')
    .sort({ dateOfBirth: 1 })
    .limit(30)
    .lean();
  return rows.map((m) =>
    applyFieldPolicy(
      {
        id: String(m._id),
        fileNumber: m.fileNumber,
        fullName: m.fullName,
        gender: m.gender ?? undefined,
        dateOfBirth: m.dateOfBirth ?? undefined,
        status: m.status,
        relation: String(m.guardian?.patientId) === String(p._id) ? 'dependant' : String(p.guardian?.patientId) === String(m._id) ? 'guardian' : 'member',
      },
      policy,
    ),
  );
}

/** Puts `otherId` (and its current family, if any) into this patient's family group. */
export async function linkFamily(auth: AuthContext, id: string, otherId: string) {
  assertWritable({ familyGroupId: otherId }, fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.update`));
  if (id === otherId) throw ApiError.validation([{ path: 'patientId', code: 'family_self' }]);
  const [p, other] = await Promise.all([loadScopedPatient(auth, id), loadScopedPatient(auth, otherId).catch(() => null)]);
  if (!other) throw ApiError.validation([{ path: 'patientId', code: 'not_found' }]);
  if (p.status === 'merged' || other.status === 'merged') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Merged patients cannot be linked');
  const group = p.familyGroupId ?? other.familyGroupId ?? new Types.ObjectId();
  await withTransaction(async (session) => {
    if (other.familyGroupId && !other.familyGroupId.equals(group)) {
      await PatientModel.updateMany({ familyGroupId: other.familyGroupId }, { $set: { familyGroupId: group } }, { session });
    }
    await PatientModel.updateMany({ _id: { $in: [p._id, other._id] } }, { $set: { familyGroupId: group } }, { session });
  });
  await recordAudit({ action: 'update', entity: 'patient', entityId: id, summary: `family linked ${other.fileNumber}`, after: { patientId: id, familyGroupId: String(group) }, resource: RESOURCE });
  return familyMembers(auth, id);
}

/** Removes this patient from their family group (the others stay linked). */
export async function unlinkFamily(auth: AuthContext, id: string) {
  assertWritable({ familyGroupId: null }, fieldPolicyOf(auth, RESOURCE, `${RESOURCE}.update`));
  const p = await loadScopedPatient(auth, id);
  if (!p.familyGroupId) return;
  await PatientModel.updateOne({ _id: p._id }, { $unset: { familyGroupId: 1 } });
  await recordAudit({ action: 'update', entity: 'patient', entityId: id, summary: 'family unlinked', resource: RESOURCE });
}

/** Merge duplicates: references move to the target, the source becomes `merged` (01 §4.3). */
type MergeHook = (sourceId: Types.ObjectId, targetId: Types.ObjectId) => Promise<void>;
const mergeHooks: MergeHook[] = [];
export function onPatientMerge(fn: MergeHook): void {
  mergeHooks.push(fn);
}

export async function mergePatients(auth: AuthContext, targetId: string, sourceId: string, reason: string) {
  if (targetId === sourceId) throw ApiError.conflict('PATIENT_MERGE_INVALID', 'Cannot merge a patient into itself');
  const [target, source] = await Promise.all([loadScopedPatient(auth, targetId), loadScopedPatient(auth, sourceId)]);
  if (source.status === 'merged' || target.status === 'merged') throw ApiError.conflict('PATIENT_MERGE_INVALID', 'Already merged');
  await withTransaction(async (session) => {
    await MedicalHistoryModel.updateMany({ patientId: source._id }, { $set: { patientId: target._id } }, { session });
    await InsurancePolicyModel.updateMany({ patientId: source._id }, { $set: { patientId: target._id } }, { session });
    for (const h of mergeHooks) await h(source._id, target._id);
    target.balance = (target.balance ?? 0) + (source.balance ?? 0);
    target.tags = [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])];
    target.medicalAlerts = [...new Set([...(target.medicalAlerts ?? []), ...(source.medicalAlerts ?? [])])];
    if (!target.phone?.e164 && source.phone?.e164) target.phone = source.phone;
    await target.save({ session });
    source.status = 'merged';
    source.mergedIntoId = target._id;
    source.balance = 0;
    await source.save({ session });
  });
  await recordAudit({ action: 'update', entity: 'patient', entityId: targetId, summary: `merged ${source.fileNumber} into ${target.fileNumber}`, reason });
  return getPatient(auth, targetId);
}
