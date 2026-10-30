import { logger } from '@/config/logger';
import { runInTenant, runWithoutTenant } from '@/core/tenancy/tenantPlugin';
import { MedicineModel, ProcedureCatalogModel, ToothConditionModel } from '@/modules/catalog/catalog.models';
import { MEDICINES, PROCEDURE_CATALOG, TOOTH_CONDITIONS } from '@/modules/catalog/procedureCatalog.seed';
import { registerClinicSeeder } from '@/modules/platform/onboarding.service';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { toSearchName } from '@/shared/validation/normalize';
import { AppointmentTypeModel, ChairModel, ClinicProcedureModel, TaxRateModel } from './clinic.models';

/** Default appointment types (names via `seed.appointmentType.<key>`). */
const DEFAULT_TYPES = [
  { systemKey: 'exam', code: 'EX', defaultDurationMin: 30, color: '#4F46E5', allowOnline: true },
  { systemKey: 'cleaning', code: 'CL', defaultDurationMin: 45, color: '#06B6D4', allowOnline: true },
  { systemKey: 'filling', code: 'FL', defaultDurationMin: 45, color: '#3B82F6', allowOnline: false },
  { systemKey: 'root_canal', code: 'RC', defaultDurationMin: 90, color: '#10B981', allowOnline: false },
  { systemKey: 'extraction', code: 'XT', defaultDurationMin: 45, color: '#EF4444', allowOnline: false },
  { systemKey: 'crown', code: 'CR', defaultDurationMin: 60, color: '#A855F7', allowOnline: false },
  { systemKey: 'ortho', code: 'OR', defaultDurationMin: 30, color: '#F59E0B', allowOnline: true },
  { systemKey: 'consultation', code: 'CO', defaultDurationMin: 20, color: '#0EA5E9', allowOnline: true },
  { systemKey: 'emergency', code: 'EM', defaultDurationMin: 30, color: '#DC2626', allowOnline: false },
];

registerClinicSeeder({
  name: 'clinic.defaults',
  run: async (_clinic, session) => {
    await AppointmentTypeModel.insertMany(DEFAULT_TYPES.map((t) => ({ ...t, name: null, searchName: t.systemKey })), { session });
    await TaxRateModel.insertMany(
      [
        { systemKey: 'exempt', name: null, rate: 0, jofotaraCategory: 'O', isDefault: true },
        { systemKey: 'zero', name: null, rate: 0, jofotaraCategory: 'Z' },
        { systemKey: 'standard', name: null, rate: 1600, jofotaraCategory: 'S' },
      ],
      { session },
    );
  },
});

/** Global catalogs: idempotent upsert of procedures, tooth conditions and medicines. */
export async function syncCatalogs(): Promise<void> {
  await runWithoutTenant(async () => {
    for (const p of PROCEDURE_CATALOG) {
      await ProcedureCatalogModel.updateOne(
        { code: p.code },
        {
          $set: { category: p.category, toothRequired: Boolean(p.toothRequired), surfacesRequired: Boolean(p.surfacesRequired), defaultDurationMin: p.minutes, suggestedPrice: p.price, labRequired: Boolean(p.labRequired), chartEffect: p.chartEffect, recall: p.recall },
          $setOnInsert: { name: null, isActive: true },
        },
        { upsert: true },
      );
    }
    for (const c of TOOTH_CONDITIONS) {
      await ToothConditionModel.updateOne({ code: c.code }, { $set: { color: c.color, appliesTo: c.appliesTo }, $setOnInsert: { name: null, isActive: true } }, { upsert: true });
    }
    for (const m of MEDICINES) {
      await MedicineModel.updateOne({ name: m.name }, { $set: { ...m, searchName: toSearchName(m.name) } }, { upsert: true });
    }
  });
  logger.info({ procedures: PROCEDURE_CATALOG.length }, 'catalogs synced');
}

/** Demo clinic: chairs and a starter price list. */
registerDemoSeeder({
  name: 'clinic.demo',
  order: 10,
  run: async (clinicId) => {
    await syncCatalogs();
    await runInTenant(clinicId, async () => {
      if ((await ChairModel.countDocuments({})) === 0) {
        await ChairModel.insertMany([
          { name: 'Chair 1', searchName: 'chair 1', roomName: 'Room A', color: '#4F46E5', sortOrder: 1 },
          { name: 'Chair 2', searchName: 'chair 2', roomName: 'Room A', color: '#06B6D4', sortOrder: 2 },
          { name: 'Chair 3', searchName: 'chair 3', roomName: 'Room B', color: '#10B981', sortOrder: 3 },
        ]);
      }
      if ((await AppointmentTypeModel.countDocuments({})) === 0) {
        await AppointmentTypeModel.insertMany(DEFAULT_TYPES.map((t) => ({ ...t, name: null, searchName: t.systemKey })));
      }
      if ((await TaxRateModel.countDocuments({})) === 0) {
        await TaxRateModel.insertMany([
          { systemKey: 'exempt', name: null, rate: 0, jofotaraCategory: 'O', isDefault: true },
          { systemKey: 'zero', name: null, rate: 0, jofotaraCategory: 'Z' },
          { systemKey: 'standard', name: null, rate: 1600, jofotaraCategory: 'S' },
        ]);
      }
      if ((await ClinicProcedureModel.countDocuments({})) === 0) {
        const tax = await TaxRateModel.findOne({ isDefault: true }).lean();
        const catalog = await runWithoutTenant(() => ProcedureCatalogModel.find({}).lean());
        await ClinicProcedureModel.insertMany(
          catalog.map((c) => ({
            catalogId: c._id,
            code: c.code,
            name: null,
            systemKey: c.code,
            searchName: toSearchName(c.code),
            category: c.category,
            price: c.suggestedPrice,
            taxRateId: tax?._id,
            defaultDurationMin: c.defaultDurationMin,
            toothRequired: c.toothRequired,
            surfacesRequired: c.surfacesRequired,
            labRequired: c.labRequired,
            chartEffect: c.chartEffect,
            recall: c.recall,
          })),
        );
      }
    });
  },
});
