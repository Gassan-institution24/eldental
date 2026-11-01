import { beforeEach, describe, expect, it } from 'vitest';
import { syncCatalogs } from '@/modules/clinic/clinic.seeders';
import { localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Doctor attribution, own-scope privacy and doctor validation on invoices (04 §3, 09 §3.1, §8.1). */
useTestDb();
let c: TestClinic;
let owner: Session;
let docA: Session;
let docB: Session;
let reception: Session;
let accountant: Session;
let patientId: string;
const proc: Record<string, string> = {};
const today = () => localDate(new Date(), 'Asia/Amman');
const A = () => c.staff.dentist!.staffId;
const B = () => c.staff.dentist2!.staffId;

beforeEach(async () => {
  resetState();
  await syncCatalogs();
  c = await makeClinic('doc');
  owner = await login(c.ownerEmail);
  docA = await login(c.staff.dentist!.email);
  docB = await login(c.staff.dentist2!.email);
  reception = await login(c.staff.reception!.email);
  accountant = await login(c.staff.accountant!.email);
  await api(owner).post('/procedures/import-from-catalog').send({ codes: ['D1110', 'D0120'] });
  for (const p of (await api(owner).get('/procedures?limit=100')).body.data as { code: string; id: string }[]) proc[p.code] = p.id;
  const p = await api(reception).post('/patients').send({ name: { first: 'Lina', family: 'Haddad' }, phone: '0791234522' });
  patientId = p.body.data.id;
});

/** Dr A does a 10.000 procedure (D0120) and Dr B a 30.000 one (D1110, catalog prices, 0% tax) on one draft. */
async function sharedInvoice() {
  expect((await api(owner).post('/performed-procedures').send({ patientId, dentistId: A(), clinicProcedureId: proc.D0120 })).status).toBe(201);
  expect((await api(owner).post('/performed-procedures').send({ patientId, dentistId: B(), clinicProcedureId: proc.D1110 })).status).toBe(201);
  const drafts = await api(reception).get(`/invoices?patientId=${patientId}&status=draft`);
  expect(drafts.body.data).toHaveLength(1);
  const draft = drafts.body.data[0] as { id: string; lines: { lineTotal: number; dentistId: string }[] };
  expect(draft.lines.map((l) => [l.dentistId, l.lineTotal]).sort()).toEqual([[A(), 10_000], [B(), 30_000]].sort());
  const issued = await api(reception).post(`/invoices/${draft.id}/issue`).send({});
  expect(issued.status).toBe(200);
  return issued.body.data as { id: string; total: number };
}

async function manualInvoice(dentistId: string, amount: number) {
  const d = await api(accountant).post('/invoices').send({ patientId, dentistId, lines: [{ description: 'Whitening', quantity: 1, unitPrice: amount, taxRateId: null }] });
  expect(d.status).toBe(201);
  expect((await api(accountant).post(`/invoices/${d.body.data.id}/issue`).send({})).status).toBe(200);
  return d.body.data as { id: string };
}

const pay = (amount: number, invoiceId: string, key: string) =>
  api(reception).post('/payments').set('Idempotency-Key', key).send({ patientId, method: 'card', amount, allocations: [{ invoiceId, amount }] });

async function production(s: Session) {
  const res = await api(s).get(`/reports/production?from=${today()}&to=${today()}`);
  expect(res.status).toBe(200);
  return res.body.data as { rows: { dentistId: string; collection: number; production: number }[]; scope: string };
}
const coll = (rows: { dentistId: string; collection: number }[], id: string) => rows.find((r) => r.dentistId === id)?.collection ?? 0;

describe('shared invoices and own scope', () => {
  it('a doctor sees invoices with their work (in full) and never unrelated ones', async () => {
    const shared = await sharedInvoice();
    const onlyB = await manualInvoice(B(), 30_000);

    const seen = await api(docA).get(`/invoices/${shared.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.data.lines).toHaveLength(2);
    expect(seen.body.data.multipleDoctors).toBe(true);
    expect(seen.body.data.doctors.map((d: { name: string }) => d.name).sort()).toEqual(['Dentist One', 'Dentist Two']);
    expect(seen.body.data.lines.find((l: { dentistId: string }) => l.dentistId === B()).dentistName).toBe('Dentist Two');

    expect((await api(docA).get(`/invoices/${onlyB.id}`)).status).toBe(404);
    const listA = await api(docA).get('/invoices');
    expect(listA.body.data.map((i: { id: string }) => i.id)).toEqual([shared.id]);
    const listB = await api(docB).get('/invoices');
    expect(listB.body.data.map((i: { id: string }) => i.id).sort()).toEqual([shared.id, onlyB.id].sort());

    // Seeing a shared invoice gives no right to change it.
    expect((await api(docA).post(`/invoices/${shared.id}/void`).send({ reason: 'x' })).status).toBe(403);
    expect((await api(docA).patch(`/invoices/${shared.id}`).send({ notes: 'x' })).status).toBe(403);
  });

  it('the doctor filter matches the header doctor or any line doctor and ANDs with own scope', async () => {
    const shared = await sharedInvoice();
    const onlyB = await manualInvoice(B(), 30_000);
    const byA = await api(reception).get(`/invoices?dentistId=${A()}`);
    expect(byA.body.data.map((i: { id: string }) => i.id)).toEqual([shared.id]);
    const byB = await api(reception).get(`/invoices?dentistId=${B()}`);
    expect(byB.body.data.map((i: { id: string }) => i.id).sort()).toEqual([shared.id, onlyB.id].sort());
    // Own scope cannot be widened through the filter.
    expect((await api(docA).get(`/invoices?dentistId=${B()}`)).body.data.map((i: { id: string }) => i.id)).toEqual([shared.id]);
  });

  it('GET /billing/dentists returns only id + name; own-scope doctors get themselves', async () => {
    const all = await api(reception).get('/billing/dentists');
    expect(all.status).toBe(200);
    expect(all.body.data.map((d: { name: string }) => d.name).sort()).toEqual(['Dentist One', 'Dentist Two']);
    expect(Object.keys(all.body.data[0]).sort()).toEqual(['id', 'name']);
    expect((await api(docA).get('/billing/dentists')).body.data).toEqual([{ id: A(), name: 'Dentist One' }]);
  });
});

describe('doctor validation (G5) and locked procedure doctors', () => {
  it('rejects non-dentists, inactive and other-clinic doctors, and issuing without a doctor', async () => {
    const bad = await api(accountant).post('/invoices').send({ patientId, dentistId: c.staff.reception!.staffId, lines: [{ description: 'x', unitPrice: 1_000 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields[0]).toMatchObject({ path: 'dentistId', code: 'not_dentist' });

    const other = await makeClinic('doc2');
    const cross = await api(accountant).post('/invoices').send({ patientId, dentistId: other.staff.dentist!.staffId, lines: [{ description: 'x', unitPrice: 1_000 }] });
    expect(cross.body.error.details.fields[0].code).toBe('not_dentist');
    const crossLine = await api(accountant).post('/invoices').send({ patientId, dentistId: A(), lines: [{ description: 'x', unitPrice: 1_000, dentistId: other.staff.dentist!.staffId }] });
    expect(crossLine.body.error.details.fields[0]).toMatchObject({ path: 'lines.0.dentistId', code: 'not_dentist' });

    const noDoctor = await api(accountant).post('/invoices').send({ patientId, lines: [{ description: 'x', unitPrice: 1_000 }] });
    expect(noDoctor.status).toBe(201);
    const issue = await api(reception).post(`/invoices/${noDoctor.body.data.id}/issue`).send({});
    expect(issue.status).toBe(409);
    expect(issue.body.error.code).toBe('DENTIST_REQUIRED');

    // A doctor who left can't be the responsible doctor of a new invoice.
    await api(owner).post(`/staff/${B()}/deactivate`).send({ status: 'inactive' });
    expect((await api(accountant).post('/invoices').send({ patientId, dentistId: B(), lines: [{ description: 'x', unitPrice: 1_000 }] })).body.error.details.fields[0].code).toBe('not_dentist');
  });

  it('manual lines default to the header doctor; procedure lines keep their performer', async () => {
    const d = await api(accountant).post('/invoices').send({ patientId, dentistId: B(), lines: [{ description: 'x', unitPrice: 1_000 }, { description: 'y', unitPrice: 2_000, dentistId: A() }] });
    expect(d.body.data.lines.map((l: { dentistId: string }) => l.dentistId)).toEqual([B(), A()]);
    expect(d.body.data.lines.every((l: { dentistLocked: boolean }) => !l.dentistLocked)).toBe(true);

    await api(owner).post('/performed-procedures').send({ patientId, dentistId: A(), clinicProcedureId: proc.D0120 });
    const draft = (await api(reception).get(`/invoices?patientId=${patientId}&status=draft`)).body.data.find((i: { lines: { performedProcedureId?: string }[] }) => i.lines.some((l) => l.performedProcedureId));
    const line = draft.lines.find((l: { performedProcedureId?: string }) => l.performedProcedureId);
    expect(line.dentistLocked).toBe(true);
    const others = draft.lines.filter((l: { id: string }) => l.id !== line.id).map((l: { id: string; description: string; unitPrice: number }) => ({ id: l.id, description: l.description, unitPrice: l.unitPrice }));
    const moved = await api(reception).patch(`/invoices/${draft.id}`).send({ version: draft.version, lines: [...others, { id: line.id, dentistId: B() }] });
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe('PROCEDURE_DENTIST_LOCKED');
    // Re-saving the line without touching the doctor keeps the performer and the procedure link.
    const kept = await api(reception).patch(`/invoices/${draft.id}`).send({ version: draft.version, lines: [...others, { id: line.id, quantity: 1 }] });
    expect(kept.status).toBe(200);
    expect(kept.body.data.lines.find((l: { id: string }) => l.id === line.id)).toMatchObject({ dentistId: A(), performedProcedureId: line.performedProcedureId });
  });
});

describe('collection attribution (09 §8.1)', () => {
  it('splits payments by each doctor\'s work, through partial and multiple payments, refunds and credit notes', async () => {
    const inv = await sharedInvoice();
    expect(inv.total).toBe(40_000);
    expect((await pay(8_000, inv.id, 'p1')).status).toBe(201);
    const p2 = await pay(12_000, inv.id, 'p2');
    let rows = (await production(owner)).rows;
    expect(coll(rows, A())).toBe(5_000);
    expect(coll(rows, B())).toBe(15_000);

    // Credit notes scale every line, so the weights don't change.
    expect((await api(owner).post(`/invoices/${inv.id}/credit-notes`).send({ amount: 4_000, reason: 'goodwill' })).status).toBe(201);
    rows = (await production(owner)).rows;
    expect(coll(rows, A()) + coll(rows, B())).toBe(20_000);

    // A refund taken back from the invoice reduces both doctors in the same proportion.
    expect((await api(owner).post(`/payments/${p2.body.data.id}/refund`).send({ amount: 4_000, reason: 'overpaid' })).status).toBe(200);
    rows = (await production(accountant)).rows;
    expect(coll(rows, A())).toBe(4_000);
    expect(coll(rows, B())).toBe(12_000);

    // Reconciles with the money actually kept: payments minus refunds.
    const pays = (await api(accountant).get('/payments')).body.data as { amount: number; refunded?: number }[];
    const kept = pays.reduce((a, p) => a + p.amount - (p.refunded ?? 0), 0);
    expect(rows.reduce((a, r) => a + r.collection, 0)).toBe(kept);
  });

  it('one doctor gets all of their own invoice; voided invoices collect nothing', async () => {
    const solo = await manualInvoice(A(), 33_333);
    await pay(33_333, solo.id, 's1');
    const voided = await manualInvoice(B(), 10_000);
    expect((await api(owner).post(`/invoices/${voided.id}/void`).send({ reason: 'wrong patient' })).status).toBe(200);
    const rows = (await production(owner)).rows;
    expect(coll(rows, A())).toBe(33_333);
    expect(coll(rows, B())).toBe(0);
  });
});

describe('own-scope reports (G1–G3)', () => {
  it('doctors only see their own production row, AR share, statement and receivables; owner and accountant see all', async () => {
    const shared = await sharedInvoice();
    await pay(20_000, shared.id, 'r1');
    const onlyB = await manualInvoice(B(), 30_000);

    const mine = await production(docA);
    expect(mine.scope).toBe('own');
    expect(mine.rows.map((r) => r.dentistId)).toEqual([A()]);
    expect(mine.rows[0]).toMatchObject({ production: 10_000, collection: 5_000 });
    const all = await production(owner);
    expect(all.rows.map((r) => r.dentistId).sort()).toEqual([A(), B()].sort());
    expect((await production(accountant)).rows).toHaveLength(2);

    // AR aging: Dr A's share of the shared invoice only (20.000 open × 25%); nothing of Dr B's invoice.
    const arA = await api(docA).get('/reports/ar-aging');
    expect(arA.status).toBe(200);
    expect(arA.body.data.totals.total).toBe(5_000);
    expect((await api(accountant).get('/reports/ar-aging')).body.data.totals.total).toBe(50_000);

    // Statement: only invoices with Dr A's work.
    const stA = await api(docA).get(`/reports/patient-statement?patientId=${patientId}&from=${today()}&to=${today()}`);
    expect(stA.status).toBe(200);
    expect(stA.body.data.scope).toBe('own');
    expect(stA.body.data.lines.map((l: { number?: string }) => l.number)).not.toContain((await api(owner).get(`/invoices/${onlyB.id}`)).body.data.number);
    expect(stA.body.data.closing).toBe(20_000);
    const stAll = await api(accountant).get(`/reports/patient-statement?patientId=${patientId}&from=${today()}&to=${today()}`);
    expect(stAll.body.data.closing).toBe(50_000);

    // Dashboard receivables and the patient billing summary follow the same rule.
    const dashA = await api(docA).get('/dashboard');
    expect(dashA.body.data.receivables).toMatchObject({ patients: 5_000, scope: 'own' });
    expect((await api(owner).get('/dashboard')).body.data.receivables).toMatchObject({ patients: 50_000, scope: 'all' });
    const sumA = await api(docA).get(`/patients/${patientId}/billing-summary`);
    expect(sumA.body.data).toMatchObject({ scope: 'own', balance: 5_000, credits: [] });
    expect(sumA.body.data.openInvoices.map((i: { id: string }) => i.id)).toEqual([shared.id]);
  });
});

describe('deactivated doctors keep their history', () => {
  it('a departed doctor keeps procedure, line and collection attribution; billing picks an active responsible doctor', async () => {
    const done = await api(owner).post('/performed-procedures').send({ patientId, dentistId: B(), clinicProcedureId: proc.D1110 });
    expect(done.status).toBe(201);
    expect((await api(owner).post(`/staff/${B()}/deactivate`).send({ status: 'inactive' })).status).toBe(200);

    const draft = (await api(reception).get(`/invoices?patientId=${patientId}&status=draft`)).body.data[0];
    expect(draft.dentistId).toBe(B());
    expect((await api(reception).post(`/invoices/${draft.id}/issue`).send({})).body.error.code).toBe('DENTIST_REQUIRED');
    const moved = await api(reception).patch(`/invoices/${draft.id}`).send({ version: draft.version, dentistId: A() });
    expect(moved.status).toBe(200);
    // The header changed; the procedure line did not.
    expect(moved.body.data.lines[0]).toMatchObject({ dentistId: B(), dentistLocked: true });
    const issued = await api(reception).post(`/invoices/${draft.id}/issue`).send({});
    expect(issued.status).toBe(200);
    await pay(30_000, draft.id, 'dep1');

    const procs = (await api(owner).get(`/performed-procedures?patientId=${patientId}`)).body.data as { id: string; dentistId: string }[];
    expect(procs.find((p) => p.id === done.body.data.id)?.dentistId).toBe(B());
    const rows = (await production(owner)).rows;
    expect(rows.find((r) => r.dentistId === B())).toMatchObject({ production: 30_000, collection: 30_000 });
    expect(coll(rows, A())).toBe(0);
  });
});

describe('correcting the doctor of a procedure (void and record again)', () => {
  it('keeps the voided record and its audit trail, charges once, and attributes to the right doctor', async () => {
    const wrong = await api(owner).post('/performed-procedures').send({ patientId, dentistId: B(), clinicProcedureId: proc.D0120 });
    const voided = await api(owner).post(`/performed-procedures/${wrong.body.data.id}/void`).send({ reason: 'recorded under the wrong doctor' });
    expect(voided.status).toBe(200);
    const right = await api(owner).post('/performed-procedures').send({ patientId, dentistId: A(), clinicProcedureId: proc.D0120 });
    expect(right.status).toBe(201);

    const drafts = (await api(reception).get(`/invoices?patientId=${patientId}&status=draft`)).body.data as { id: string; total: number; lines: { dentistId: string; performedProcedureId: string }[] }[];
    const lines = drafts.flatMap((d) => d.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ dentistId: A(), performedProcedureId: right.body.data.id });
    expect(drafts.reduce((a, d) => a + d.total, 0)).toBe(10_000);

    const history = (await api(owner).get(`/performed-procedures?patientId=${patientId}`)).body.data as { id: string; status: string; dentistId: string }[];
    expect(history.find((p) => p.id === wrong.body.data.id)).toMatchObject({ status: 'voided', dentistId: B() });
    const { AuditLogModel } = await import('@/core/audit/auditLog.model');
    const { runInTenant } = await import('@/core/tenancy/tenantPlugin');
    const trail = await runInTenant(c.clinicId, () => AuditLogModel.find({ entity: 'performedProcedure', entityId: wrong.body.data.id }).lean());
    expect(trail.map((a) => a.action).sort()).toEqual(['create', 'status_change']);
    expect(trail.find((a) => a.action === 'status_change')?.reason).toBe('recorded under the wrong doctor');
  });

  it('an invoiced procedure needs a credit note before it can be voided', async () => {
    const inv = await sharedInvoice();
    const procs = (await api(owner).get(`/performed-procedures?patientId=${patientId}`)).body.data as { id: string }[];
    expect((await api(owner).post(`/performed-procedures/${procs[0]!.id}/void`).send({ reason: 'x' })).body.error.code).toBe('PROCEDURE_INVOICED');
    expect(inv.total).toBe(40_000);
  });
});

describe('insurance write-offs (09 §8.1)', () => {
  it('splits a claim write-off by each doctor\'s outstanding share, in the ledger, without double counting', async () => {
    const company = await api(owner).post('/insurance-companies').send({ name: 'Jordan Insurance', defaultCoveragePercent: 80 });
    await api(owner).post(`/patients/${patientId}/insurance-policies`).send({ insuranceCompanyId: company.body.data.id, memberNumber: 'M-9', isPrimary: true });
    const inv = await sharedInvoice();
    const claim = await api(owner).post('/insurance-claims').send({ invoiceIds: [inv.id] });
    expect(claim.body.data.claimedAmount).toBe(32_000);
    await api(owner).post(`/insurance-claims/${claim.body.data.id}/status`).send({ to: 'submitted' });
    const resp = await api(owner).post(`/insurance-claims/${claim.body.data.id}/status`).send({ to: 'approved', approvedAmount: 30_000, shortfallMode: 'write_off' });
    expect(resp.status).toBe(200);

    // 2.000 written off; outstanding before it was 40.000 = A 10.000 / B 30.000 → A 500, B 1.500.
    const rows = (await production(accountant)).rows;
    expect(rows.find((r) => r.dentistId === A())).toMatchObject({ writtenOff: 500 });
    expect(rows.find((r) => r.dentistId === B())).toMatchObject({ writtenOff: 1_500 });
    expect((await api(owner).get(`/invoices/${inv.id}`)).body.data.writtenOff).toBe(2_000);
    const { JournalEntryModel } = await import('@/modules/accounting/accounting.models');
    const { runInTenant } = await import('@/core/tenancy/tenantPlugin');
    const jes = await runInTenant(c.clinicId, () => JournalEntryModel.find({ source: 'claim' }).lean());
    expect(jes).toHaveLength(1);
    const debits = jes[0]!.lines.filter((l) => (l.debit ?? 0) > 0);
    expect(debits.map((l) => [String(l.dentistId), l.debit]).sort()).toEqual([[A(), 500], [B(), 1_500]].sort());
    expect(jes[0]!.lines.reduce((a, l) => a + (l.debit ?? 0) - (l.credit ?? 0), 0)).toBe(0);
    const tb = await api(accountant).get('/reports/trial-balance');
    expect(tb.body.data.balanced).toBe(true);
    // A doctor sees only their own write-off.
    expect((await production(docA)).rows).toEqual([expect.objectContaining({ dentistId: A(), writtenOff: 500 })]);
  });
});
