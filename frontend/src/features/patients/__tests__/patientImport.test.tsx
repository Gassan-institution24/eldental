import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AppThemeProvider } from '@/app/providers/AppThemeProvider';
import { ConfirmProvider } from '@/shared/components/ConfirmDialog';
import { parseCsv, toCsv } from '@/lib/csv';
import { autoMap, buildRows, toIsoDate } from '../importFields';

/** Phase 3b slice 6: CSV parsing, header auto-mapping and the import wizard. */

const state = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock('@/shared/rbac/usePermission', () => ({
  usePermission: () => ({ can: () => true }),
  useFieldAccess: () => ({ canSee: () => true, canEdit: () => true, isMasked: () => false, access: () => 'write' }),
}));
vi.mock('../api/patients', async (orig) => ({
  ...(await orig<typeof import('../api/patients')>()),
  usePatientImport: () => ({
    isPending: false,
    mutateAsync: (b: Record<string, unknown>) => {
      state.calls.push(b);
      if (b.dryRun)
        return Promise.resolve({
          dryRun: true,
          summary: { total: 3, ok: 1, duplicate: 1, error: 1 },
          rows: [
            { index: 0, status: 'ok' },
            { index: 1, status: 'error', errors: [{ path: 'phone', code: 'invalid_phone' }] },
            { index: 2, status: 'duplicate', fields: ['phone'], duplicateOf: { id: 'p9', fileNumber: 'P-000009', fullName: 'Old Patient' } },
          ],
        });
      return Promise.resolve({ dryRun: false, summary: { total: 3, ok: 1, duplicate: 1, error: 1, created: b.allowDuplicates ? 2 : 1 }, rows: [{ index: 0, status: 'created', id: 'n1', fileNumber: 'P-000010' }] });
    },
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

const both = (k: string) => [i18n.getFixedT('en', 'patients')(k), i18n.getFixedT('ar', 'patients')(k)];

beforeAll(async () => {
  await import('../pages/PatientImportPage');
}, 30_000);
beforeEach(() => {
  state.calls.length = 0;
});
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('csv', () => {
  it('parses BOM, quotes, embedded separators/newlines, CRLF and semicolons', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"multi\nline",2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
    expect(parseCsv('الاسم;الهاتف\nلينا;0791234567')).toEqual([
      ['الاسم', 'الهاتف'],
      ['لينا', '0791234567'],
    ]);
    expect(parseCsv(toCsv([['a,b', 'c"d'], [1, null]]))).toEqual([
      ['a,b', 'c"d'],
      ['1', ''],
    ]);
  });

  it('maps Arabic and English headers and builds nested rows', () => {
    const map = autoMap(['First Name', 'اسم العائلة', 'رقم الجوال', 'الجنس', 'تاريخ الميلاد', 'Tags', 'Unknown'], both);
    expect(map).toEqual(['name.first', 'name.family', 'phone', 'gender', 'dateOfBirth', 'tags', '']);
    const rows = buildRows([['Lina', 'Haddad', '0791234567', 'أنثى', '٠٥/٠٤/١٩٩٠', 'VIP; ortho', 'x']], map);
    expect(rows).toEqual([{ name: { first: 'Lina', family: 'Haddad' }, phone: '0791234567', gender: 'female', dateOfBirth: '1990-04-05', tags: ['VIP', 'ortho'] }]);
    expect(toIsoDate('2024-01-31')).toBe('2024-01-31');
  });
});

describe('import wizard', () => {
  const csv = 'First name,Family name,Phone\nLina,Haddad,0791234567\nX,Y,123\nOmar,Saleh,0791234500\n';
  const upload = async () => {
    const file = new File([csv], 'patients.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [file] } });
    return screen.findByText(/patients\.csv — 3 rows/);
  };

  it('maps, checks with a dry run, shows translated errors and duplicates, then imports', async () => {
    const { PatientImportPage } = await import('../pages/PatientImportPage');
    wrap(<PatientImportPage />);
    await upload();
    await userEvent.click(screen.getByRole('button', { name: 'Check rows' }));
    await waitFor(() => expect(state.calls[0]).toMatchObject({ dryRun: true }));
    expect((state.calls[0]!.rows as unknown[])[0]).toEqual({ name: { first: 'Lina', family: 'Haddad' }, phone: '0791234567' });

    expect(within(screen.getByTestId('import-summary')).getByText('1 ready')).toBeInTheDocument();
    expect(within(screen.getByTestId('row-1')).getByText(/^Mobile: Enter a valid phone number/)).toBeInTheDocument();
    expect(within(screen.getByTestId('row-2')).getByText('Old Patient (P-000009)')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/Import possible duplicates too/));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 patients' }));
    await waitFor(() => expect(state.calls[1]).toMatchObject({ dryRun: false, allowDuplicates: true }));
    expect(await screen.findByText('2 patients imported', { selector: 'h5' })).toBeInTheDocument();
  });

  it('blocks the check until required fields are matched, in Arabic', async () => {
    await i18n.changeLanguage('ar');
    const { PatientImportPage } = await import('../pages/PatientImportPage');
    wrap(<PatientImportPage />);
    const file = new File(['الاسم,ملاحظات\nلينا,x\n'], 'p.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [file] } });
    expect(await screen.findByText(/طابق هذه الحقول المطلوبة/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'فحص الصفوف' })).toBeDisabled();
  });

  it('rejects files that are not CSV', async () => {
    const { PatientImportPage } = await import('../pages/PatientImportPage');
    wrap(<PatientImportPage />);
    fireEvent.change(screen.getByTestId('csv-input'), { target: { files: [new File(['x'], 'p.xlsx')] } });
    expect(await screen.findByText(/Choose a .csv file/)).toBeInTheDocument();
  });
});
