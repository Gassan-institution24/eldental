import { beforeEach, describe, expect, it } from 'vitest';
import { syncCatalogs } from '@/modules/clinic/clinic.seeders';
import { addDays, localDate } from '@/shared/dates';
import { useTestDb } from './db';
import { api, login, makeClinic, resetState, type Session, type TestClinic } from './helpers';

/** Inventory (08b): purchasing, GRNI, transfers, waste, containers and clinical usage. */
useTestDb();
let c: TestClinic;
let owner: Session;
let dentist: Session;
let dentist2: Session;
let accountant: Session;
let reception: Session;
let store: string;
let prep: string;
let chair: string;
let supplierId: string;
let patientId: string;
let patient2Id: string;
const proc: Record<string, string> = {};
const today = () => localDate(new Date(), 'Asia/Amman');
const inDays = (n: number) => addDays(today(), n);
let seq = 0;
const idem = () => `test-key-${Date.now()}-${++seq}`;

/** Trial-balance balance of a system account (natural sign). */
async function bal(key: string) {
  const tb = await api(owner).get(`/reports/trial-balance?asOf=${today()}`);
  expect(tb.body.data.balanced).toBe(true);
  return (tb.body.data.rows as { systemKey?: string; balance: number }[]).find((r) => r.systemKey === key)?.balance ?? 0;
}

async function item(body: Record<string, unknown>) {
  const r = await api(owner).post('/inventory-items').send({ type: 'consumable', ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
}

/** PO for `packs` packs at `packPrice`, received in full at `at` with a lot. */
async function buy(itemId: string, packs: number, packPrice: number, at = store, lot = 'LOT-1', expiresAt = inDays(365)) {
  const po = await api(owner).post('/purchase-orders').send({ supplierId, lines: [{ itemId, packs, packPrice }] });
  expect(po.status, JSON.stringify(po.body)).toBe(201);
  const line = po.body.data.lines[0];
  const grn = await api(owner).post('/goods-receipts').set('Idempotency-Key', idem()).send({ poId: po.body.data.id, locationId: at, lines: [{ poLineId: line.id, quantity: line.orderedQuantity, lotNumber: lot, expiresAt }] });
  expect(grn.status, JSON.stringify(grn.body)).toBe(201);
  return { po: po.body.data, receipt: grn.body.data };
}

async function perform(code: string, s = dentist, teeth: number[] = [], pid = patientId) {
  const r = await api(s).post('/performed-procedures').send({ patientId: pid, clinicProcedureId: proc[code], toothNumbers: teeth, surfaces: code === 'D2391' ? ['O'] : [] });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
}

beforeEach(async () => {
  resetState();
  await syncCatalogs();
  c = await makeClinic('inv');
  owner = await login(c.ownerEmail);
  dentist = await login(c.staff.dentist!.email);
  dentist2 = await login(c.staff.dentist2!.email);
  accountant = await login(c.staff.accountant!.email);
  reception = await login(c.staff.reception!.email);
  const locs = (await api(owner).get('/inventory-locations')).body.data as { id: string; isDefault: boolean }[];
  store = locs.find((l) => l.isDefault)!.id;
  prep = (await api(owner).post('/inventory-locations').send({ name: 'Prep', type: 'medication_prep' })).body.data.id;
  const ch = await api(owner).post('/chairs').send({ name: 'Chair 1', color: '#0E7C86' });
  chair = (await api(owner).post('/inventory-locations').send({ name: 'Chair 1 cabinet', type: 'chair', chairId: ch.body.data.id })).body.data.id;
  supplierId = (await api(owner).post('/suppliers').send({ name: 'MedSupply', kind: 'supplies' })).body.data.id;
  await api(owner).post('/procedures/import-from-catalog').send({ codes: ['D2391', 'D1110'] });
  for (const p of (await api(owner).get('/procedures?limit=100')).body.data as { code: string; id: string }[]) proc[p.code] = p.id;
  patientId = (await api(reception).post('/patients').send({ name: { first: 'Omar', family: 'Saleh' }, phone: '0791234500', preferredDentistId: c.staff.dentist!.staffId })).body.data.id;
  patient2Id = (await api(reception).post('/patients').send({ name: { first: 'Lina', family: 'Haddad' }, phone: '0791234501', preferredDentistId: c.staff.dentist2!.staffId })).body.data.id;
});

describe('catalog and locations', () => {
  it('validates container rules and freezes units once stock exists', async () => {
    const bad = await api(owner).post('/inventory-items').send({ name: 'Bottle', unit: 'ml', unitsPerPack: 250, trackContainers: true, containerPolicy: 'general', containerCapacity: 100 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.fields[0]).toMatchObject({ path: 'containerCapacity', code: 'capacity_must_divide_pack' });
    const mismatch = await api(owner).post('/inventory-items').send({ name: 'Bottle', unit: 'ml', trackContainers: true });
    expect(mismatch.body.error.details.fields[0]).toMatchObject({ path: 'containerPolicy', code: 'container_policy_mismatch' });
    const chairNoId = await api(owner).post('/inventory-locations').send({ name: 'Cabinet X', type: 'chair' });
    expect(chairNoId.body.error.details.fields[0]).toMatchObject({ path: 'chairId', code: 'required' });

    const gloves = await item({ name: 'Gloves', unit: 'piece', unitsPerPack: 100 });
    await buy(gloves, 1, 4_500);
    const g = (await api(owner).get(`/inventory-items/${gloves}`)).body.data;
    const frozen = await api(owner).patch(`/inventory-items/${gloves}`).send({ unitsPerPack: 50, version: g.version });
    expect(frozen.body.error.code).toBe('ITEM_HAS_STOCK');
    expect((await api(owner).patch(`/inventory-items/${gloves}`).send({ reorderLevel: 20, version: g.version })).status).toBe(200);
  });
});

describe('purchasing: PO → receipt → supplier bill', () => {
  it('posts Dr Inventory / Cr GRNI on receipt, clears GRNI with the bill, and never receives twice', async () => {
    const carpule = await item({ name: 'Lidocaine carpule', unit: 'carpule', purchaseUnit: 'box', unitsPerPack: 50 });
    const po = await api(owner).post('/purchase-orders').send({ supplierId, lines: [{ itemId: carpule, packs: 5, packPrice: 20_000 }] });
    expect(po.body.data).toMatchObject({ status: 'open', total: 100_000 });
    expect(await bal('INVENTORY')).toBe(0); // an order has no accounting effect
    const line = po.body.data.lines[0];
    expect(line.orderedQuantity).toBe(250);

    const over = await api(owner).post('/goods-receipts').send({ poId: po.body.data.id, locationId: store, lines: [{ poLineId: line.id, quantity: 251, lotNumber: 'L1' }] });
    expect(over.body.error.code).toBe('OVER_RECEIPT');
    const expired = await api(owner).post('/goods-receipts').send({ poId: po.body.data.id, locationId: store, lines: [{ poLineId: line.id, quantity: 10, lotNumber: 'L1', expiresAt: inDays(-1) }] });
    expect(expired.body.error.details.fields[0]).toMatchObject({ path: 'lines.0.expiresAt', code: 'expired_lot' });

    const key = idem();
    const send = () => api(owner).post('/goods-receipts').set('Idempotency-Key', key).send({ poId: po.body.data.id, locationId: store, lines: [{ poLineId: line.id, quantity: 100, lotNumber: 'L1', expiresAt: inDays(300) }] });
    const first = await send();
    expect(first.status).toBe(201);
    expect(first.body.data.total).toBe(40_000); // 100 × 0.400
    const retry = await send();
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect((await api(owner).get(`/purchase-orders/${po.body.data.id}`)).body.data).toMatchObject({ status: 'partially_received', lines: [{ receivedQuantity: 100, remainingQuantity: 150 }] });
    expect(await bal('INVENTORY')).toBe(40_000);
    expect(await bal('GRNI')).toBe(40_000);
    expect((await api(owner).post(`/purchase-orders/${po.body.data.id}/cancel`).send({ reason: 'x' })).body.error.code).toBe('PO_NOT_OPEN');

    const bill = await api(accountant).post(`/goods-receipts/${first.body.data.id}/bill`).send({ supplierRef: 'INV-778' });
    expect(bill.status, JSON.stringify(bill.body)).toBe(201);
    expect(bill.body.data).toMatchObject({ status: 'posted', total: 40_000, supplierRef: 'INV-778' });
    expect(await bal('GRNI')).toBe(0);
    expect(await bal('AP_SUPPLIERS')).toBe(40_000);
    expect(await bal('INVENTORY')).toBe(40_000); // the bill adds no stock
    expect((await api(accountant).post(`/goods-receipts/${first.body.data.id}/bill`).send({ supplierRef: 'INV-778' })).body.error.code).toBe('RECEIPT_ALREADY_BILLED');
    const listed = await api(accountant).get('/goods-receipts');
    expect(listed.body.data[0].bill).toMatchObject({ supplierRef: 'INV-778' });
    expect((await api(dentist).post('/purchase-orders').send({ supplierId, lines: [{ itemId: carpule, packs: 1, packPrice: 1 }] })).status).toBe(403);
  });
});

describe('transfers, waste and administrative issue', () => {
  it('moves stock without accounting, writes off with Dr expense / Cr inventory, never below zero', async () => {
    const gauze = await item({ name: 'Gauze', unit: 'piece', unitsPerPack: 100, reorderLevel: 150 });
    const { receipt } = await buy(gauze, 2, 2_000);
    const batchId = receipt.lines[0].batchId;
    const t = await api(owner).post('/inventory/transfers').set('Idempotency-Key', idem()).send({ fromLocationId: store, toLocationId: chair, lines: [{ itemId: gauze, batchId, quantity: 30 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const bal1 = (await api(owner).get(`/inventory/balances?itemId=${gauze}`)).body.data as { locationId: string; quantity: number }[];
    expect(bal1.find((b) => b.locationId === chair)!.quantity).toBe(30);
    expect(bal1.find((b) => b.locationId === store)!.quantity).toBe(170);
    expect(await bal('INVENTORY')).toBe(4_000);

    const tooMuch = await api(owner).post('/inventory/adjustments').send({ type: 'waste', locationId: chair, reason: 'Contaminated pack', lines: [{ itemId: gauze, batchId, quantity: 31 }] });
    expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');
    const waste = await api(owner).post('/inventory/adjustments').send({ type: 'waste', locationId: chair, reason: 'Contaminated pack', lines: [{ itemId: gauze, batchId, quantity: 30 }] });
    expect(waste.body.data.total).toBe(600);
    await api(owner).post('/inventory/adjustments').send({ type: 'admin_issue', locationId: store, reason: 'Front desk first aid', lines: [{ itemId: gauze, batchId, quantity: 50 }] });
    expect(await bal('INVENTORY_WASTE')).toBe(600);
    expect(await bal('SUPPLIES_COST')).toBe(1_000);
    expect(await bal('INVENTORY')).toBe(2_400);
    // 120 left ≤ reorder level 150 → one low-stock notification.
    const notes = (await api(owner).get('/notifications')).body.data.items as { type: string }[];
    expect(notes.filter((n) => n.type === 'low_stock')).toHaveLength(1);
    expect((await api(owner).get('/inventory-items?low=true')).body.data.map((i: { id: string }) => i.id)).toEqual([gauze]);
  });
});

describe('containers', () => {
  it('tracks each bottle: open, partial clinical use, single-use remainder, multi-dose rules, discard', async () => {
    const bonding = await item({ name: 'Bonding 100 ml', unit: 'ml', unitsPerPack: 100, trackContainers: true, containerPolicy: 'general', containerCapacity: 100 });
    const irrigant = await item({ name: 'Irrigant single-use 10 ml', unit: 'ml', unitsPerPack: 10, trackContainers: true, containerPolicy: 'single_use', containerCapacity: 10 });
    const vial = await item({ name: 'Multi-dose vial 20 ml', type: 'medication', unit: 'ml', unitsPerPack: 20, trackContainers: true, containerPolicy: 'multi_dose', containerCapacity: 20 });
    await buy(bonding, 2, 20_000, chair, 'BD-1', inDays(200));
    await buy(irrigant, 1, 600, chair, 'IR-1', inDays(200));
    await buy(vial, 1, 3_000, chair, 'MD-1', inDays(100));
    const containers = (await api(owner).get('/inventory/containers')).body.data as { id: string; itemId: string; status: string; remainingQuantity: number }[];
    expect(containers.filter((x) => x.itemId === bonding)).toHaveLength(2);
    const bottle = containers.find((x) => x.itemId === bonding)!;
    const tube = containers.find((x) => x.itemId === irrigant)!;
    const md = containers.find((x) => x.itemId === vial)!;

    // Bulk transfers of tracked items are refused; containers move whole.
    const bulk = await api(owner).post('/inventory/transfers').send({ fromLocationId: chair, toLocationId: store, lines: [{ itemId: bonding, batchId: (await api(owner).get(`/inventory/balances?itemId=${bonding}`)).body.data[0].batchId, quantity: 10 }] });
    expect(bulk.body.error.code).toBe('CONTAINER_REQUIRED');
    // Multi-dose: opened only in a medication preparation area, with a beyond-use date.
    expect((await api(owner).post(`/inventory/containers/${md.id}/open`).send({ beyondUseDate: inDays(20) })).body.error.code).toBe('CONTAINER_POLICY_VIOLATION');
    expect((await api(owner).post(`/inventory/containers/${md.id}/transfer`).send({ toLocationId: prep })).status).toBe(200);
    const noBud = await api(owner).post(`/inventory/containers/${md.id}/open`).send({});
    expect(noBud.body.error.details.fields[0]).toMatchObject({ path: 'beyondUseDate', code: 'required' });
    expect((await api(owner).post(`/inventory/containers/${md.id}/open`).send({ beyondUseDate: inDays(200) })).body.error.details.fields[0].code).toBe('beyond_use_after_expiry');
    expect((await api(owner).post(`/inventory/containers/${md.id}/open`).send({ beyondUseDate: inDays(20) })).body.data.status).toBe('open');
    expect((await api(owner).post(`/inventory/containers/${md.id}/transfer`).send({ toLocationId: chair })).body.error.code).toBe('CONTAINER_POLICY_VIOLATION');

    const pp = await perform('D2391', dentist, [36]);
    const usageBody = { performedProcedureId: pp, locationId: chair, lines: [{ itemId: bonding, containerId: bottle.id, quantityUsed: 10, quantityWasted: 0 }] };
    expect((await api(dentist).post('/clinical-usages').send(usageBody)).body.error.code).toBe('CONTAINER_NOT_OPEN');
    expect((await api(dentist).post(`/inventory/containers/${bottle.id}/open`).send({})).status).toBe(200);
    expect((await api(dentist).post(`/inventory/containers/${tube.id}/open`).send({})).status).toBe(200);
    const used = await api(dentist)
      .post('/clinical-usages')
      .set('Idempotency-Key', idem())
      .send({ ...usageBody, lines: [...usageBody.lines, { itemId: irrigant, containerId: tube.id, quantityUsed: 3, quantityWasted: 0 }] });
    expect(used.status, JSON.stringify(used.body)).toBe(201);
    expect(used.body.data.lines[1]).toMatchObject({ quantityUsed: 3, autoWasteQuantity: 7 });
    // The dentist does not see costs; the owner's ledger does.
    expect(used.body.data).not.toHaveProperty('total');
    expect(await bal('CLINICAL_MATERIALS')).toBe(2_000 + 180); // 10 ml of 200 fils/ml + 3 ml of 60 fils/ml
    expect(await bal('INVENTORY_WASTE')).toBe(420); // 7 ml single-use remainder
    const after = (await api(owner).get('/inventory/containers?status=sealed,open,empty,discarded')).body.data as { id: string; status: string; remainingQuantity: number }[];
    expect(after.find((x) => x.id === bottle.id)).toMatchObject({ status: 'open', remainingQuantity: 90 });
    expect(after.find((x) => x.id === tube.id)).toMatchObject({ status: 'discarded', remainingQuantity: 0 });
    expect((await api(dentist).post('/clinical-usages').send(usageBody)).body.error.code).toBe('USAGE_ALREADY_POSTED');

    const events = (await api(owner).get(`/inventory/containers/${bottle.id}/events`)).body.data as { action: string }[];
    expect(events.map((e) => e.action)).toEqual(['consume', 'open', 'receive']);
    const discarded = await api(owner).post(`/inventory/containers/${bottle.id}/discard`).send({ reason: 'Past beyond-use date' });
    expect(discarded.body.data).toMatchObject({ status: 'discarded', remainingQuantity: 0 });
    expect(await bal('INVENTORY_WASTE')).toBe(420 + 18_000);
  });
});

describe('clinical usage', () => {
  it('suggests template materials (FEFO), respects own scope, hides cost without the field grant', async () => {
    const gloves = await item({ name: 'Gloves', unit: 'piece', unitsPerPack: 100 });
    const composite = await item({ name: 'Composite', unit: 'g', unitsPerPack: 4 });
    await buy(gloves, 1, 4_500, chair, 'G-LATE', inDays(300));
    await buy(gloves, 1, 4_000, chair, 'G-SOON', inDays(30));
    await buy(composite, 2, 12_000, chair, 'C-1', inDays(300));
    const tpl = await api(owner).put(`/procedure-materials/${proc.D2391}`).send({ materials: [{ itemId: gloves, defaultQuantity: 2, usageScope: 'per_visit' }, { itemId: composite, defaultQuantity: 0.3, usageScope: 'per_tooth' }] });
    expect(tpl.status).toBe(200);

    const pp = await perform('D2391', dentist, [36]);
    const pp2 = await perform('D2391', dentist2, [46], patient2Id);
    const sug = await api(dentist).get(`/clinical-usages/suggestions?performedProcedureId=${pp}&locationId=${chair}`);
    expect(sug.body.data.map((s: { itemName: string; quantity: number }) => [s.itemName, s.quantity])).toEqual([
      ['Gloves', 2],
      ['Composite', 0.3],
    ]);
    const soon = ((await api(owner).get(`/inventory/balances?itemId=${gloves}`)).body.data as { lotNumber: string; batchId: string }[]).find((b) => b.lotNumber === 'G-SOON')!;
    expect(sug.body.data[0].batchId).toBe(soon.batchId);

    // Dentist two can't see or record dentist one's procedure.
    expect((await api(dentist2).get(`/clinical-usages/suggestions?performedProcedureId=${pp}&locationId=${chair}`)).status).toBe(404);
    expect((await api(dentist2).get(`/clinical-usages/procedures?patientId=${patient2Id}`)).body.data.map((p: { id: string }) => p.id)).toEqual([pp2]);
    expect((await api(owner).get(`/clinical-usages/procedures?patientId=${patientId}`)).body.data.map((p: { id: string }) => p.id)).toEqual([pp]);

    const rec = await api(dentist).post('/clinical-usages').send({ performedProcedureId: pp, locationId: chair, lines: [{ itemId: gloves, quantityUsed: 2 }, { itemId: composite, quantityUsed: 0.3, quantityWasted: 0.1 }] });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(rec.body.data.lines[0].lotNumber).toBe('G-SOON');
    expect(await bal('CLINICAL_MATERIALS')).toBe(80 + 900); // 2 × 40 + 0.3 g × 3,000/g
    expect(await bal('INVENTORY_WASTE')).toBe(300);

    // Costs are hidden from dentists, visible to the accountant.
    const dBal = (await api(dentist).get(`/inventory/balances?itemId=${composite}`)).body.data[0];
    expect(dBal).not.toHaveProperty('value');
    const aBal = (await api(accountant).get(`/inventory/balances?itemId=${composite}`)).body.data[0];
    expect(aBal.value).toBe(Math.round(7.6 * 3_000));
    expect((await api(accountant).get(`/clinical-usages?patientId=${patientId}`)).body.data[0].total).toBe(1_280);
    expect((await api(dentist2).get(`/clinical-usages?patientId=${patientId}`)).body.data).toHaveLength(0);
    // Reception reads the catalog but records nothing clinical.
    expect((await api(reception).get('/inventory-items')).status).toBe(200);
    expect((await api(reception).post('/clinical-usages').send({ performedProcedureId: pp2, locationId: chair, lines: [{ itemId: gloves, quantityUsed: 1 }] })).status).toBe(403);
  });
});

describe('opening stock and overview', () => {
  it('posts Dr Inventory / Cr Opening balance and reports expiring lots', async () => {
    const vial = await item({ name: 'Vial', type: 'medication', unit: 'ml', unitsPerPack: 20, trackContainers: true, containerPolicy: 'multi_dose', containerCapacity: 20 });
    const gauze = await item({ name: 'Gauze', unit: 'piece', reorderLevel: 500 });
    const op = await api(owner).post('/inventory/opening-stock').send({ locationId: prep, lines: [{ itemId: vial, quantity: 40, unitCost: 150, lotNumber: 'V1', expiresAt: inDays(20) }, { itemId: gauze, quantity: 100, unitCost: 20 }] });
    expect(op.status, JSON.stringify(op.body)).toBe(201);
    expect(await bal('INVENTORY')).toBe(6_000 + 2_000);
    expect(await bal('OPENING_BALANCE')).toBe(8_000);
    const bad = await api(owner).post('/inventory/opening-stock').send({ locationId: prep, lines: [{ itemId: vial, quantity: 30, unitCost: 150 }] });
    expect(bad.body.error.details.fields[0]).toMatchObject({ path: 'lines.0.quantity', code: 'capacity_must_divide_pack' });
    const ov = await api(owner).get('/inventory/overview');
    expect(ov.body.data).toMatchObject({ items: 2, stockValue: 8_000, lowStock: [{ id: gauze }], expiring: [{ lotNumber: 'V1', quantity: 40 }] });
    expect((await api(dentist).get('/inventory/overview')).body.data).not.toHaveProperty('stockValue');
  });
});
