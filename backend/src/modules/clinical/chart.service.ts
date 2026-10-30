import { Types, type ClientSession } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { ApiError } from '@/core/http/ApiError';
import { ClinicProcedureModel } from '@/modules/clinic/clinic.models';
import { InsuranceCompanyModel, InsurancePolicyModel } from '@/modules/patients/patient.models';
import { mulFraction, mul, sub, maxOf, minOf } from '@/shared/money';
import { isValidSurface, isValidTooth, type Surface } from '@/shared/validation/fields';
import { ChartEntryModel, ToothChartModel, type ToothState } from './clinical.models';

/* ---------- validation shared by chart, plans and procedures ---------- */

/** Teeth/surfaces rules (07 §1) + the procedure's own requirements. */
export function assertTeeth(teeth: number[], surfaces: string[], opts: { toothRequired?: boolean; surfacesRequired?: boolean; path?: string } = {}) {
  const base = opts.path ? `${opts.path}.` : '';
  if (opts.toothRequired && teeth.length === 0) throw ApiError.validation([{ path: `${base}toothNumbers`, code: 'required' }]);
  for (const t of teeth) if (!isValidTooth(t)) throw ApiError.validation([{ path: `${base}toothNumbers`, code: 'invalid_tooth' }]);
  if (opts.surfacesRequired && teeth.length && surfaces.length === 0) throw ApiError.validation([{ path: `${base}surfaces`, code: 'required' }]);
  for (const t of teeth) {
    for (const s of surfaces) if (!isValidSurface(t, s as Surface)) throw ApiError.validation([{ path: `${base}surfaces`, code: 'invalid_surface', params: { tooth: t, surface: s } }]);
  }
}

/* ---------- snapshot ---------- */

export async function loadChart(patientId: Types.ObjectId | string, session?: ClientSession) {
  const existing = await ToothChartModel.findOne({ patientId }).session(session ?? null);
  if (existing) return existing;
  const [doc] = await ToothChartModel.create([{ patientId, teeth: {} }], { session });
  return doc!;
}

type Effect = { setStatus?: string; addCondition?: string; removeConditions?: string[] };

function applyToTooth(t: ToothState | undefined, e: { kind: string; entryId: string; surfaces: string[]; effect: Effect; planItemId?: string; planId?: string; at: Date }): ToothState {
  const tooth: ToothState = t ? { status: t.status, conditions: [...t.conditions] } : { status: 'present', conditions: [] };
  if (e.kind === 'completed' && e.planItemId) tooth.conditions = tooth.conditions.filter((c) => !(c.kind === 'planned' && (c as { planItemId?: string }).planItemId === e.planItemId));
  if (e.kind !== 'planned') {
    if (e.effect.removeConditions?.length) {
      tooth.conditions = tooth.conditions.filter((c) => c.kind === 'planned' || !e.effect.removeConditions!.includes(c.code) || (e.surfaces.length > 0 && !(c.surfaces ?? []).some((s) => e.surfaces.includes(s))));
    }
    if (e.effect.setStatus) tooth.status = e.effect.setStatus as ToothState['status'];
  }
  if (e.effect.addCondition) {
    tooth.conditions.push({ code: e.effect.addCondition, surfaces: e.surfaces, notedAt: e.at, entryId: e.entryId, kind: e.kind, ...(e.planItemId ? { planItemId: e.planItemId } : {}), ...(e.kind === 'planned' && e.planId ? { planId: e.planId } : {}) } as ToothState['conditions'][number]);
  }
  return tooth;
}

export type EntryInput = {
  toothNumber: number;
  surfaces?: string[];
  kind: 'existing' | 'finding' | 'planned' | 'completed';
  conditionCode?: string;
  setStatus?: 'present' | 'missing' | 'implant' | 'unerupted';
  notes?: string;
  clinicProcedureId?: string;
  performedProcedureId?: Types.ObjectId;
  treatmentPlanId?: Types.ObjectId;
  planItemId?: string;
  appointmentId?: string;
  removeConditions?: string[];
};

/** Appends a chart entry and updates the snapshot in the same session (07 §2). */
export async function addEntry(auth: AuthContext, patientId: Types.ObjectId | string, e: EntryInput, session?: ClientSession) {
  assertTeeth([e.toothNumber], e.surfaces ?? []);
  const at = new Date();
  const [entry] = await ChartEntryModel.create(
    [
      {
        patientId,
        toothNumber: e.toothNumber,
        surfaces: e.surfaces ?? [],
        kind: e.kind,
        conditionCode: e.conditionCode,
        setStatus: e.setStatus,
        clinicProcedureId: e.clinicProcedureId,
        performedProcedureId: e.performedProcedureId,
        treatmentPlanId: e.treatmentPlanId,
        appointmentId: e.appointmentId,
        staffId: auth.staffId,
        notes: e.notes ?? '',
        at,
      },
    ],
    { session },
  );
  const chart = await loadChart(patientId, session);
  const teeth = { ...(chart.teeth as Record<string, ToothState>) };
  const key = String(e.toothNumber);
  teeth[key] = applyToTooth(teeth[key], {
    kind: e.kind,
    entryId: String(entry!._id),
    surfaces: e.surfaces ?? [],
    effect: { ...(e.conditionCode ? { addCondition: e.conditionCode } : {}), ...(e.setStatus ? { setStatus: e.setStatus } : {}), ...(e.removeConditions ? { removeConditions: e.removeConditions } : {}) },
    ...(e.planItemId ? { planItemId: e.planItemId } : {}),
    ...(e.treatmentPlanId ? { planId: String(e.treatmentPlanId) } : {}),
    at,
  });
  chart.set('teeth', teeth);
  chart.markModified('teeth');
  await chart.save({ session });
  return entry!;
}

/** Entries are never edited: voiding removes what the entry added from the snapshot. */
export async function voidEntry(auth: AuthContext, patientId: string, entryId: string, reason: string) {
  const entry = await ChartEntryModel.findOne({ _id: entryId, patientId });
  if (!entry) throw ApiError.notFound();
  if (entry.voided) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Entry already voided');
  if (entry.kind === 'completed') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Void the performed procedure instead');
  entry.voided = true;
  await entry.save();
  await ChartEntryModel.create({ patientId, toothNumber: entry.toothNumber, surfaces: entry.surfaces, kind: entry.kind === 'planned' ? 'planned' : 'existing', voidsEntryId: entry._id, staffId: auth.staffId, notes: reason });
  const chart = await loadChart(patientId);
  const teeth = { ...(chart.teeth as Record<string, ToothState>) };
  const t = teeth[String(entry.toothNumber)];
  if (t) {
    t.conditions = t.conditions.filter((c) => c.entryId !== String(entry._id));
    if (entry.setStatus && t.status === entry.setStatus) t.status = 'present';
    teeth[String(entry.toothNumber)] = t;
  }
  chart.set('teeth', teeth);
  chart.markModified('teeth');
  await chart.save();
  await recordAudit({ action: 'status_change', entity: 'chartEntry', entityId: entryId, reason });
}

export async function setDentition(patientId: string, dentition: 'permanent' | 'primary' | 'mixed') {
  const chart = await loadChart(patientId);
  chart.dentition = dentition;
  await chart.save();
  return chart;
}

export async function chartView(patientId: string) {
  const chart = await loadChart(patientId);
  const entries = await ChartEntryModel.find({ patientId }).sort({ at: -1 }).limit(500).lean();
  return {
    dentition: chart.dentition,
    teeth: chart.teeth as Record<string, ToothState>,
    entries: entries.map((e) => ({
      id: String(e._id),
      toothNumber: e.toothNumber,
      surfaces: e.surfaces,
      kind: e.kind,
      conditionCode: e.conditionCode,
      setStatus: e.setStatus,
      clinicProcedureId: e.clinicProcedureId ? String(e.clinicProcedureId) : undefined,
      treatmentPlanId: e.treatmentPlanId ? String(e.treatmentPlanId) : undefined,
      staffId: e.staffId ? String(e.staffId) : undefined,
      notes: e.notes,
      voided: Boolean(e.voided),
      voidsEntryId: e.voidsEntryId ? String(e.voidsEntryId) : undefined,
      at: e.at,
    })),
  };
}

/* ---------- pricing & insurance estimates (07 §3) ---------- */

export type Pricing = { unitPrice: number; category: string; code: string; toothRequired: boolean; surfacesRequired: boolean; effect: Effect; recall?: { type?: string | null; months?: number | null } | null; name?: string | null; systemKey?: string | null; commissionEligible: boolean };

export async function procedurePricing(clinicProcedureId: string, insuranceCompanyId?: string): Promise<Pricing> {
  const p = await ClinicProcedureModel.findById(clinicProcedureId).lean();
  if (!p || !p.isActive) throw ApiError.validation([{ path: 'clinicProcedureId', code: 'not_found' }]);
  const ins = insuranceCompanyId ? p.insurancePrices?.find((x) => String(x.insuranceCompanyId) === insuranceCompanyId) : undefined;
  return {
    unitPrice: ins?.price ?? p.price ?? 0,
    category: p.category,
    code: p.code,
    toothRequired: Boolean(p.toothRequired),
    surfacesRequired: Boolean(p.surfacesRequired),
    effect: { ...(p.chartEffect?.setStatus ? { setStatus: p.chartEffect.setStatus } : {}), ...(p.chartEffect?.addCondition ? { addCondition: p.chartEffect.addCondition } : {}), ...(p.chartEffect?.removeConditions?.length ? { removeConditions: p.chartEffect.removeConditions } : {}) },
    recall: p.recall ?? null,
    name: p.name,
    systemKey: p.systemKey,
    commissionEligible: p.commissionEligible ?? true,
  };
}

export type Coverage = { insuranceCompanyId: string; percentFor: (category: string) => number; remaining: number | null };

export async function policyCoverage(policyId?: string | null): Promise<Coverage | null> {
  if (!policyId) return null;
  const policy = await InsurancePolicyModel.findById(policyId).lean();
  if (!policy) throw ApiError.validation([{ path: 'insurancePolicyId', code: 'not_found' }]);
  const company = await InsuranceCompanyModel.findById(policy.insuranceCompanyId).lean();
  return {
    insuranceCompanyId: String(policy.insuranceCompanyId),
    percentFor: (category) => policy.coveragePercentOverride ?? company?.coverageRules?.find((r) => r.procedureCategory === category)?.percent ?? company?.defaultCoveragePercent ?? 0,
    remaining: policy.annualMax ? maxOf(0, sub(policy.annualMax, policy.usedThisYear ?? 0)) : null,
  };
}

type PricedLine = { quantity: number; unitPrice: number; discount: number; category: string };

/** Insurance estimate per line = net × coverage%, capped by what is left of the annual max. */
export function estimate<T extends PricedLine>(lines: T[], cov: Coverage | null) {
  let remaining = cov?.remaining ?? null;
  const out = lines.map((l) => {
    const net = maxOf(0, sub(mul(l.unitPrice, l.quantity), l.discount));
    let insurance = cov ? mulFraction(net, cov.percentFor(l.category), 100) : 0;
    if (remaining !== null) {
      insurance = minOf(insurance, remaining);
      remaining = sub(remaining, insurance);
    }
    return { ...l, insuranceEstimate: insurance, patientEstimate: sub(net, insurance), net };
  });
  return out;
}

export const asObjectId = (id: string) => new Types.ObjectId(id);
