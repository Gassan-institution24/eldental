import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { costOf, planContainerDraw, suggestedQuantity } from '@/shared/generated/inventory';
import type { Container, PurchaseOrder } from '../api';

const L1 = '6ae4bca54d4ccea3db089501';
const L2 = '6ae4bca54d4ccea3db089502';
const PL1 = '6ae4bca54d4ccea3db089511';
const PL2 = '6ae4bca54d4ccea3db089512';

/** Inventory (08b): tabs by permission, container opening rules, receiving against an order. */

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  containers: [] as Container[],
  pos: [] as PurchaseOrder[],
  action: vi.fn(),
  post: vi.fn(),
}));

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: (p?: string) => !p || state.perms.has(p), session: { staff: { id: 's1' } } }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false, access: () => 'write' }),
}));
for (const tab of ['OverviewTab', 'ItemsTab', 'StockTab', 'SetupTab', 'UsageTab']) {
  vi.doMock(`../components/${tab}`, () => ({ default: () => <div>{`${tab}-body`}</div>, ItemPicker: () => null }));
}
vi.mock('../api', async (orig) => {
  const real = await orig<typeof import('../api')>();
  const q = <T,>(data: T) => ({ data, isLoading: false, error: null, refetch: vi.fn() });
  return {
    ...real,
    locationsApi: {
      ...real.locationsApi,
      useAll: () =>
        q([
          { id: L1, version: 0, name: 'Main store', type: 'warehouse', isDefault: true, isActive: true },
          { id: L2, version: 0, name: 'Prep', type: 'medication_prep', isDefault: false, isActive: true },
        ]),
    },
    useContainers: () => q(state.containers),
    useContainerEvents: () => q([]),
    useContainerAction: () => ({ mutateAsync: state.action, isPending: false }),
    usePurchaseOrders: () => q(state.pos),
    useReceipts: () => q([]),
    useCancelPo: () => ({ mutateAsync: vi.fn(), isPending: false }),
    usePosting: () => ({ mutateAsync: state.post, isPending: false }),
  };
});

function wrap(node: ReactNode, path = '/') {
  const router = createMemoryRouter(
    [
      { path: '/clinic/inventory/:tab?', element: node },
      { path: '*', element: node },
    ],
    { initialEntries: [path] },
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AppThemeProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </AppThemeProvider>
    </QueryClientProvider>,
  );
}

const md: Container = {
  id: 'c1',
  code: 'GRN-2026-000001-1-1',
  itemId: 'i1',
  itemName: 'Lidocaine vial 20 ml',
  unit: 'ml',
  batchId: 'b1',
  lotNumber: 'LMD-90',
  expiresAt: '2099-12-31',
  locationId: 'l2',
  locationName: 'Prep',
  locationType: 'medication_prep',
  initialQuantity: 20,
  remainingQuantity: 20,
  status: 'sealed',
  policy: 'multi_dose',
  usable: false,
};

beforeAll(async () => {
  await Promise.all([import('../pages/InventoryPage'), import('../components/ContainersTab'), import('../components/PurchasingTab')]);
}, 30_000);
beforeEach(() => {
  state.perms = new Set();
  state.containers = [];
  state.pos = [];
  state.action.mockReset().mockResolvedValue({});
  state.post.mockReset().mockResolvedValue({ id: 'r1', number: 'GRN-2026-000001' });
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('shared rules', () => {
  it('costs exactly, discards single-use remainders and scales template quantities', () => {
    expect(costOf(1, 20_000, 50)).toBe(400); // one carpule of a 20.000 box of 50
    expect(costOf(0.3, 12_000, 4)).toBe(900);
    expect(planContainerDraw(10, 3, 0, 'single_use')).toEqual({ used: 3, wasted: 0, autoWaste: 7, remaining: 0 });
    expect(planContainerDraw(100, 10, 0, 'general')).toEqual({ used: 10, wasted: 0, autoWaste: 0, remaining: 90 });
    expect(planContainerDraw(5, 6, 0, 'general')).toBeNull();
    expect(suggestedQuantity(0.3, 'per_tooth', { toothCount: 2 })).toBe(0.6);
    expect(suggestedQuantity(2, 'per_visit', { toothCount: 4 })).toBe(2);
  });
});

describe('inventory page', () => {
  it('shows only the tabs the user may use and opens the first one', async () => {
    state.perms = new Set(['inventory.usage.record', 'inventory.usage.read']);
    const { InventoryPage } = await import('../pages/InventoryPage');
    wrap(<InventoryPage />, '/clinic/inventory');
    const first = await screen.findByRole('tab', { name: 'Containers' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Containers', 'Materials used']);
    await userEvent.click(screen.getByRole('tab', { name: 'Materials used' }));
    expect(await screen.findByText('UsageTab-body')).toBeInTheDocument();
  });

  it('shows the no-permission screen without any inventory permission', async () => {
    const { InventoryPage } = await import('../pages/InventoryPage');
    wrap(<InventoryPage />, '/clinic/inventory');
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });
});

describe('containers', () => {
  it('requires a beyond-use date to open a multi-dose container, in Arabic', async () => {
    await i18n.changeLanguage('ar');
    state.perms = new Set(['inventory.item.read', 'inventory.stock.adjust']);
    state.containers = [md];
    const { default: ContainersTab } = await import('../components/ContainersTab');
    wrap(<ContainersTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'فتح' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/منطقة نظيفة لتحضير الأدوية/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'فتح' }));
    expect(await within(dialog).findByText('يُستخدم قبل مطلوب')).toBeInTheDocument();
    expect(state.action).not.toHaveBeenCalled();
  });
});

describe('receiving', () => {
  it('asks for the lot of each received line and skips empty ones', async () => {
    state.perms = new Set(['inventory.purchase.read', 'inventory.purchase.receive']);
    state.pos = [
      {
        id: 'po1',
        version: 0,
        number: 'PO-2026-000001',
        supplierId: 's1',
        supplierName: 'MedSupply',
        date: '2026-11-01',
        status: 'open',
        total: 100_000,
        notes: '',
        lines: [
          { id: PL1, itemId: 'i1', itemName: 'Gloves', unit: 'piece', purchaseUnit: 'box', trackContainers: false, packs: 2, unitsPerPack: 100, packPrice: 4_500, lineTotal: 9_000, orderedQuantity: 200, receivedQuantity: 0, remainingQuantity: 200 },
          { id: PL2, itemId: 'i2', itemName: 'Gauze', unit: 'piece', purchaseUnit: 'pack', trackContainers: false, packs: 1, unitsPerPack: 100, packPrice: 2_000, lineTotal: 2_000, orderedQuantity: 100, receivedQuantity: 0, remainingQuantity: 100 },
        ],
      },
    ];
    const { default: PurchasingTab } = await import('../components/PurchasingTab');
    wrap(<PurchasingTab />);
    await userEvent.click(await screen.findByRole('button', { name: 'Receive' }));
    const drawer = (await screen.findByText('Receive order PO-2026-000001')).closest('.MuiDrawer-paper') as HTMLElement;
    // Skip the gauze line; the gloves line needs its lot.
    const qty = within(drawer).getAllByLabelText(/Quantity/);
    fireEvent.change(qty[1]!, { target: { value: '' } });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Receive' }));
    expect(await within(drawer).findByText(/Lot is required/)).toBeInTheDocument();
    await userEvent.type(within(drawer).getAllByLabelText(/^Lot/)[0]!, 'GL-1');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Receive' }));
    await waitFor(() => expect(state.post).toHaveBeenCalled());
    expect(state.post.mock.calls[0]![0]).toMatchObject({ poId: 'po1', locationId: L1, lines: [{ poLineId: PL1, quantity: 200, lotNumber: 'GL-1' }] });
    expect(state.post.mock.calls[0]![0].idempotencyKey).toMatch(/^inv-/);
  });
});
