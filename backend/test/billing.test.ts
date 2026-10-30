import { beforeEach, describe, expect, it } from 'vitest';
import { runInTenant } from '@/core/tenancy/tenantPlugin';
import { syncCatalogs } from '@/modules/clinic/clinic.seeders';
import { FiscalPeriodModel, JournalEntryModel } from '@/modules/accounting/accounting.models';
import { localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

useTestDb();
let c: TestClinic;
let owner: Session;
let reception: Session;
let accountant: Session;
let patientId: string;
const today = () => localDate(new Date(), 'Asia/Amman');

beforeEach(async () => {
  resetState();
  c = await makeClinic('bill');
  owner = await login(c.ownerEmail);
  reception = await login(c.staff.reception!.email);
  accountant = await login(c.staff.accountant!.email);
  const p = await api(reception).post('/patients').send({ name: { first: 'Rami', family: 'Nasser' }, phone: '0791234511' });
  patientId = p.body.data.id;
});

async function draft(amount = 100_000, s = owner) {
  const res = await api(s).post('/invoices').send({ patientId, lines: [{ description: 'Composite filling', quantity: 1, unitPrice: amount }] });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; total: number };
}

async function trialBalance() {
  const tb = await api(accountant).get('/reports/trial-balance');
  expect(tb.status).toBe(200);
  return tb.body.data as { balanced: boolean; rows: { systemKey?: string; debitBalance: number; creditBalance: number }[] };
}
const arPatients = (tb: Awaited<ReturnType<typeof trialBalance>>) => {
  const r = tb.rows.find((x) => x.systemKey === 'AR_PATIENTS');
  return (r?.debitBalance ?? 0) - (r?.creditBalance ?? 0);
};

describe('ledger scenario', () => {
  it('issue → partial pay → pay rest → credit note → refund keeps the books balanced and AR at zero', async () => {
    await api(reception).post('/cash-sessions/open').send({ openingFloat: 20_000 });
    const inv = await draft(100_000);
    const issued = await api(owner).post(`/invoices/${inv.id}/issue`).send({});
    expect(issued.status).toBe(200);
    expect(issued.body.data.number).toMatch(/^INV-\d{4}-000001$/);
    expect(issued.body.data.status).toBe('issued');

    const p1 = await api(reception).post('/payments').set('Idempotency-Key', 'k-1').send({ patientId, method: 'cash', amount: 40_000, allocations: [{ invoiceId: inv.id, amount: 40_000 }] });
    expect(p1.status).toBe(201);
    expect(p1.body.data.receiptNumber).toMatch(/^RCPT-/);
    const p2 = await api(reception).post('/payments').send({ patientId, method: 'card', amount: 60_000, autoAllocate: true });
    expect(p2.body.data.unallocated).toBe(0);
    expect((await api(owner).get(`/invoices/${inv.id}`)).body.data.status).toBe('paid');

    // Credit 30.000 after full payment → becomes patient credit, then refunded.
    const cn = await api(owner).post(`/invoices/${inv.id}/credit-notes`).send({ amount: 30_000, reason: 'Goodwill' });
    expect(cn.status).toBe(201);
    expect(cn.body.data.type).toBe('credit_note');
    const summary = await api(reception).get(`/patients/${patientId}/billing-summary`);
    expect(summary.body.data.balance).toBe(-30_000);

    let tb = await trialBalance();
    expect(tb.balanced).toBe(true);

    // Refund the credit from the card payment (unallocated credit lives on the ledger, not the payment).
    const refundPayment = await api(reception).post('/payments').send({ patientId, method: 'cash', amount: 1, autoAllocate: false });
    expect(refundPayment.body.data.unallocated).toBe(1);
    const ref = await api(owner).post(`/payments/${p2.body.data.id}/refund`).send({ amount: 30_000, reason: 'Goodwill refund' });
    expect(ref.status).toBe(200);
    expect(ref.body.data.status).toBe('partially_refunded');

    tb = await trialBalance();
    expect(tb.balanced).toBe(true);
    expect(arPatients(tb)).toBe(0);
    expect((await api(reception).get(`/patients/${patientId}/billing-summary`)).body.data.balance).toBe(-1);
  });

  it('idempotency: same key twice gives one payment and one journal', async () => {
    await api(reception).post('/cash-sessions/open').send({ openingFloat: 0 });
    const a = await api(reception).post('/payments').set('Idempotency-Key', 'same').send({ patientId, method: 'cash', amount: 5_000 });
    const b = await api(reception).post('/payments').set('Idempotency-Key', 'same').send({ patientId, method: 'cash', amount: 5_000 });
    expect(b.body.data.id).toBe(a.body.data.id);
    const n = await runInTenant(c.clinicId, () => JournalEntryModel.countDocuments({ source: 'payment' }));
    expect(n).toBe(1);
  });

  it('two simultaneous issues of one draft: one number, one journal', async () => {
    const inv = await draft(50_000);
    const [x, y] = await Promise.all([api(owner).post(`/invoices/${inv.id}/issue`).send({}), api(owner).post(`/invoices/${inv.id}/issue`).send({})]);
    expect([x.status, y.status].every((s) => s === 200 || s === 409)).toBe(true);
    const n = await runInTenant(c.clinicId, () => JournalEntryModel.countDocuments({ source: 'invoice', sourceId: inv.id }));
    expect(n).toBe(1);
    const again = await api(owner).post(`/invoices/${inv.id}/issue`).send({});
    expect(again.body.data.number).toMatch(/^INV-\d{4}-000001$/);
  });

  it('cash needs an open drawer; closing posts over/short', async () => {
    expect((await api(reception).post('/payments').send({ patientId, method: 'cash', amount: 1_000 })).body.error.code).toBe('CASH_SESSION_REQUIRED');
    await api(reception).post('/cash-sessions/open').send({ openingFloat: 10_000 });
    expect((await api(reception).post('/cash-sessions/open').send({ openingFloat: 0 })).body.error.code).toBe('CASH_SESSION_ALREADY_OPEN');
    await api(reception).post('/payments').send({ patientId, method: 'cash', amount: 5_000 });
    const close = await api(reception).post('/cash-sessions/close').send({ countedAmount: 14_000 });
    expect(close.body.data).toMatchObject({ expected: 15_000, difference: -1_000 });
    expect((await trialBalance()).balanced).toBe(true);
  });

  it('void only without payments; then credit notes are required', async () => {
    const inv = await draft(20_000);
    await api(owner).post(`/invoices/${inv.id}/issue`).send({});
    const v = await api(owner).post(`/invoices/${inv.id}/void`).send({ reason: 'wrong patient' });
    expect(v.body.data.status).toBe('void');
    const inv2 = await draft(20_000);
    await api(owner).post(`/invoices/${inv2.id}/issue`).send({});
    await api(reception).post('/payments').send({ patientId, method: 'card', amount: 5_000, autoAllocate: true });
    expect((await api(owner).post(`/invoices/${inv2.id}/void`).send({ reason: 'x' })).body.error.code).toBe('INVOICE_HAS_PAYMENTS');
    expect((await api(owner).patch(`/invoices/${inv2.id}`).send({ notes: 'x' })).body.error.code).toBe('INVOICE_NOT_DRAFT');
    expect((await trialBalance()).balanced).toBe(true);
  });

  it('closed period → 423; reversal of a reversal is refused; manual control accounts are blocked', async () => {
    const accounts = (await api(accountant).get('/accounts')).body.data as { id: string; code: string; systemKey?: string }[];
    const rent = accounts.find((a) => a.code === '6200')!;
    const bank = accounts.find((a) => a.systemKey === 'BANK_DEFAULT')!;
    const ar = accounts.find((a) => a.systemKey === 'AR_PATIENTS')!;
    const j = await api(owner).post('/journals').send({ date: today(), memo: 'Rent accrual', lines: [{ accountId: rent.id, debit: 1_000, credit: 0 }, { accountId: bank.id, debit: 0, credit: 1_000 }] });
    expect(j.status).toBe(201);
    const posted = await api(owner).post(`/journals/${j.body.data.id}/post`);
    expect(posted.body.data.status).toBe('posted');
    const rev = await api(owner).post(`/journals/${posted.body.data.id}/reverse`).send({ reason: 'typo' });
    expect(rev.status).toBe(200);
    expect((await api(owner).post(`/journals/${rev.body.data.id}/reverse`).send({ reason: 'again' })).body.error.code).toBe('JOURNAL_REVERSAL_OF_REVERSAL');
    const ctl = await api(owner).post('/journals').send({ date: today(), memo: 'x', lines: [{ accountId: ar.id, debit: 1_000, credit: 0 }, { accountId: bank.id, debit: 0, credit: 1_000 }] });
    expect((await api(owner).post(`/journals/${ctl.body.data.id}/post`)).body.error.code).toBe('JOURNAL_CONTROL_ACCOUNT');

    const period = await runInTenant(c.clinicId, () => FiscalPeriodModel.findOne({ startDate: { $lte: today() }, endDate: { $gte: today() } }).lean());
    await api(owner).post(`/fiscal-periods/${String(period!._id)}/status`).send({ status: 'closed' });
    const inv = await draft(10_000);
    const blocked = await api(owner).post(`/invoices/${inv.id}/issue`).send({});
    expect(blocked.status).toBe(423);
    expect(blocked.body.error.code).toBe('PERIOD_CLOSED');
    expect((await api(owner).post(`/fiscal-periods/${String(period!._id)}/status`).send({ status: 'open' })).status).toBe(422);
    await api(owner).post(`/fiscal-periods/${String(period!._id)}/status`).send({ status: 'open', reason: 'late invoice' });
    expect((await api(owner).post(`/invoices/${inv.id}/issue`).send({})).status).toBe(200);
  });

  it('suppliers: bill → post → pay; expense; reports respond and balance', async () => {
    const accounts = (await api(accountant).get('/accounts')).body.data as { id: string; code: string; systemKey?: string }[];
    const lab = accounts.find((a) => a.systemKey === 'LAB_COST')!;
    const bank = accounts.find((a) => a.systemKey === 'BANK_DEFAULT')!;
    const sup = await api(accountant).post('/suppliers').send({ name: 'Amman Lab', kind: 'lab' });
    expect(sup.status).toBe(201);
    const bill = await api(accountant).post('/supplier-bills').send({ supplierId: sup.body.data.id, billDate: today(), lines: [{ description: 'Crown 16', expenseAccountId: lab.id, amount: 45_000 }] });
    expect(bill.status).toBe(201);
    expect((await api(accountant).post(`/supplier-bills/${bill.body.data.id}/post`)).body.data.status).toBe('posted');
    const sp = await api(accountant).post('/supplier-payments').send({ supplierId: sup.body.data.id, amount: 45_000, method: 'bank_transfer', paidFromAccountId: bank.id });
    expect(sp.status).toBe(201);
    const ap = await api(accountant).get('/reports/ap-aging');
    expect(ap.body.data.totals.total).toBe(0);
    const exp = await api(accountant).post('/expenses').send({ date: today(), categoryAccountId: accounts.find((a) => a.code === '6300')!.id, amount: 30_000, paidFromAccountId: bank.id, payee: 'Electric co.' });
    expect(exp.status).toBe(201);

    const inv = await draft(80_000);
    await api(owner).post(`/invoices/${inv.id}/issue`).send({});
    const from = `${today().slice(0, 7)}-01`;
    const pl = await api(accountant).get(`/reports/profit-loss?from=${from}&to=${today()}`);
    expect(pl.body.data.totalRevenue).toBe(80_000);
    expect(pl.body.data.totalExpense).toBe(75_000);
    const bs = await api(accountant).get('/reports/balance-sheet');
    expect(bs.body.data.balanced).toBe(true);
    const aging = await api(accountant).get('/reports/ar-aging');
    expect(aging.body.data.totals.total).toBe(80_000);
    const st = await api(accountant).get(`/reports/patient-statement?patientId=${patientId}&from=${from}&to=${today()}`);
    expect(st.body.data.closing).toBe(80_000);
    expect((await trialBalance()).balanced).toBe(true);
  });

  it('insurance: split invoice, claim, partial approval re-billed to the patient, insurer payment', async () => {
    const company = await api(owner).post('/insurance-companies').send({ name: 'Jordan Insurance', defaultCoveragePercent: 80 });
    const policy = await api(owner).post(`/patients/${patientId}/insurance-policies`).send({ insuranceCompanyId: company.body.data.id, memberNumber: 'M-1', isPrimary: true });
    expect(policy.status).toBe(201);
    const inv = await api(owner).post('/invoices').send({ patientId, insurancePolicyId: policy.body.data.id, lines: [{ description: 'Root canal', unitPrice: 200_000 }] });
    expect(inv.body.data.insuranceTotal).toBe(160_000);
    expect(inv.body.data.patientTotal).toBe(40_000);
    await api(owner).post(`/invoices/${inv.body.data.id}/issue`).send({});
    const claim = await api(owner).post('/insurance-claims').send({ invoiceIds: [inv.body.data.id] });
    expect(claim.body.data.claimedAmount).toBe(160_000);
    await api(owner).post(`/insurance-claims/${claim.body.data.id}/status`).send({ to: 'submitted' });
    const resp = await api(owner).post(`/insurance-claims/${claim.body.data.id}/status`).send({ to: 'approved', approvedAmount: 150_000, shortfallMode: 'rebill' });
    expect(resp.body.data.status).toBe('partially_approved');
    const insPay = await api(owner).post('/payments').send({ payerType: 'insurance', insuranceCompanyId: company.body.data.id, claimId: claim.body.data.id, method: 'bank_transfer', amount: 150_000 });
    expect(insPay.status).toBe(201);
    const after = (await api(owner).get(`/invoices/${inv.body.data.id}`)).body.data;
    expect(after.patientDue).toBe(50_000);
    expect(after.insuranceDue).toBe(0);
    expect((await api(owner).get('/insurance-claims')).body.data[0].status).toBe('paid');
    expect((await trialBalance()).balanced).toBe(true);
  });

  it('performed procedures become draft invoice lines automatically', async () => {
    await syncCatalogs();
    await api(owner).post('/procedures/import-from-catalog').send({ codes: ['D1110'] });
    const procs = (await api(owner).get('/procedures?limit=10')).body.data as { id: string; code: string }[];
    const dentist = await login(c.staff.dentist!.email);
    await api(owner).patch(`/patients/${patientId}`).send({ preferredDentistId: c.staff.dentist!.staffId, version: 0 });
    const done = await api(dentist).post('/performed-procedures').send({ patientId, clinicProcedureId: procs.find((p) => p.code === 'D1110')!.id });
    expect(done.status).toBe(201);
    const drafts = (await api(owner).get(`/invoices?patientId=${patientId}&status=draft`)).body.data;
    expect(drafts).toHaveLength(1);
    expect(drafts[0].lines[0].performedProcedureId).toBe(done.body.data.id);
  });
});
