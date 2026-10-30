import { Box, Card, InputAdornment, Stack, TextField } from '@mui/material';
import {
  DataGrid,
  type GridColDef,
  type GridRowParams,
  type GridSortModel,
  type GridValidRowModel,
} from '@mui/x-data-grid';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { trackActivity } from '@/lib/telemetry';
import { useFieldScope } from '@/shared/rbac/fieldAccess';
import { EmptySearch, EmptyState, ErrorState } from './States';

export type Column<R extends GridValidRowModel> = GridColDef<R> & { fieldKey?: string };

type Props<R extends GridValidRowModel> = {
  rows: R[];
  total?: number;
  columns: Column<R>[];
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: R) => void;
  /** Server pagination (default). For small unpaged lists pass `clientSide`. */
  clientSide?: boolean;
  searchable?: boolean;
  toolbar?: ReactNode;
  empty?: ReactNode;
  getRowId?: (r: R) => string;
  dense?: boolean;
};

/** URL-synced list state (`?page&limit&sort&q`) so filters are shareable (16 §3). */
export function useListParams(defaults: { limit?: number; sort?: string } = {}) {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page') ?? 1);
  const limit = Number(sp.get('limit') ?? defaults.limit ?? 25);
  const sort = sp.get('sort') ?? defaults.sort ?? '';
  const q = sp.get('q') ?? '';
  const set = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, String(v));
    }
    setSp(next, { replace: true });
  };
  const filter = (key: string) => sp.get(key) ?? '';
  return {
    page,
    limit,
    sort,
    q,
    set,
    filter,
    params: { page, limit, ...(sort ? { sort } : {}), ...(q ? { q } : {}) },
  };
}

/**
 * DataGrid wrapper: server pagination/sort, search, field-permission-aware columns (hidden
 * columns are removed so they can't be re-enabled), skeleton/empty/error states (16 §3–4).
 */
export function DataTable<R extends GridValidRowModel>({
  rows,
  total,
  columns,
  loading,
  error,
  onRetry,
  onRowClick,
  clientSide,
  searchable = true,
  toolbar,
  empty,
  getRowId,
  dense,
}: Props<R>) {
  const { t } = useTranslation();
  const scope = useFieldScope();
  const lp = useListParams();
  const [search, setSearch] = useState(lp.q);

  useEffect(() => {
    const id = setTimeout(() => {
      if (search !== lp.q) {
        lp.set({ q: search, page: 1 });
        if (search) trackActivity({ type: 'search', meta: { results: total ?? 0 } });
      }
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const cols = useMemo(
    () =>
      columns
        .filter((c) => !c.fieldKey || scope.canSee(c.fieldKey))
        .map((c) => ({ sortable: !clientSide ? (c.sortable ?? false) : true, ...c })),
    [columns, scope, clientSide],
  );
  const sortModel: GridSortModel = lp.sort
    ? [{ field: lp.sort.replace(/^-/, ''), sort: lp.sort.startsWith('-') ? 'desc' : 'asc' }]
    : [];

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={onRetry} compact />
      </Card>
    );
  }

  const isEmpty = !loading && rows.length === 0;

  return (
    <Card sx={{ overflow: 'hidden' }}>
      {(searchable || toolbar) && (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={3}
          sx={{ p: 4, borderBottom: 1, borderColor: 'divider' }}
          alignItems={{ sm: 'center' }}
        >
          {searchable && (
            <TextField
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('actions.search')}
              sx={{ maxWidth: { sm: 340 } }}
              inputProps={{ dir: 'auto', 'aria-label': t('actions.search') }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={16} />
                  </InputAdornment>
                ),
              }}
            />
          )}
          <Box sx={{ flex: 1 }} />
          {toolbar}
        </Stack>
      )}
      {isEmpty ? (
        lp.q ? (
          <EmptySearch query={lp.q} onClear={() => setSearch('')} />
        ) : (
          (empty ?? <EmptyState compact />)
        )
      ) : (
        <DataGrid<R>
          rows={rows}
          columns={cols}
          getRowId={getRowId ?? ((r) => String((r as { id?: string }).id))}
          loading={loading}
          autoHeight
          density={dense ? 'compact' : 'standard'}
          disableRowSelectionOnClick
          disableColumnFilter
          onRowClick={onRowClick ? (p: GridRowParams<R>) => onRowClick(p.row) : undefined}
          paginationMode={clientSide ? 'client' : 'server'}
          sortingMode={clientSide ? 'client' : 'server'}
          rowCount={clientSide ? undefined : (total ?? 0)}
          pageSizeOptions={[10, 25, 50, 100]}
          paginationModel={clientSide ? undefined : { page: lp.page - 1, pageSize: lp.limit }}
          onPaginationModelChange={
            clientSide
              ? undefined
              : (m) =>
                  lp.set({ page: m.page + 1, limit: m.pageSize === 25 ? undefined : m.pageSize })
          }
          sortModel={clientSide ? undefined : sortModel}
          onSortModelChange={
            clientSide
              ? undefined
              : (m) =>
                  lp.set({
                    sort: m[0] ? `${m[0].sort === 'desc' ? '-' : ''}${m[0].field}` : undefined,
                    page: 1,
                  })
          }
          slotProps={{ loadingOverlay: { variant: 'skeleton', noRowsVariant: 'skeleton' } }}
          sx={{
            border: 0,
            borderRadius: 0,
            '& .MuiDataGrid-row': { cursor: onRowClick ? 'pointer' : 'default' },
            '& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus': { outline: 'none' },
          }}
        />
      )}
    </Card>
  );
}
