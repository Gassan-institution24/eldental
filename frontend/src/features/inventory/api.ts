import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import { api, getData, postData, putData } from '@/lib/api/axios';
import { resourceHooks, type Entity } from '@/shared/api/resource';
import type { ContainerPolicy, ItemType, LocationType, MovementType, UsageScope } from '@/shared/generated/inventory';

/* ---------- types (08b) ---------- */

export type InventoryItem = Entity & {
  name: string;
  sku: string;
  category: string;
  type: ItemType;
  unit: string;
  purchaseUnit: string;
  unitsPerPack: number;
  reorderLevel: number;
  trackContainers: boolean;
  containerPolicy: ContainerPolicy;
  containerCapacity?: number;
  quantityOnHand: number;
  supplierId?: string;
  notes: string;
  isActive: boolean;
};

export type InventoryLocation = Entity & { name: string; type: LocationType; chairId?: string; isDefault: boolean; isActive: boolean };

export type Balance = {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  unit: string;
  trackContainers: boolean;
  locationId: string;
  locationName: string;
  locationType?: LocationType;
  batchId: string;
  lotNumber: string;
  expiresAt?: string;
  expired: boolean;
  quantity: number;
  value?: number;
};

export type Movement = {
  id: string;
  type: MovementType;
  date: string;
  at: string;
  itemId: string;
  itemName: string;
  unit: string;
  lotNumber: string;
  quantity: number;
  fromLocationName?: string;
  toLocationName?: string;
  sourceType: string;
  cost?: number;
};

export type Container = {
  id: string;
  code: string;
  itemId: string;
  itemName: string;
  unit: string;
  batchId: string;
  lotNumber: string;
  expiresAt?: string;
  locationId: string;
  locationName: string;
  locationType?: LocationType;
  initialQuantity: number;
  remainingQuantity: number;
  status: 'sealed' | 'open' | 'empty' | 'discarded';
  policy: ContainerPolicy;
  openedAt?: string;
  beyondUseDate?: string;
  usable: boolean;
};

export type ContainerEvent = {
  id: string;
  action: 'receive' | 'open' | 'consume' | 'transfer' | 'discard';
  at: string;
  usedQuantity?: number;
  wastedQuantity?: number;
  autoWasteQuantity?: number;
  remainingQuantity?: number;
  beyondUseDate?: string;
  reason?: string;
  cost?: number;
};

export type Overview = {
  today: string;
  items: number;
  lowStock: { id: string; name: string; unit: string; quantityOnHand: number; reorderLevel: number }[];
  expiring: { batchId: string; itemId: string; itemName: string; unit: string; lotNumber: string; expiresAt: string; expired: boolean; quantity: number }[];
  openContainers: number;
  containersNearBeyondUse: { id: string; code: string; itemName: string; beyondUseDate: string; remainingQuantity: number; expired: boolean }[];
  stockValue?: number;
};

export type PoLine = {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  purchaseUnit: string;
  trackContainers: boolean;
  packs: number;
  unitsPerPack: number;
  packPrice: number;
  lineTotal: number;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
};

export type PurchaseOrder = {
  id: string;
  version: number;
  number: string;
  supplierId: string;
  supplierName: string;
  date: string;
  expectedDate?: string;
  status: 'open' | 'partially_received' | 'received' | 'cancelled';
  total: number;
  notes: string;
  cancelReason?: string;
  lines: PoLine[];
};

export type GoodsReceipt = {
  id: string;
  number: string;
  poId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  locationName: string;
  date: string;
  total: number;
  bill?: { id: string; number: string; supplierRef: string; status: string };
  lines: { itemId: string; itemName: string; unit: string; lotNumber: string; expiresAt?: string; quantity: number; cost: number; containers: number }[];
};

export type ProcedureMaterials = { clinicProcedureId: string; materials: { itemId: string; defaultQuantity: number; usageScope: UsageScope; optional: boolean }[] };

export type UsageCandidate = {
  id: string;
  clinicProcedureId: string;
  code: string;
  procedure: { code: string; name: string | null; systemKey?: string } | null;
  toothNumbers: number[];
  quantity: number;
  performedAt: string;
  dentistName: string;
  usageNumber?: string;
};

export type Suggestion = {
  itemId: string;
  itemName: string;
  unit: string;
  trackContainers: boolean;
  containerPolicy: ContainerPolicy;
  quantity: number;
  usageScope: UsageScope;
  optional: boolean;
  batchId?: string;
  containerId?: string;
};

export type ClinicalUsage = {
  id: string;
  number: string;
  date: string;
  performedProcedureId: string;
  patientId: string;
  dentistName: string;
  locationName: string;
  toothNumbers: number[];
  total?: number;
  lines: { itemId: string; itemName: string; unit: string; lotNumber: string; containerCode?: string; quantityUsed: number; quantityWasted: number; autoWasteQuantity: number }[];
};

/* ---------- hooks ---------- */

export const itemsApi = resourceHooks<InventoryItem>('/inventory-items');
export const locationsApi = resourceHooks<InventoryLocation>('/inventory-locations');

/** Every inventory query starts with this key, so a posting refreshes all of them. */
const INV: QueryKey = ['inventory'];
const k = {
  overview: [...INV, 'overview'],
  balances: (p: object) => [...INV, 'balances', p],
  movements: (p: object) => [...INV, 'movements', p],
  containers: (p: object) => [...INV, 'containers', p],
  events: (id: string) => [...INV, 'containerEvents', id],
  pos: (p: object) => [...INV, 'pos', p],
  receipts: (p: object) => [...INV, 'receipts', p],
  materials: [...INV, 'materials'],
  candidates: (patientId: string) => [...INV, 'candidates', patientId],
  suggestions: (pp: string, loc: string) => [...INV, 'suggestions', pp, loc],
  usages: (p: object) => [...INV, 'usages', p],
};

const clean = (p: Record<string, string | undefined>) => Object.fromEntries(Object.entries(p).filter(([, v]) => v));

export function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: INV }), qc.invalidateQueries({ queryKey: ['/inventory-items'] })]);
}

export const useOverview = () => useQuery({ queryKey: k.overview, queryFn: () => getData<Overview>('/inventory/overview') });

export function useBalances(p: { itemId?: string; locationId?: string; available?: 'true' } = {}, enabled = true) {
  return useQuery({ queryKey: k.balances(p), queryFn: () => getData<Balance[]>('/inventory/balances', { params: clean(p) }), enabled });
}

export function useMovements(p: { itemId?: string; locationId?: string; type?: string } = {}) {
  return useQuery({ queryKey: k.movements(p), queryFn: () => getData<Movement[]>('/inventory/movements', { params: clean(p) }) });
}

export function useContainers(p: { status?: string; locationId?: string; itemId?: string } = {}, enabled = true) {
  return useQuery({ queryKey: k.containers(p), queryFn: () => getData<Container[]>('/inventory/containers', { params: clean(p) }), enabled });
}

export function useContainerEvents(id: string | undefined) {
  return useQuery({ queryKey: k.events(id ?? ''), queryFn: () => getData<ContainerEvent[]>(`/inventory/containers/${id}/events`), enabled: Boolean(id) });
}

export function usePurchaseOrders(p: { status?: string } = {}, enabled = true) {
  return useQuery({ queryKey: k.pos(p), queryFn: () => getData<PurchaseOrder[]>('/purchase-orders', { params: clean(p) }), enabled });
}

export function useReceipts(p: { unbilled?: 'true' } = {}, enabled = true) {
  return useQuery({ queryKey: k.receipts(p), queryFn: () => getData<GoodsReceipt[]>('/goods-receipts', { params: clean(p) }), enabled });
}

export const useProcedureMaterials = () => useQuery({ queryKey: k.materials, queryFn: () => getData<ProcedureMaterials[]>('/procedure-materials') });

export function useUsageCandidates(patientId: string | undefined) {
  return useQuery({ queryKey: k.candidates(patientId ?? ''), queryFn: () => getData<UsageCandidate[]>('/clinical-usages/procedures', { params: { patientId } }), enabled: Boolean(patientId) });
}

export function useSuggestions(performedProcedureId: string, locationId: string) {
  return useQuery({
    queryKey: k.suggestions(performedProcedureId, locationId),
    queryFn: () => getData<Suggestion[]>('/clinical-usages/suggestions', { params: { performedProcedureId, locationId } }),
    enabled: Boolean(performedProcedureId && locationId),
  });
}

export function useUsages(p: { patientId?: string } = {}, enabled = true) {
  return useQuery({ queryKey: k.usages(p), queryFn: () => getData<ClinicalUsage[]>('/clinical-usages', { params: clean(p) }), enabled });
}

/** A fresh key per form opening: retries and double clicks post once (09 §3.2). */
export const newIdempotencyKey = () => `inv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** POST with an `Idempotency-Key`; refreshes every inventory query afterwards. */
export function usePosting<T = { id: string; number?: string }>(path: string | ((b: Record<string, unknown>) => string)) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...b }: { idempotencyKey?: string } & Record<string, unknown>) =>
      api
        .post<{ data: T }>(typeof path === 'string' ? path : path(b), b, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined)
        .then((r) => r.data.data),
    onSuccess: () => void invalidate(),
  });
}

export function useContainerAction() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, action, ...b }: { id: string; action: 'open' | 'transfer' | 'discard' } & Record<string, unknown>) => postData<Container>(`/inventory/containers/${id}/${action}`, b),
    onSuccess: () => void invalidate(),
  });
}

export function useSaveMaterials() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ clinicProcedureId, materials }: ProcedureMaterials) => putData<ProcedureMaterials>(`/procedure-materials/${clinicProcedureId}`, { materials }),
    onSuccess: () => void invalidate(),
  });
}

export function useCancelPo() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => postData<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason }),
    onSuccess: () => void invalidate(),
  });
}

/* ---------- form helpers ---------- */

/** Text inputs hold strings; the shared rules expect numbers. '' stays empty (→ required). */
export const numeric = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : typeof v === 'string' ? Number(v.replace(',', '.')) : v), schema);

/** Quantity display: up to 4 decimals, no trailing zeros. */
export const fmtQty = (n: number | undefined, unit?: string) =>
  `${Number(n ?? 0).toLocaleString('en', { maximumFractionDigits: 4 })}${unit ? ` ${unit}` : ''}`;
