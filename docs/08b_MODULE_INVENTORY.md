# 08b — Inventory: Stock, Purchasing, Containers & Clinical Usage

Replaces the lightweight inventory (single quantity + average cost per item). Built from the
**DentMadar Inventory v2 (containers)** reference and adapted to ElDental: tenancy, RBAC, field
policies, Zod, integer money, the existing chart of accounts, suppliers, supplier bills and payments.

## 1. Scope & what came from DentMadar

| DentMadar | ElDental |
|---|---|
| `Inventory_Items` | `inventoryItems` (same collection as before, extended) |
| `Inventory_Locations` (warehouse / chair / medication_prep / quarantine) | `inventoryLocations`; a chair location links an ElDental `Chair` |
| `Inventory_Batches` (lot, expiry, unit cost) | `inventoryBatches` — cost kept as `packCost / unitsPerPack` (exact) |
| `Inventory_Stock_Balances` | `inventoryBalances` (location × item × lot) |
| `Inventory_Stock_Movements` (immutable) | `inventoryMovements` |
| `Inventory_Containers` / `_Container_Events` | `inventoryContainers` / `inventoryContainerEvents` |
| `Inventory_Purchase_Orders` / `_Goods_Receipts` | `purchaseOrders` / `goodsReceipts` |
| `Inventory_Procedure_Materials` | `procedureMaterials`, keyed by the clinic's `ClinicProcedure` |
| `Inventory_Clinical_Usage` | `clinicalUsages`, keyed by ElDental's `PerformedProcedure` |
| `Inventory_Suppliers` | **not duplicated** — accounting `suppliers` |
| `AP_Vendor_Bills` | **not duplicated** — a posted accounting `SupplierBill` raised from the receipt |
| `AP_Supplier_Payments`, `Cash_Registers/Sessions/Transactions` | **not duplicated** — Accounting → supplier payments, billing cash sessions |
| `Accounting_Journal_Entries` + demo account codes | **not duplicated** — `postEntry` with system keys (§4) |
| `Users` + demo login / roles | ElDental auth, permissions and field policy (§7) |
| `X-Idempotency-Key` + `Operation_Idempotency` | `Idempotency-Key` header, unique `idempotencyKey` on the posted document |

Not built (as in DentMadar): tax/freight/price variance on receipts, returns to supplier, reversal of
usage, stock counts, implant–patient UDI linkage, sterilisation.

## 2. Model
- **Item**: `name`, `sku` (unique when set), `category`, `type` (`consumable|implant|medication|reusable|equipment|general`),
  `unit` (base counting unit), `purchaseUnit`, `unitsPerPack`, `reorderLevel`, `trackContainers`, `containerPolicy`,
  `containerCapacity`, `quantityOnHand` (sum of balances, updated in the movement transaction), `supplierId`, `isActive`.
  `unit`, `unitsPerPack` and the container fields are **frozen once the item has stock or lots** (`ITEM_HAS_STOCK`).
- **Quantities** are base units with ≤ 4 decimals (`stockQty()`); **money** is integer minor units.
  Cost of `q` units of a lot = `costOf(q, packCost, unitsPerPack)` (rational, half-even rounding).
- **Location**: one default warehouse per clinic (created with the clinic; receipts and opening stock default there).
- **Movement types**: `opening`, `purchase_receipt`, `transfer`, `container_transfer`, `clinical_use`, `clinical_waste`,
  `single_use_remainder`, `waste`, `admin_issue`, `container_discard`. Movements and posted documents are never edited.

## 3. Purchasing
1. **Purchase order** (`PO-YYYY-NNNNNN`): supplier, lines of `packs × packPrice`. No stock, no accounting.
   Cancellable only while nothing is received.
2. **Goods receipt** (`GRN-…`): against PO lines, into a location; lot number required, expiry optional (an expired lot
   is refused). Never more than ordered (`OVER_RECEIPT`). Creates a lot per line, stock in, containers for tracked
   items (`GRN-…-<line>-<n>`), PO status `partially_received|received`. **Dr Inventory / Cr GRNI.**
3. **Supplier bill** (`POST /goods-receipts/:id/bill`, needs `accounting.supplier.manage`): a posted supplier bill whose
   single line is the GRNI account → **Dr GRNI / Cr AP**. Adds no stock. One bill per receipt (`RECEIPT_ALREADY_BILLED`).
4. **Payment**: Accounting → Supplier bills / payments (unchanged).

## 4. Accounting (perpetual inventory)
Accounts by system key; `GRNI` (2120), `CLINICAL_MATERIALS` (5210) and `INVENTORY_WASTE` (5220) are created on first use
for clinics that predate the module; `INVENTORY`, `SUPPLIES_COST` and `OPENING_BALANCE` are in the default chart.
Journal source: `inventory`.

| Document | Debit | Credit |
|---|---|---|
| Purchase order | — | — |
| Goods receipt | INVENTORY | GRNI |
| Supplier bill (from receipt) | GRNI | AP_SUPPLIERS |
| Transfer / container move | — | — |
| Opening stock | INVENTORY | OPENING_BALANCE |
| Clinical use | CLINICAL_MATERIALS | INVENTORY |
| Clinical waste, single-use remainder | INVENTORY_WASTE | INVENTORY |
| Write-off (`waste`), container discard | INVENTORY_WASTE | INVENTORY |
| Administrative issue | SUPPLIES_COST | INVENTORY |

Material cost is **never** added to the patient's invoice; the performed procedure stays the billing source.

## 5. Clinical usage
- Recorded on a **performed procedure** (`USE-…`), once per procedure (`USAGE_ALREADY_POSTED`); voided procedures refused.
- Suggestions come from the procedure's default materials: `per_visit` ×1, `per_procedure` × quantity, `per_tooth` × teeth.
- Lot: chosen, or first-expiry-first-out among unexpired lots at the source location with enough stock.
- Container-tracked items need an **opened** container at that location (`CONTAINER_REQUIRED`, `CONTAINER_NOT_OPEN`).
- Own scope: the procedure's dentist or one of its assistants. Patient merges move usage records too.
- Used material is never put back (no reversal), as in DentMadar.

## 6. Containers
- Policies: `general` (used gradually), `multi_dose` (labelled multi-dose injectable), `single_use`, `none` (not tracked).
- Statuses `sealed → open → empty | discarded`. Opening has no stock or cost effect.
- **Multi-dose**: opened and drawn only in a `medication_prep` location, with a beyond-use date (≤ the lot's expiry);
  can move only to `medication_prep` or `quarantine`.
- **Single-use**: after the first draw the remainder is discarded automatically (`single_use_remainder`); an opened one
  can't be moved.
- Past the beyond-use date a container can't be used (`CONTAINER_BEYOND_USE`); discard writes off what is left.
- Bulk transfers and write-offs of tracked items are refused — containers move or are discarded one by one.
- Every event (receive, open, consume, transfer, discard) is kept in `inventoryContainerEvents`.

## 7. Permissions & fields
| Permission | Scopes | Use |
|---|---|---|
| `inventory.item.read` / `.manage` | all | catalog, stock, movements, overview / items, locations, procedure materials |
| `inventory.stock.adjust` | all | transfers, write-offs, admin issue, opening stock, container move/discard |
| `inventory.purchase.read` / `.manage` / `.receive` | all | view / create & cancel POs / receive goods |
| `inventory.usage.read` / `.record` | own, all | view / record clinical usage; record also opens and discards containers |

Field `inventory.item.cost` (default **hidden**): lot costs, stock value, movement and usage costs leave the API only when granted.
Templates: dentist & hygienist — item read, usage own; assistant — item read, usage all; receptionist — item read;
accountant — item read with cost, purchase read, usage read all. Owner: everything.

## 8. Alerts
Crossing the reorder level downwards notifies owners, managers and the front desk once (`low_stock`).
The overview shows low stock, lots expiring within 60 days and open containers whose beyond-use date is within 7 days.

## 9. Existing clinics
`npm run migrate:inventory` (dry run) / `-- --apply`: adds the default store, gives items from the old module an opening
lot at their average cost (no journal — the old module already posted it), and adds the template inventory grants to
each clinic's system roles. Re-runnable.
