import { Types } from 'mongoose';
import { recordAudit } from '@/core/audit/audit.service';
import type { AuthContext } from '@/core/auth/auth.types';
import { nextNumber } from '@/core/db/sequence';
import { onCommit, withTransaction } from '@/core/db/transaction';
import { emit } from '@/core/events/bus';
import { ApiError } from '@/core/http/ApiError';
import { scopeFor } from '@/core/rbac/authorize';
import { saveFile } from '@/core/storage/storage';
import { currentClinicId } from '@/core/tenancy/tenantPlugin';
import { ClinicModel } from '@/modules/platform/clinic.model';
import { StaffModel } from '@/modules/staff/staff.model';
import { runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { sum } from '@/shared/money';
import { addEntry, assertTeeth, estimate, policyCoverage, procedurePricing } from './chart.service';
import { PerformedProcedureModel, TreatmentPlanModel, type TreatmentPlanDoc } from './clinical.models';

const BOOKABLE = ['dentist', 'hygienist'];

/* ---------- plans ---------- */

export type PlanItemInput = {
  id?: string;
  phaseIndex?: number;
  clinicProcedureId: string;
  toothNumbers?: number[];
  surfaces?: string[];
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  notes?: string;
};
export type PlanInput = {
  patientId: string;
  title?: string;
  dentistId?: string;
  phases?: { name: string; order: number }[];
  items: PlanItemInput[];
  insurancePolicyId?: string | null;
  validUntil?: string;
  notes?: string;
  alternativeOf?: string;
  alternativeLabel?: string;
};

export function planDto(p: TreatmentPlanDoc | (Record<string, unknown> & { _id: Types.ObjectId })) {
  const o = ('toObject' in p ? (p as TreatmentPlanDoc).toObject() : p) as Record<string, unknown> & { _id: Types.ObjectId; items: Record<string, unknown>[]; __v?: number };
  const id = (v: unknown) => (v ? String(v) : undefined);
  return {
    id: String(o._id),
    version: o.__v ?? 0,
    patientId: String(o.patientId),
    number: o.number,
    title: o.title ?? '',
    dentistId: String(o.dentistId),
    status: o.status,
    phases: o.phases,
    items: (o.items ?? []).map((i) => ({
      id: String(i._id),
      phaseIndex: i.phaseIndex,
      clinicProcedureId: String(i.clinicProcedureId),
      code: i.code,
      category: i.category,
      toothNumbers: i.toothNumbers,
      surfaces: i.surfaces,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      insuranceEstimate: i.insuranceEstimate,
      patientEstimate: i.patientEstimate,
      status: i.status,
      completedProcedureId: id(i.completedProcedureId),
      appointmentId: id(i.appointmentId),
      notes: i.notes ?? '',
    })),
    insurancePolicyId: id(o.insurancePolicyId),
    totals: o.totals,
    alternativeGroupId: id(o.alternativeGroupId),
    alternativeLabel: o.alternativeLabel ?? '',
    presentedAt: o.presentedAt,
    validUntil: o.validUntil,
    acceptance: (o.acceptance as { at?: Date } | undefined)?.at ? { ...(o.acceptance as object), signatureFileId: id((o.acceptance as { signatureFileId?: unknown }).signatureFileId) } : undefined,
    notes: o.notes ?? '',
    createdAt: o.createdAt,
  };
}

function ownPlanFilter(auth: AuthContext, permission: string) {
  return scopeFor(auth, permission) === 'own' ? { dentistId: new Types.ObjectId(auth.staffId) } : {};
}

async function loadPlan(auth: AuthContext, id: string, permission: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound();
  const own = ownPlanFilter(auth, permission);
  const plan = await TreatmentPlanModel.findOne({ _id: id, ...own });
  if (!plan) throw ApiError.notFound();
  return plan;
}

async function priceItems(items: PlanItemInput[], policyId: string | null | undefined, canOverridePrice: boolean, existing?: TreatmentPlanDoc) {
  const cov = await policyCoverage(policyId);
  const lines = [];
  for (const [i, it] of items.entries()) {
    const pr = await procedurePricing(it.clinicProcedureId, cov?.insuranceCompanyId);
    assertTeeth(it.toothNumbers ?? [], it.surfaces ?? [], { toothRequired: pr.toothRequired, surfacesRequired: pr.surfacesRequired, path: `items.${i}` });
    const prev = it.id ? existing?.items.find((x) => String(x._id) === it.id) : undefined;
    if (it.unitPrice !== undefined && it.unitPrice !== pr.unitPrice && it.unitPrice !== prev?.unitPrice && !canOverridePrice) {
      throw ApiError.forbidden('FIELD_FORBIDDEN', 'Changing the price needs discount rights', { fields: [`items.${i}.unitPrice`] });
    }
    lines.push({
      ...(prev ? { _id: prev._id, status: prev.status, completedProcedureId: prev.completedProcedureId, appointmentId: prev.appointmentId } : {}),
      phaseIndex: it.phaseIndex ?? 0,
      clinicProcedureId: new Types.ObjectId(it.clinicProcedureId),
      code: pr.code,
      category: pr.category,
      toothNumbers: it.toothNumbers ?? [],
      surfaces: it.surfaces ?? [],
      quantity: it.quantity ?? Math.max(1, (it.toothNumbers ?? []).length || 1),
      unitPrice: it.unitPrice ?? prev?.unitPrice ?? pr.unitPrice,
      discount: it.discount ?? 0,
      notes: it.notes ?? '',
    });
  }
  const priced = estimate(lines, cov);
  const totals = {
    gross: sum(priced.map((l) => l.unitPrice * l.quantity)),
    discount: sum(priced.map((l) => l.discount)),
    insurance: sum(priced.map((l) => l.insuranceEstimate)),
    patient: sum(priced.map((l) => l.patientEstimate)),
  };
  return { items: priced.map(({ net: _n, ...l }) => l), totals };
}

const canDiscount = (auth: AuthContext) => auth.isOwner || Boolean(scopeFor(auth, 'billing.invoice.discount'));

export async function listPlans(auth: AuthContext, patientId: string) {
  const rows = await TreatmentPlanModel.find({ patientId, ...ownPlanFilter(auth, 'clinical.treatmentPlan.read') }).sort({ createdAt: -1 }).limit(100).lean();
  return rows.map((r) => planDto(r as never));
}

export async function getPlan(auth: AuthContext, id: string) {
  return planDto(await loadPlan(auth, id, 'clinical.treatmentPlan.read'));
}

export async function createPlan(auth: AuthContext, b: PlanInput) {
  const dentistId = b.dentistId ?? auth.staffId;
  if (!dentistId) throw ApiError.validation([{ path: 'dentistId', code: 'required' }]);
  if (scopeFor(auth, 'clinical.treatmentPlan.create') === 'own' && dentistId !== auth.staffId) throw ApiError.forbidden();
  const dentist = await StaffModel.findById(dentistId).select('staffType').lean();
  if (!dentist || !BOOKABLE.includes(dentist.staffType)) throw ApiError.conflict('DENTIST_NOT_BOOKABLE', 'Plans belong to a dentist');
  const priced = await priceItems(b.items, b.insurancePolicyId, canDiscount(auth));
  let groupId: Types.ObjectId | undefined;
  if (b.alternativeOf) {
    const base = await loadPlan(auth, b.alternativeOf, 'clinical.treatmentPlan.create');
    groupId = base.alternativeGroupId ?? base._id;
    if (!base.alternativeGroupId) {
      base.alternativeGroupId = groupId;
      await base.save();
    }
  }
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.numbering').lean());
  const plan = await TreatmentPlanModel.create({
    patientId: b.patientId,
    number: await nextNumber('plan', clinic?.settings?.numbering?.plan ?? 'TP'),
    title: b.title ?? '',
    dentistId,
    phases: b.phases?.length ? b.phases : [{ name: 'phase1', order: 0 }],
    items: priced.items,
    totals: priced.totals,
    insurancePolicyId: b.insurancePolicyId ?? undefined,
    validUntil: b.validUntil,
    notes: b.notes ?? '',
    alternativeGroupId: groupId,
    alternativeLabel: b.alternativeLabel ?? '',
  });
  await syncPlannedChart(auth, plan);
  await recordAudit({ action: 'create', entity: 'treatmentPlan', entityId: plan._id, after: { number: plan.number, patientId: b.patientId, total: priced.totals.gross } });
  return planDto(plan);
}

/** Planned items show on the chart as the "planned" layer. */
async function syncPlannedChart(auth: AuthContext, plan: TreatmentPlanDoc) {
  const { ChartEntryModel, ToothChartModel } = await import('./clinical.models');
  await ChartEntryModel.updateMany({ treatmentPlanId: plan._id, kind: 'planned', voided: false }, { $set: { voided: true } });
  const chart = await ToothChartModel.findOne({ patientId: plan.patientId });
  if (chart) {
    const teeth = chart.teeth as Record<string, { conditions: { kind: string; planId?: string }[] }>;
    for (const t of Object.values(teeth)) t.conditions = t.conditions.filter((c) => !(c.kind === 'planned' && c.planId === String(plan._id)));
    chart.markModified('teeth');
    await chart.save();
  }
  if (['cancelled', 'rejected', 'completed'].includes(plan.status)) return;
  for (const it of plan.items) {
    if (!['proposed', 'accepted', 'scheduled'].includes(it.status)) continue;
    const pr = await procedurePricing(String(it.clinicProcedureId)).catch(() => null);
    for (const tooth of it.toothNumbers) {
      await addEntry(auth, plan.patientId, { toothNumber: tooth, surfaces: it.surfaces, kind: 'planned', ...(pr?.effect.addCondition ? { conditionCode: pr.effect.addCondition } : { conditionCode: 'planned' }), clinicProcedureId: String(it.clinicProcedureId), treatmentPlanId: plan._id, planItemId: String(it._id) });
    }
  }
}

export async function updatePlan(auth: AuthContext, id: string, b: Partial<PlanInput> & { version?: number }) {
  const plan = await loadPlan(auth, id, 'clinical.treatmentPlan.update');
  if (b.version !== undefined && b.version !== plan.__v) throw ApiError.conflict('VERSION_CONFLICT', 'Someone else changed this plan');
  // Prices freeze at presentation (07 §3): only drafts are edited freely.
  if (plan.status !== 'draft') throw ApiError.conflict('PLAN_NOT_EDITABLE', 'Only draft plans can be edited');
  if (b.items) {
    const policy = b.insurancePolicyId === undefined ? (plan.insurancePolicyId ? String(plan.insurancePolicyId) : null) : b.insurancePolicyId;
    const priced = await priceItems(b.items, policy, canDiscount(auth), plan);
    plan.set('items', priced.items);
    plan.set('totals', priced.totals);
  }
  if (b.insurancePolicyId !== undefined) plan.set('insurancePolicyId', b.insurancePolicyId ?? undefined);
  for (const k of ['title', 'phases', 'validUntil', 'notes', 'alternativeLabel'] as const) if (b[k] !== undefined) plan.set(k, b[k]);
  await plan.save();
  await syncPlannedChart(auth, plan);
  await recordAudit({ action: 'update', entity: 'treatmentPlan', entityId: id, after: { total: plan.totals?.gross } });
  return planDto(plan);
}

export async function presentPlan(auth: AuthContext, id: string, validUntil?: string) {
  const plan = await loadPlan(auth, id, 'clinical.treatmentPlan.present');
  if (!['draft', 'presented'].includes(plan.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Plan cannot be presented now');
  if (!plan.items.length) throw ApiError.validation([{ path: 'items', code: 'too_few', params: { min: 1 } }]);
  plan.status = 'presented';
  plan.presentedAt = new Date();
  if (validUntil) plan.validUntil = validUntil;
  await plan.save();
  await recordAudit({ action: 'status_change', entity: 'treatmentPlan', entityId: id, after: { status: 'presented' } });
  return planDto(plan);
}

export type AcceptInput = { itemIds?: string[]; signature: string; signerName?: string; byPatient?: boolean; ip?: string };

/** Accept all or some items with a signature (canvas PNG data URL). Siblings are rejected. */
export async function acceptPlan(auth: AuthContext | null, id: string, b: AcceptInput) {
  const plan = auth ? await loadPlan(auth, id, 'clinical.treatmentPlan.present') : await TreatmentPlanModel.findById(id);
  if (!plan) throw ApiError.notFound();
  if (!['presented', 'draft'].includes(plan.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Plan cannot be accepted now');
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(b.signature);
  if (!m) throw ApiError.validation([{ path: 'signature', code: 'required' }]);
  const file = await saveFile({ clinicId: String(plan.clinicId), ownerType: 'plan', ownerId: plan._id, buffer: Buffer.from(m[1]!, 'base64'), originalName: `signature-${plan.number}.png`, category: 'consent', ...(auth ? { userId: auth.userId } : {}) });
  const chosen = new Set(b.itemIds?.length ? b.itemIds : plan.items.map((i) => String(i._id)));
  for (const it of plan.items) it.status = chosen.has(String(it._id)) ? 'accepted' : 'rejected';
  plan.status = chosen.size === plan.items.length ? 'accepted' : 'partially_accepted';
  plan.set('acceptance', { at: new Date(), byPatient: b.byPatient ?? true, signatureFileId: file._id, ip: b.ip, signerName: b.signerName });
  await plan.save();
  if (plan.alternativeGroupId) {
    await TreatmentPlanModel.updateMany({ alternativeGroupId: plan.alternativeGroupId, _id: { $ne: plan._id }, status: { $in: ['draft', 'presented'] } }, { $set: { status: 'rejected' } });
  }
  if (auth) await syncPlannedChart(auth, plan);
  await recordAudit({ action: 'status_change', entity: 'treatmentPlan', entityId: id, after: { status: plan.status, items: chosen.size } });
  await emit('plan.accepted', { clinicId: String(plan.clinicId), planId: id });
  return planDto(plan);
}

export async function setPlanStatus(auth: AuthContext, id: string, to: 'rejected' | 'cancelled' | 'draft', reason?: string) {
  const plan = await loadPlan(auth, id, 'clinical.treatmentPlan.update');
  const allowed: Record<string, string[]> = { rejected: ['presented', 'draft'], cancelled: ['draft', 'presented', 'accepted', 'partially_accepted', 'in_progress', 'rejected'], draft: ['presented', 'rejected'] };
  if (!allowed[to]!.includes(plan.status)) throw ApiError.conflict('INVALID_STATE_TRANSITION', `Cannot move plan from ${plan.status} to ${to}`);
  const from = plan.status;
  plan.status = to;
  if (to === 'draft') plan.set('presentedAt', undefined);
  await plan.save();
  await syncPlannedChart(auth, plan);
  await recordAudit({ action: 'status_change', entity: 'treatmentPlan', entityId: id, before: { status: from }, after: { status: to }, ...(reason ? { reason } : {}) });
  return planDto(plan);
}

/** Called when an appointment is booked with plannedItems (06 §3): items become `scheduled`. */
export async function markItemsScheduled(itemIds: string[], appointmentId: string) {
  if (!itemIds.length) return;
  const ids = itemIds.map((i) => new Types.ObjectId(i));
  const plans = await TreatmentPlanModel.find({ 'items._id': { $in: ids } });
  for (const p of plans) {
    for (const it of p.items) if (ids.some((x) => x.equals(it._id)) && it.status === 'accepted') {
      it.status = 'scheduled';
      it.appointmentId = new Types.ObjectId(appointmentId);
    }
    if (['accepted', 'partially_accepted'].includes(p.status)) p.status = 'in_progress';
    await p.save();
  }
}

/* ---------- performed procedures (07 §4) ---------- */

export type PerformInput = {
  patientId: string;
  appointmentId?: string;
  treatmentPlanItemId?: string;
  clinicProcedureId: string;
  toothNumbers?: number[];
  surfaces?: string[];
  dentistId?: string;
  assistantIds?: string[];
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  notes?: string;
  performedAt?: Date;
};

export function procedureDto(p: Record<string, unknown> & { _id: Types.ObjectId }) {
  const id = (v: unknown) => (v ? String(v) : undefined);
  return {
    id: String(p._id),
    patientId: String(p.patientId),
    appointmentId: id(p.appointmentId),
    treatmentPlanId: id(p.treatmentPlanId),
    treatmentPlanItemId: id(p.treatmentPlanItemId),
    clinicProcedureId: String(p.clinicProcedureId),
    code: p.code,
    category: p.category,
    toothNumbers: p.toothNumbers,
    surfaces: p.surfaces,
    dentistId: String(p.dentistId),
    assistantIds: ((p.assistantIds as Types.ObjectId[]) ?? []).map(String),
    performedAt: p.performedAt,
    quantity: p.quantity,
    unitPrice: p.unitPrice,
    discount: p.discount,
    status: p.status,
    voidReason: p.voidReason,
    invoiceId: id(p.invoiceId),
    invoiceIssued: Boolean(p.invoiceIssued),
    notes: p.notes ?? '',
  };
}

export async function listProcedures(auth: AuthContext, q: { patientId?: string; appointmentId?: string }) {
  const own = scopeFor(auth, 'clinical.chart.read') === 'own' ? { dentistId: new Types.ObjectId(auth.staffId) } : {};
  const rows = await PerformedProcedureModel.find({ ...(q.patientId ? { patientId: q.patientId } : {}), ...(q.appointmentId ? { appointmentId: q.appointmentId } : {}), ...own })
    .sort({ performedAt: -1 })
    .limit(300)
    .lean();
  return rows.map((r) => procedureDto(r as never));
}

export async function performProcedure(auth: AuthContext, b: PerformInput) {
  const dentistId = b.dentistId ?? auth.staffId;
  if (!dentistId) throw ApiError.validation([{ path: 'dentistId', code: 'required' }]);
  // `clinical.procedure.perform` is own-only: the dentist records their own work (07 §4).
  if (!auth.isOwner && dentistId !== auth.staffId) throw ApiError.forbidden('FORBIDDEN', 'You can only record your own procedures');
  const plan = b.treatmentPlanItemId ? await TreatmentPlanModel.findOne({ 'items._id': new Types.ObjectId(b.treatmentPlanItemId), patientId: b.patientId }) : null;
  if (b.treatmentPlanItemId && !plan) throw ApiError.validation([{ path: 'treatmentPlanItemId', code: 'not_found' }]);
  const item = plan?.items.find((i) => String(i._id) === b.treatmentPlanItemId);
  if (item?.status === 'completed') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'This plan item is already completed');
  const cov = await policyCoverage(plan?.insurancePolicyId ? String(plan.insurancePolicyId) : null).catch(() => null);
  const pr = await procedurePricing(b.clinicProcedureId, cov?.insuranceCompanyId);
  const teeth = b.toothNumbers ?? item?.toothNumbers ?? [];
  const surfaces = b.surfaces ?? item?.surfaces ?? [];
  assertTeeth(teeth, surfaces, { toothRequired: pr.toothRequired, surfacesRequired: pr.surfacesRequired });
  const defaultPrice = item?.unitPrice ?? pr.unitPrice;
  if (b.unitPrice !== undefined && b.unitPrice !== defaultPrice && !canDiscount(auth)) throw ApiError.forbidden('FIELD_FORBIDDEN', 'Changing the price needs discount rights', { fields: ['unitPrice'] });
  if ((b.discount ?? 0) > 0 && !canDiscount(auth)) throw ApiError.forbidden('FIELD_FORBIDDEN', 'Discounts need discount rights', { fields: ['discount'] });
  await assertConsent(b.patientId, pr.category);

  const clinicId = String(currentClinicId());
  const result = await withTransaction(async (session) => {
    const s = session ?? undefined;
    const [doc] = await PerformedProcedureModel.create(
      [
        {
          patientId: b.patientId,
          appointmentId: b.appointmentId,
          treatmentPlanId: plan?._id,
          treatmentPlanItemId: item?._id,
          clinicProcedureId: b.clinicProcedureId,
          code: pr.code,
          category: pr.category,
          toothNumbers: teeth,
          surfaces,
          dentistId,
          assistantIds: b.assistantIds ?? [],
          performedAt: b.performedAt ?? new Date(),
          quantity: b.quantity ?? item?.quantity ?? Math.max(1, teeth.length || 1),
          unitPrice: b.unitPrice ?? defaultPrice,
          discount: b.discount ?? item?.discount ?? 0,
          notes: b.notes ?? '',
        },
      ],
      { session: s },
    );
    for (const tooth of teeth) {
      await addEntry(auth, b.patientId, { toothNumber: tooth, surfaces, kind: 'completed', ...(pr.effect.addCondition ? { conditionCode: pr.effect.addCondition } : {}), ...(pr.effect.setStatus ? { setStatus: pr.effect.setStatus as 'missing' } : {}), ...(pr.effect.removeConditions ? { removeConditions: pr.effect.removeConditions } : {}), clinicProcedureId: b.clinicProcedureId, performedProcedureId: doc!._id, ...(b.appointmentId ? { appointmentId: b.appointmentId } : {}), ...(item ? { planItemId: String(item._id), treatmentPlanId: plan!._id } : {}) }, s);
    }
    if (plan && item) {
      item.status = 'completed';
      item.completedProcedureId = doc!._id;
      const accepted = plan.items.filter((i) => i.status !== 'rejected' && i.status !== 'proposed');
      plan.status = accepted.length && accepted.every((i) => i.status === 'completed') ? 'completed' : 'in_progress';
      await plan.save({ session: s });
    }
    onCommit(session, () => emit('procedure.completed', { clinicId, procedureId: String(doc!._id), patientId: b.patientId, ...(b.appointmentId ? { appointmentId: b.appointmentId } : {}) }));
    return doc!;
  });
  await recordAudit({ action: 'create', entity: 'performedProcedure', entityId: result._id, after: { code: pr.code, patientId: b.patientId, teeth, price: result.unitPrice } });
  return procedureDto(result.toObject() as never);
}

/** Consent gate (07 §10): `warn` lets it through, `strict` blocks without a signed consent. */
async function assertConsent(patientId: string, category: string) {
  const clinic = await runWithoutTenant(() => ClinicModel.findById(currentClinicId()).select('settings.consentMode').lean());
  const mode = (clinic?.settings as { consentMode?: string } | undefined)?.consentMode ?? 'off';
  if (mode !== 'strict') return;
  const { ConsentModel, ConsentTemplateModel } = await import('./clinical.models');
  const needs = await ConsentTemplateModel.exists({ isActive: true, procedureCategories: category });
  if (!needs) return;
  const has = await ConsentModel.exists({ patientId, procedureCategories: category });
  if (!has) throw ApiError.conflict('CONSENT_REQUIRED', 'A signed consent is required for this procedure', { category });
}

export async function voidProcedure(auth: AuthContext, id: string, reason: string) {
  const own = scopeFor(auth, 'clinical.procedure.void') === 'own' ? { dentistId: new Types.ObjectId(auth.staffId) } : {};
  const doc = await PerformedProcedureModel.findOne({ _id: id, ...own });
  if (!doc) throw ApiError.notFound();
  if (doc.status === 'voided') throw ApiError.conflict('INVALID_STATE_TRANSITION', 'Already voided');
  if (doc.invoiceIssued) throw ApiError.conflict('PROCEDURE_INVOICED', 'Issue a credit note before voiding');
  const { ChartEntryModel, ToothChartModel } = await import('./clinical.models');
  await withTransaction(async (session) => {
    const s = session ?? undefined;
    doc.status = 'voided';
    doc.voidReason = reason;
    doc.voidedAt = new Date();
    await doc.save({ session: s });
    const entries = await ChartEntryModel.find({ performedProcedureId: doc._id }).session(s ?? null);
    const chart = await ToothChartModel.findOne({ patientId: doc.patientId }).session(s ?? null);
    for (const e of entries) {
      e.voided = true;
      await e.save({ session: s });
      if (chart) {
        const t = (chart.teeth as Record<string, { status: string; conditions: { entryId: string }[] }>)[String(e.toothNumber)];
        if (t) {
          t.conditions = t.conditions.filter((c) => c.entryId !== String(e._id));
          if (e.setStatus && t.status === e.setStatus) t.status = 'present';
        }
      }
    }
    if (chart) {
      chart.markModified('teeth');
      await chart.save({ session: s });
    }
    if (doc.treatmentPlanItemId) {
      const plan = await TreatmentPlanModel.findOne({ 'items._id': doc.treatmentPlanItemId }).session(s ?? null);
      const it = plan?.items.find((i) => i._id.equals(doc.treatmentPlanItemId!));
      if (plan && it) {
        it.status = 'accepted';
        it.set('completedProcedureId', undefined);
        if (plan.status === 'completed') plan.status = 'in_progress';
        await plan.save({ session: s });
      }
    }
    onCommit(session, () => emit('procedure.voided', { clinicId: String(doc.clinicId), procedureId: id }));
  });
  await recordAudit({ action: 'status_change', entity: 'performedProcedure', entityId: id, reason });
  return procedureDto(doc.toObject() as never);
}
