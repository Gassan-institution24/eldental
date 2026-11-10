import type { ClientSession, Types } from 'mongoose';
import type { AuthContext } from '@/core/auth/auth.types';
import { AccountModel } from '@/modules/accounting/accounting.models';
import { ensureLedger, loadAccountMap, postEntry } from '@/modules/accounting/journal.service';

/**
 * Accounts the inventory posts to (08b §4), created on first use so clinics that existed before
 * the module get them too. INVENTORY and SUPPLIES_COST are already in the default chart.
 */
const EXTRA_ACCOUNTS = [
  { key: 'GRNI', code: '2120', type: 'liability', subtype: 'accrued_liability', parentCode: '2000' },
  { key: 'CLINICAL_MATERIALS', code: '5210', type: 'expense', subtype: '', parentCode: '5000' },
  { key: 'INVENTORY_WASTE', code: '5220', type: 'expense', subtype: '', parentCode: '5000' },
] as const;

export async function ensureInventoryAccounts(session?: ClientSession): Promise<void> {
  const s = session ?? null;
  if (!(await AccountModel.exists({}).session(s))) await ensureLedger(session);
  const have = new Set((await AccountModel.find({ systemKey: { $in: EXTRA_ACCOUNTS.map((a) => a.key) } }).select('systemKey').session(s).lean()).map((a) => a.systemKey));
  for (const a of EXTRA_ACCOUNTS) {
    if (have.has(a.key)) continue;
    const parent = await AccountModel.findOne({ code: a.parentCode, isGroup: true }).select('_id').session(s).lean();
    // Keep the suggested code unless the clinic already uses it.
    let code: string = a.code;
    while (await AccountModel.exists({ code }).session(s)) code = String(Number(code) + 1);
    await AccountModel.create(
      [
        {
          code,
          name: null,
          systemKey: a.key,
          searchName: code,
          type: a.type,
          subtype: a.subtype,
          parentId: parent?._id,
          isGroup: false,
          isSystem: true,
          normalBalance: a.type === 'expense' ? 'debit' : 'credit',
        },
      ],
      { session },
    );
  }
}

export type InventoryLine = { key: string; debit?: number; credit?: number; description?: string; supplierId?: string };

/** Posts a balanced entry by system key (zero lines dropped) inside the caller's transaction. */
export async function postInventoryEntry(auth: AuthContext, d: { date: string; sourceId: Types.ObjectId; memo: string; lines: InventoryLine[] }, session?: ClientSession) {
  await ensureInventoryAccounts(session);
  const accounts = await loadAccountMap(session);
  const lines = d.lines
    .filter((l) => (l.debit ?? 0) > 0 || (l.credit ?? 0) > 0)
    .map((l) => ({ accountId: accounts(l.key), debit: l.debit ?? 0, credit: l.credit ?? 0, description: l.description ?? '', ...(l.supplierId ? { supplierId: l.supplierId } : {}) }));
  return postEntry(auth, { date: d.date, source: 'inventory', sourceId: d.sourceId, memo: d.memo, lines }, session);
}

/** The GRNI account id, for supplier bills raised from a goods receipt. */
export async function grniAccountId(): Promise<string> {
  await ensureInventoryAccounts();
  return (await loadAccountMap())('GRNI');
}
