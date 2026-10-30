import type { AuthContext } from '@/core/auth/auth.types';
import { requestContext } from '@/core/context/requestContext';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { TaxRateModel } from '@/modules/clinic/clinic.models';
import { PerformedProcedureModel } from '@/modules/clinical/clinical.models';
import { registerClinicSeeder } from '@/modules/platform/onboarding.service';
import { StaffModel } from '@/modules/staff/staff.model';
import { registerDemoSeeder } from '@/scripts/seedDemo';
import { AccountModel, SupplierModel } from './accounting.models';
import { clinicToday, ensureLedger } from './journal.service';

/** Links VAT accounts to tax rates that have none yet. */
async function linkTaxAccounts(session?: import('mongoose').ClientSession) {
  const [out, inp] = await Promise.all([AccountModel.findOne({ systemKey: 'VAT_OUTPUT' }).session(session ?? null).lean(), AccountModel.findOne({ systemKey: 'VAT_INPUT' }).session(session ?? null).lean()]);
  if (!out || !inp) return;
  await TaxRateModel.updateMany({ outputAccountId: null }, { $set: { outputAccountId: out._id, inputAccountId: inp._id } }, { session });
}

registerClinicSeeder({
  name: 'accounting.ledger',
  run: async (_clinic, session) => {
    await ensureLedger(session);
    await linkTaxAccounts(session);
  },
});

/** Demo clinic: ledger, a lab supplier, issued + paid visits, an expense — so reports have data. */
registerDemoSeeder({
  name: 'accounting.demo',
  order: 50,
  run: async (clinicId) => {
    await runInTenant(clinicId, async () => {
      await ensureLedger();
      await linkTaxAccounts();
      if (await SupplierModel.exists({})) return;
      const owner = await StaffModel.findOne({ isOwner: true }).lean();
      if (!owner) return;
      const auth = { userId: String(owner.userId), staffId: String(owner._id), clinicId, kind: 'staff', isOwner: true, isRoot: false, permVersion: 0, readOnly: false, grants: {}, tokenId: 'seed' } as AuthContext;
      await requestContext.run({ clinicId, userId: auth.userId, staffId: auth.staffId }, async () => {
        const inv = await import('@/modules/billing/invoice.service');
        const pay = await import('@/modules/billing/payment.service');
        const ops = await import('./operations.service');
        await SupplierModel.create([
          { name: 'Amman Dental Lab', searchName: 'amman dental lab', kind: 'lab' },
          { name: 'MedSupply Jordan', searchName: 'medsupply jordan', kind: 'supplies' },
        ]);
        // Drafts for demo work done, issue them, take a cash and a card payment.
        for (const p of await PerformedProcedureModel.find({ status: 'completed', invoiceId: null }).lean()) await inv.addProcedureToDraft(String(p._id));
        const { InvoiceModel } = await import('@/modules/billing/billing.models');
        const drafts = await InvoiceModel.find({ status: 'draft' }).lean();
        await pay.openCashSession(auth, 50_000);
        for (const [i, d] of drafts.entries()) {
          const issued = await inv.issueInvoice(auth, String(d._id));
          if (!issued.patientDue) continue;
          await pay.recordPayment(auth, { payerType: 'patient', patientId: String(d.patientId), method: i % 2 ? 'card' : 'cash', amount: i % 2 ? issued.patientDue : Math.round(issued.patientDue / 2), autoAllocate: true });
        }
        const today = await clinicToday();
        const [rent, bank] = await Promise.all([AccountModel.findOne({ code: '6200' }).lean(), AccountModel.findOne({ systemKey: 'BANK_DEFAULT' }).lean()]);
        if (rent && bank) await ops.createExpense(auth, { date: today, categoryAccountId: String(rent._id), amount: 450_000, paidFromAccountId: String(bank._id), payee: 'Landlord', description: 'Monthly rent' });
      });
    });
  },
});
