import { Button } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { Form } from '@/shared/form/Form';
import { useAppForm } from '@/shared/form/useAppForm';
import { DENTAL_SPECIALTIES } from '@/shared/generated/dental/specialties';
import { useUiStore } from '@/stores/uiStore';
import { OwnerBadge } from '../components/OwnerBadge';
import { SpecialtyChips, SpecialtyFields } from '../components/SpecialtyFields';
import { TransferOwnershipCard } from '../components/TransferOwnership';

const transfer = vi.hoisted(() => ({ calls: [] as { id: string; password: string }[] }));
vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  useTransferOwnership: () => ({
    mutateAsync: vi.fn(
      async (b: { id: string; password: string }) => (transfer.calls.push(b), { id: b.id }),
    ),
  }),
}));

function wrap(node: ReactNode) {
  const router = createMemoryRouter([{ path: '*', element: node }]);
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

function ThemeProbe() {
  const theme = useTheme();
  return <span data-testid="probe">{`${theme.direction}/${theme.palette.mode}`}</span>;
}

beforeEach(() => {
  transfer.calls.length = 0;
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  useUiStore.setState({ modePref: 'system' });
});

describe('owner identification', () => {
  it('shows a distinct Owner badge in English and Arabic (RTL, dark)', async () => {
    const { unmount } = wrap(<OwnerBadge />);
    expect(screen.getByTestId('owner-badge')).toHaveTextContent('Owner');
    expect(screen.getByTestId('owner-badge').className).toMatch(/colorWarning/);
    unmount();
    await i18n.changeLanguage('ar');
    useUiStore.setState({ modePref: 'dark' });
    wrap(
      <>
        <OwnerBadge />
        <ThemeProbe />
      </>,
    );
    expect(screen.getByTestId('owner-badge')).toHaveTextContent('المالك');
    expect(screen.getByTestId('probe')).toHaveTextContent('rtl/dark');
  });

  it('the Full access role is not labelled as the owner', () => {
    expect(i18n.t('seed:roles.owner', { lng: 'en' })).toBe('Full access');
    expect(i18n.t('seed:roles.owner', { lng: 'ar' })).toBe('صلاحيات كاملة');
  });
});

describe('ownership transfer', () => {
  const staff = {
    id: 'e0000000000000000000000e',
    version: 0,
    name: 'Hr Person',
    staffType: 'hr',
    status: 'active' as const,
  };

  it('needs the owner password before anything is sent', async () => {
    const user = userEvent.setup();
    wrap(<TransferOwnershipCard staff={staff} />);
    await user.click(screen.getByRole('button', { name: /Make Hr Person the owner/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }));
    expect(await within(dialog).findByText(/Your password is required/i)).toBeInTheDocument();
    expect(transfer.calls).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Your password/), 'Secret123!');
    await user.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }));
    await waitFor(() => expect(transfer.calls).toEqual([{ id: staff.id, password: 'Secret123!' }]));
  });
});

const schema = z.object({ specialties: z.array(z.string()), primarySpecialty: z.string() });
function SpecialtyForm({
  onSubmit,
  initial = [],
}: {
  onSubmit: (v: z.infer<typeof schema>) => void;
  initial?: string[];
}) {
  const form = useAppForm<z.infer<typeof schema>>({
    schema,
    defaultValues: { specialties: initial, primarySpecialty: initial[0] ?? '' },
  });
  return (
    <Form form={form} name="test.specialties" onSubmit={onSubmit}>
      <SpecialtyFields />
      <Button type="submit">Save</Button>
    </Form>
  );
}

describe('dental specialties', () => {
  it('has an Arabic and an English name for every code', () => {
    for (const code of DENTAL_SPECIALTIES) {
      for (const lng of ['en', 'ar']) {
        expect(i18n.exists(`staff:specialties.${code}`, { lng }), `${lng} ${code}`).toBe(true);
      }
    }
    expect(i18n.t('staff:specialties.orthodontics', { lng: 'ar' })).toBe('تقويم الأسنان');
  });

  it('multi-selects specialties and keeps the primary one among them', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    wrap(<SpecialtyForm onSubmit={onSubmit} />);
    expect(screen.getByLabelText(/Primary specialty/)).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByTestId('specialties-input'));
    await user.click(await screen.findByRole('option', { name: 'Orthodontics' }));
    await user.click(screen.getByTestId('specialties-input'));
    await user.click(await screen.findByRole('option', { name: 'Endodontics' }));
    // The first pick became primary automatically.
    await waitFor(() =>
      expect(screen.getByLabelText(/Primary specialty/)).toHaveTextContent('Orthodontics'),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      specialties: ['orthodontics', 'endodontics'],
      primarySpecialty: 'orthodontics',
    });
  });

  it('shows chips in the UI language with the primary first', async () => {
    await i18n.changeLanguage('ar');
    wrap(<SpecialtyChips specialties={['general', 'implantology']} primary="implantology" />);
    const chips = screen.getAllByText(/زراعة الأسنان|طب الأسنان العام/).map((e) => e.textContent);
    expect(chips).toEqual(['زراعة الأسنان', 'طب الأسنان العام']);
  });
});
