import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Printer } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PrintArea } from '@/features/clinical/components/shared';
import { PatientPicker } from '@/features/patients/components/PatientPicker';
import { addDaysLocal } from '@/features/scheduling/components/lookups';
import { formatDate, todayLocal } from '@/lib/dates';
import { MoneyText, useFormatMoney } from '@/shared/components/MoneyText';
import { PageHeader } from '@/shared/components/PageHeader';
import { EmptyState, ErrorState, PageSkeleton } from '@/shared/components/States';
import { usePermission } from '@/shared/rbac/usePermission';
import { useAccountLookup, useReport } from '../api';

const REPORTS = [
  'trial-balance',
  'profit-loss',
  'balance-sheet',
  'general-ledger',
  'ar-aging',
  'ap-aging',
  'vat',
  'daily-cash',
  'production',
  'patient-statement',
] as const;
type ReportKey = (typeof REPORTS)[number];

type Row = {
  id: string;
  code: string;
  name: string | null;
  systemKey?: string;
  type: string;
  isGroup: boolean;
  parentId?: string;
  debit: number;
  credit: number;
  balance: number;
};

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <TextField
      type="date"
      size="small"
      label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      InputLabelProps={{ shrink: true }}
      inputProps={{ dir: 'ltr' }}
    />
  );
}

function ReportFrame<T>({
  q,
  children,
  controls,
}: {
  q: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown };
  children: (d: T) => ReactNode;
  controls: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap alignItems="center">
          {controls}
        </Stack>
        <Button startIcon={<Printer size={16} />} onClick={() => window.print()} disabled={!q.data}>
          {t('actions.print')}
        </Button>
      </Stack>
      {q.isLoading ? (
        <PageSkeleton rows={6} />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data ? (
        <PrintArea>{children(q.data)}</PrintArea>
      ) : null}
    </Stack>
  );
}

const Num = ({ v, strong }: { v: number; strong?: boolean }) => (
  <TableCell align="right" sx={{ fontWeight: strong ? 800 : 400, whiteSpace: 'nowrap' }}>
    <MoneyText value={v} />
  </TableCell>
);

/** Ledger reports (09 §8). Every number comes from posted journal entries. */
export function ReportsPage() {
  const { t } = useTranslation('accounting');
  const [sp, setSp] = useSearchParams();
  const { can } = usePermission();
  const tab = (sp.get('r') as ReportKey) || 'profit-loss';
  const allowed = REPORTS.filter(
    (r) =>
      can('accounting.report.read') || (r === 'daily-cash' && can('billing.cashSession.manage')),
  );
  return (
    <Box>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      <Tabs
        value={tab}
        onChange={(_e, v: string) => setSp({ r: v }, { replace: true })}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mb: 4 }}
      >
        {allowed.map((r) => (
          <Tab key={r} value={r} label={t(`reports.names.${r}`)} />
        ))}
      </Tabs>
      {tab === 'trial-balance' && <TrialBalance />}
      {tab === 'profit-loss' && <ProfitLoss />}
      {tab === 'balance-sheet' && <BalanceSheet />}
      {tab === 'general-ledger' && <GeneralLedger />}
      {tab === 'ar-aging' && <Aging kind="ar" />}
      {tab === 'ap-aging' && <Aging kind="ap" />}
      {tab === 'vat' && <Vat />}
      {tab === 'daily-cash' && <DailyCash />}
      {tab === 'production' && <Production />}
      {tab === 'patient-statement' && <Statement />}
    </Box>
  );
}

const monthStart = () => `${todayLocal().slice(0, 7)}-01`;

function TrialBalance() {
  const { t } = useTranslation('accounting');
  const lookup = useAccountLookup();
  const [asOf, setAsOf] = useState(todayLocal());
  const q = useReport<{
    rows: (Row & { debitBalance: number; creditBalance: number })[];
    totalDebit: number;
    totalCredit: number;
    balanced: boolean;
  }>('trial-balance', { asOf });
  return (
    <ReportFrame
      q={q}
      controls={<DateInput label={t('reports.asOf')} value={asOf} onChange={setAsOf} />}
    >
      {(d) => (
        <>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('reports.names.trial-balance')} · {asOf}
          </Typography>
          {!d.balanced && <Alert severity="error">{t('reports.notBalanced')}</Alert>}
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reports.account')}</TableCell>
                <TableCell align="right">{t('reports.debit')}</TableCell>
                <TableCell align="right">{t('reports.credit')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell dir="auto">{lookup.label(r.id) || r.code}</TableCell>
                  <Num v={r.debitBalance} />
                  <Num v={r.creditBalance} />
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={{ fontWeight: 800 }}>{t('reports.total')}</TableCell>
                <Num v={d.totalDebit} strong />
                <Num v={d.totalCredit} strong />
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </ReportFrame>
  );
}

function AccountTree({ rows, title, total }: { rows: Row[]; title: string; total: number }) {
  const lookup = useAccountLookup();
  const { t } = useTranslation('accounting');
  const depth = (r: Row): number =>
    r.parentId
      ? 1 + depth(rows.find((x) => x.id === r.parentId) ?? { ...r, parentId: undefined })
      : 0;
  const shown = rows.filter((r) => r.balance !== 0);
  return (
    <Table size="small" sx={{ mb: 3 }}>
      <TableHead>
        <TableRow>
          <TableCell sx={{ fontWeight: 800 }}>{title}</TableCell>
          <TableCell align="right" />
        </TableRow>
      </TableHead>
      <TableBody>
        {shown.map((r) => (
          <TableRow key={r.id}>
            <TableCell
              sx={{
                paddingInlineStart: `${16 + depth(r) * 18}px`,
                fontWeight: r.isGroup ? 700 : 400,
              }}
              dir="auto"
            >
              {lookup.label(r.id) || r.code}
            </TableCell>
            <Num v={r.balance} strong={r.isGroup} />
          </TableRow>
        ))}
        <TableRow>
          <TableCell sx={{ fontWeight: 800 }}>{t('reports.total')}</TableCell>
          <Num v={total} strong />
        </TableRow>
      </TableBody>
    </Table>
  );
}

function ProfitLoss() {
  const { t } = useTranslation('accounting');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const q = useReport<{
    revenue: Row[];
    expense: Row[];
    totalRevenue: number;
    totalExpense: number;
    netIncome: number;
    previous?: { totalRevenue: number; totalExpense: number; netIncome: number };
  }>('profit-loss', { from, to, compare: 'true' });
  return (
    <ReportFrame
      q={q}
      controls={
        <>
          <DateInput label={t('reports.from')} value={from} onChange={setFrom} />
          <DateInput label={t('reports.to')} value={to} onChange={setTo} />
        </>
      }
    >
      {(d) => (
        <>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('reports.names.profit-loss')} · {from} – {to}
          </Typography>
          <AccountTree rows={d.revenue} title={t('reports.revenue')} total={d.totalRevenue} />
          <AccountTree rows={d.expense} title={t('reports.expenses')} total={d.totalExpense} />
          <Grid container spacing={3}>
            {(
              [
                ['revenue', d.totalRevenue, d.previous?.totalRevenue],
                ['expenses', d.totalExpense, d.previous?.totalExpense],
                ['netIncome', d.netIncome, d.previous?.netIncome],
              ] as [string, number, number | undefined][]
            ).map(([k, v, p]) => (
              <Grid item xs={12} sm={4} key={k}>
                <Card variant="outlined">
                  <CardContent>
                    <Typography variant="caption" color="text.secondary">
                      {t(`reports.${k}`)}
                    </Typography>
                    <Typography
                      variant="h5"
                      color={k === 'netIncome' && v < 0 ? 'error.main' : undefined}
                    >
                      <MoneyText value={v} />
                    </Typography>
                    {p !== undefined && (
                      <Typography variant="caption" color="text.secondary">
                        {t('reports.previous')}: <MoneyText value={p} />
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </ReportFrame>
  );
}

function BalanceSheet() {
  const { t } = useTranslation('accounting');
  const [asOf, setAsOf] = useState(todayLocal());
  const q = useReport<{
    assets: Row[];
    liabilities: Row[];
    equity: Row[];
    currentEarnings: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    balanced: boolean;
  }>('balance-sheet', { asOf });
  return (
    <ReportFrame
      q={q}
      controls={<DateInput label={t('reports.asOf')} value={asOf} onChange={setAsOf} />}
    >
      {(d) => (
        <>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('reports.names.balance-sheet')} · {asOf}
          </Typography>
          {!d.balanced && <Alert severity="error">{t('reports.notBalanced')}</Alert>}
          <AccountTree rows={d.assets} title={t('types.asset')} total={d.totalAssets} />
          <AccountTree
            rows={d.liabilities}
            title={t('types.liability')}
            total={d.totalLiabilities}
          />
          <AccountTree
            rows={d.equity}
            title={t('types.equity')}
            total={d.totalEquity - d.currentEarnings}
          />
          <Stack direction="row" justifyContent="space-between" sx={{ px: 2 }}>
            <Typography>{t('reports.currentEarnings')}</Typography>
            <MoneyText value={d.currentEarnings} />
          </Stack>
          <Stack
            direction="row"
            justifyContent="space-between"
            sx={{ px: 2, mt: 2, fontWeight: 800 }}
          >
            <Typography fontWeight={800}>{t('reports.liabilitiesEquity')}</Typography>
            <Typography fontWeight={800}>
              <MoneyText value={d.totalLiabilities + d.totalEquity} />
            </Typography>
          </Stack>
        </>
      )}
    </ReportFrame>
  );
}

function GeneralLedger() {
  const { t, i18n } = useTranslation('accounting');
  const lookup = useAccountLookup();
  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const q = useReport<{
    opening: number;
    closing: number;
    lines: {
      entryId: string;
      number: string;
      date: string;
      source: string;
      memo: string;
      description: string;
      debit: number;
      credit: number;
      balance: number;
    }[];
  }>('general-ledger', { accountId, from, to }, Boolean(accountId));
  return (
    <ReportFrame
      q={accountId ? q : { ...q, data: undefined, isLoading: false }}
      controls={
        <>
          <Autocomplete
            size="small"
            sx={{ minWidth: 300 }}
            options={lookup.postable}
            value={lookup.byId.get(accountId) ?? null}
            onChange={(_e, v) => setAccountId(v?.id ?? '')}
            getOptionLabel={(o) => lookup.label(o)}
            renderInput={(p) => <TextField {...p} label={t('reports.account')} />}
          />
          <DateInput label={t('reports.from')} value={from} onChange={setFrom} />
          <DateInput label={t('reports.to')} value={to} onChange={setTo} />
        </>
      }
    >
      {(d) => (
        <>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {lookup.label(accountId)}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reports.date')}</TableCell>
                <TableCell>{t('reports.entry')}</TableCell>
                <TableCell>{t('reports.memo')}</TableCell>
                <TableCell align="right">{t('reports.debit')}</TableCell>
                <TableCell align="right">{t('reports.credit')}</TableCell>
                <TableCell align="right">{t('reports.balance')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5}>{t('reports.opening')}</TableCell>
                <Num v={d.opening} strong />
              </TableRow>
              {d.lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(l.date, i18n.language, 'll')}</TableCell>
                  <TableCell dir="ltr">{l.number}</TableCell>
                  <TableCell dir="auto">{l.description || l.memo}</TableCell>
                  <TableCell align="right">
                    {l.debit ? <MoneyText value={l.debit} /> : ''}
                  </TableCell>
                  <TableCell align="right">
                    {l.credit ? <MoneyText value={l.credit} /> : ''}
                  </TableCell>
                  <Num v={l.balance} />
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={5} sx={{ fontWeight: 800 }}>
                  {t('reports.closing')}
                </TableCell>
                <Num v={d.closing} strong />
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </ReportFrame>
  );
}

function Aging({ kind }: { kind: 'ar' | 'ap' }) {
  const { t } = useTranslation('accounting');
  const [asOf, setAsOf] = useState(todayLocal());
  const [payer, setPayer] = useState<'patient' | 'insurance'>('patient');
  type AgingRow = {
    key: string;
    name: string;
    current: number;
    d30: number;
    d60: number;
    d90: number;
    over90: number;
    total: number;
  };
  const q = useReport<{ rows: AgingRow[]; totals: Partial<AgingRow> }>(
    kind === 'ar' ? 'ar-aging' : 'ap-aging',
    { asOf, ...(kind === 'ar' ? { payer } : {}) },
  );
  const cols = ['current', 'd30', 'd60', 'd90', 'over90', 'total'] as const;
  return (
    <ReportFrame
      q={q}
      controls={
        <>
          <DateInput label={t('reports.asOf')} value={asOf} onChange={setAsOf} />
          {kind === 'ar' && (
            <TextField
              select
              size="small"
              label={t('reports.payer')}
              value={payer}
              onChange={(e) => setPayer(e.target.value as typeof payer)}
            >
              <MenuItem value="patient">{t('reports.patients')}</MenuItem>
              <MenuItem value="insurance">{t('reports.insurers')}</MenuItem>
            </TextField>
          )}
        </>
      }
    >
      {(d) =>
        d.rows.length === 0 ? (
          <EmptyState compact title={t('reports.nothingDue')} />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reports.name')}</TableCell>
                {cols.map((c) => (
                  <TableCell key={c} align="right">
                    {t(`reports.aging.${c}`)}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell dir="auto">{r.name}</TableCell>
                  {cols.map((c) => (
                    <Num key={c} v={r[c]} strong={c === 'total'} />
                  ))}
                </TableRow>
              ))}
              {kind === 'ar' && (
                <TableRow>
                  <TableCell sx={{ fontWeight: 800 }}>{t('reports.total')}</TableCell>
                  {cols.map((c) => (
                    <Num key={c} v={d.totals[c] ?? 0} strong />
                  ))}
                </TableRow>
              )}
            </TableBody>
          </Table>
        )
      }
    </ReportFrame>
  );
}

function Vat() {
  const { t } = useTranslation('accounting');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const q = useReport<{ outputVat: number; inputVat: number; payable: number }>('vat', {
    from,
    to,
  });
  return (
    <ReportFrame
      q={q}
      controls={
        <>
          <DateInput label={t('reports.from')} value={from} onChange={setFrom} />
          <DateInput label={t('reports.to')} value={to} onChange={setTo} />
        </>
      }
    >
      {(d) => (
        <Table size="small">
          <TableBody>
            <TableRow>
              <TableCell>{t('reports.outputVat')}</TableCell>
              <Num v={d.outputVat} />
            </TableRow>
            <TableRow>
              <TableCell>{t('reports.inputVat')}</TableCell>
              <Num v={-d.inputVat} />
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 800 }}>
                {d.payable >= 0 ? t('reports.vatPayable') : t('reports.vatRefundable')}
              </TableCell>
              <Num v={Math.abs(d.payable)} strong />
            </TableRow>
          </TableBody>
        </Table>
      )}
    </ReportFrame>
  );
}

function DailyCash() {
  const { t } = useTranslation('accounting');
  const { t: tb } = useTranslation('billing');
  const fmt = useFormatMoney();
  const [date, setDate] = useState(todayLocal());
  const q = useReport<{
    byMethod: { method: string; count: number; total: number }[];
    total: number;
    refunds: number;
    sessions: {
      id: string;
      openingFloat: number;
      expected?: number;
      counted?: number;
      difference?: number;
      status: string;
    }[];
  }>('daily-cash', { date });
  return (
    <ReportFrame
      q={q}
      controls={<DateInput label={t('reports.date')} value={date} onChange={setDate} />}
    >
      {(d) => (
        <>
          <Table size="small" sx={{ mb: 3 }}>
            <TableHead>
              <TableRow>
                <TableCell>{t('reports.method')}</TableCell>
                <TableCell align="right">{t('reports.count')}</TableCell>
                <TableCell align="right">{t('reports.total')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.byMethod.map((m) => (
                <TableRow key={m.method}>
                  <TableCell>{tb(`methods.${m.method}`)}</TableCell>
                  <TableCell align="right">{m.count}</TableCell>
                  <Num v={m.total} />
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={{ fontWeight: 800 }}>{t('reports.total')}</TableCell>
                <TableCell />
                <Num v={d.total} strong />
              </TableRow>
              <TableRow>
                <TableCell>{t('reports.refunds')}</TableCell>
                <TableCell />
                <Num v={-d.refunds} />
              </TableRow>
            </TableBody>
          </Table>
          {d.sessions.map((s) => (
            <Typography key={s.id} variant="body2">
              {t('reports.session')}: {fmt(s.openingFloat)} →{' '}
              {s.expected !== undefined
                ? `${fmt(s.expected)} / ${fmt(s.counted ?? 0)} (${fmt(s.difference ?? 0)})`
                : t('reports.stillOpen')}
            </Typography>
          ))}
        </>
      )}
    </ReportFrame>
  );
}

function Production() {
  const { t } = useTranslation('accounting');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const q = useReport<{
    rows: {
      dentistId: string;
      name: string;
      procedures: number;
      production: number;
      collection: number;
      writtenOff?: number;
    }[];
  }>('production', { from, to });
  return (
    <ReportFrame
      q={q}
      controls={
        <>
          <DateInput label={t('reports.from')} value={from} onChange={setFrom} />
          <DateInput label={t('reports.to')} value={to} onChange={setTo} />
        </>
      }
    >
      {(d) => (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('reports.dentist')}</TableCell>
              <TableCell align="right">{t('reports.procedures')}</TableCell>
              <TableCell align="right">{t('reports.production')}</TableCell>
              <TableCell align="right">{t('reports.collection')}</TableCell>
              <TableCell align="right">{t('reports.writtenOff')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {d.rows.map((r) => (
              <TableRow key={r.dentistId}>
                <TableCell dir="auto">{r.name || t('reports.unassigned')}</TableCell>
                <TableCell align="right">{r.procedures}</TableCell>
                <Num v={r.production} />
                <Num v={r.collection} />
                <Num v={r.writtenOff ?? 0} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ReportFrame>
  );
}

function Statement() {
  const { t, i18n } = useTranslation('accounting');
  const [patient, setPatient] = useState<{ id: string; fullName: string } | null>(null);
  const [from, setFrom] = useState(addDaysLocal(todayLocal(), -365));
  const [to, setTo] = useState(todayLocal());
  const q = useReport<{
    patient: { fullName: string; fileNumber: string } | null;
    opening: number;
    closing: number;
    lines: {
      date: string;
      number?: string;
      source: string;
      memo: string;
      charge: number;
      credit: number;
      balance: number;
    }[];
  }>('patient-statement', { patientId: patient?.id, from, to }, Boolean(patient));
  return (
    <ReportFrame
      q={patient ? q : { ...q, data: undefined, isLoading: false }}
      controls={
        <>
          <Box sx={{ minWidth: 280 }}>
            <PatientPicker value={patient} onChange={setPatient} />
          </Box>
          <DateInput label={t('reports.from')} value={from} onChange={setFrom} />
          <DateInput label={t('reports.to')} value={to} onChange={setTo} />
        </>
      }
    >
      {(d) => (
        <>
          <Typography variant="h5">{t('reports.names.patient-statement')}</Typography>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {d.patient?.fullName} · {d.patient?.fileNumber} · {from} – {to}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('reports.date')}</TableCell>
                <TableCell>{t('reports.document')}</TableCell>
                <TableCell align="right">{t('reports.charges')}</TableCell>
                <TableCell align="right">{t('reports.payments')}</TableCell>
                <TableCell align="right">{t('reports.balance')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell colSpan={4}>{t('reports.opening')}</TableCell>
                <Num v={d.opening} strong />
              </TableRow>
              {d.lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>{formatDate(l.date, i18n.language, 'll')}</TableCell>
                  <TableCell dir="auto">
                    {t(`sources.${l.source}`, { defaultValue: l.source })} · {l.memo}
                  </TableCell>
                  <TableCell align="right">
                    {l.charge ? <MoneyText value={l.charge} /> : ''}
                  </TableCell>
                  <TableCell align="right">
                    {l.credit ? <MoneyText value={l.credit} /> : ''}
                  </TableCell>
                  <Num v={l.balance} />
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={4} sx={{ fontWeight: 800 }}>
                  {t('reports.closing')}
                </TableCell>
                <Num v={d.closing} strong />
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
    </ReportFrame>
  );
}
