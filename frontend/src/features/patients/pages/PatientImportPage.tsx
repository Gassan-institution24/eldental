import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  Link,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { CheckCircle2, Download, FileUp } from 'lucide-react';
import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { parseCsv, toCsv } from '@/lib/csv';
import { PageHeader } from '@/shared/components/PageHeader';
import { SectionCard } from '@/shared/components/SectionCard';
import { useNotify } from '@/shared/hooks/useNotify';
import { usePatientImport, type ImportCheckRow, type ImportCommitRow, type ImportFieldError, type ImportResult } from '../api/patients';
import { autoMap, buildRows, FIELD_BY_KEY, IMPORT_FIELDS } from '../importFields';

export const IMPORT_MAX_ROWS = 2000;
const PAGE = 50;
type Step = 'upload' | 'map' | 'preview' | 'done';

/** The fields' labels in both languages, so an Arabic or English template maps itself. */
function useLabels() {
  const { t, i18n } = useTranslation('patients');
  return useMemo(
    () => ({
      label: (labelKey: string) => t(labelKey),
      both: (labelKey: string) => [i18n.getFixedT('en', 'patients')(labelKey), i18n.getFixedT('ar', 'patients')(labelKey)],
    }),
    [t, i18n],
  );
}

function useErrorText() {
  const { t } = useTranslation();
  const { label } = useLabels();
  return (e: ImportFieldError) => {
    const f = FIELD_BY_KEY.get(e.path) ?? FIELD_BY_KEY.get(e.path.split('.')[0] ?? '');
    const name = f ? label(f.label) : e.path;
    return `${name}: ${t(`validation:${e.code}`, { field: name, ...(e.params ?? {}), defaultValue: t('validation:invalid', { field: name }) })}`;
  };
}

/** FileReader works in every browser (and in tests), unlike Blob.text() on older engines. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error);
    r.readAsText(file, 'utf-8');
  });
}

/** CSV import of patients (Phase 3b slice 6): upload → map columns → dry run → import. */
export function PatientImportPage() {
  const { t } = useTranslation('patients');
  const notify = useNotify();
  const labels = useLabels();
  const errorText = useErrorText();
  const run = usePatientImport();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [lines, setLines] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [check, setCheck] = useState<ImportResult<ImportCheckRow> | null>(null);
  const [result, setResult] = useState<ImportResult<ImportCommitRow> | null>(null);
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error' | 'duplicate'>('all');
  const [page, setPage] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);

  const missing = IMPORT_FIELDS.filter((f) => f.required && !mapping.includes(f.key));
  const rows = useMemo(() => buildRows(lines, mapping), [lines, mapping]);

  const readFile = async (file: File) => {
    setFileError(null);
    if (!/\.(csv|txt)$/i.test(file.name)) return setFileError(t('import.notCsv'));
    const parsed = parseCsv(await readText(file));
    if (parsed.length < 2) return setFileError(t('import.emptyFile'));
    if (parsed.length - 1 > IMPORT_MAX_ROWS) return setFileError(t('import.tooMany', { max: IMPORT_MAX_ROWS }));
    const [head, ...body] = parsed;
    setFileName(file.name);
    setHeaders(head!);
    setLines(body);
    setMapping(autoMap(head!, labels.both));
    setCheck(null);
    setStep('map');
  };

  const dryRun = async () => {
    const res = (await run.mutateAsync({ rows, dryRun: true })) as ImportResult<ImportCheckRow>;
    setCheck(res);
    setPage(0);
    setFilter('all');
    setStep('preview');
  };

  const commit = async () => {
    const res = (await run.mutateAsync({ rows, dryRun: false, allowDuplicates })) as ImportResult<ImportCommitRow>;
    setResult(res);
    notify.success(t('import.imported', { count: res.summary.created ?? 0 }));
    setStep('done');
  };

  const downloadTemplate = () => {
    const sample: Record<string, string> = { 'name.first': 'Lina', 'name.family': 'Haddad', phone: '0791234567', gender: 'female', dateOfBirth: '1990-04-12' };
    const csv = toCsv([IMPORT_FIELDS.map((f) => labels.label(f.label)), IMPORT_FIELDS.map((f) => sample[f.key] ?? '')]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patients-template.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const shown = (check?.rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const willImport = check ? check.summary.ok + (allowDuplicates ? check.summary.duplicate : 0) : 0;
  const nameOf = (i: number) => {
    const n = rows[i]?.name as { first?: string; family?: string } | undefined;
    return [n?.first, n?.family].filter(Boolean).join(' ') || '—';
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: t('title'), to: '/clinic/patients' }, { label: t('import.title') }]}
        title={t('import.title')}
        subtitle={t('import.subtitle', { max: IMPORT_MAX_ROWS })}
        actions={
          <Button variant="outlined" startIcon={<Download size={18} />} onClick={downloadTemplate}>
            {t('import.template')}
          </Button>
        }
      />
      <Stepper activeStep={['upload', 'map', 'preview', 'done'].indexOf(step)} alternativeLabel sx={{ mb: 6 }}>
        {(['upload', 'map', 'preview', 'done'] as const).map((s) => (
          <Step key={s}>
            <StepLabel>{t(`import.steps.${s}`)}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {step === 'upload' && (
        <SectionCard title={t('import.steps.upload')} subtitle={t('import.uploadHint')}>
          <Box
            onDragOver={(e: DragEvent) => e.preventDefault()}
            onDrop={(e: DragEvent) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void readFile(f);
            }}
            sx={{ border: 2, borderStyle: 'dashed', borderColor: 'divider', borderRadius: 3, p: 8, textAlign: 'center' }}
          >
            <FileUp size={32} />
            <Typography sx={{ mt: 2 }}>{t('import.drop')}</Typography>
            <Button sx={{ mt: 3 }} variant="contained" onClick={() => input.current?.click()}>
              {t('import.choose')}
            </Button>
            <input
              ref={input}
              type="file"
              hidden
              accept=".csv,text/csv"
              data-testid="csv-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void readFile(f);
              }}
            />
          </Box>
          {fileError && (
            <Alert severity="error" sx={{ mt: 3 }}>
              {fileError}
            </Alert>
          )}
        </SectionCard>
      )}

      {step === 'map' && (
        <SectionCard
          title={t('import.steps.map')}
          subtitle={t('import.mapHint', { file: fileName, count: lines.length })}
          footer={
            <>
              <Button onClick={() => setStep('upload')}>{t('common:actions.back')}</Button>
              <Button variant="contained" disabled={missing.length > 0 || run.isPending} onClick={() => void dryRun().catch(notify.error)}>
                {t('import.check')}
              </Button>
            </>
          }
        >
          {missing.length > 0 && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              {t('import.missing', { fields: missing.map((f) => labels.label(f.label)).join('، ') })}
            </Alert>
          )}
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('import.column')}</TableCell>
                  <TableCell>{t('import.sample')}</TableCell>
                  <TableCell sx={{ minWidth: 220 }}>{t('import.field')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {headers.map((h, i) => (
                  <TableRow key={`${h}-${i}`}>
                    <TableCell dir="auto">{h || '—'}</TableCell>
                    <TableCell dir="auto" sx={{ color: 'text.secondary' }}>
                      {lines[0]?.[i] ?? ''}
                    </TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={mapping[i] ?? ''}
                        inputProps={{ 'data-testid': `map-${i}`, 'aria-label': h }}
                        onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value : x === e.target.value ? '' : x)))}
                      >
                        <MenuItem value="">{t('import.ignore')}</MenuItem>
                        {IMPORT_FIELDS.map((f) => (
                          <MenuItem key={f.key} value={f.key}>
                            {labels.label(f.label)}
                            {f.required ? ' *' : ''}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </SectionCard>
      )}

      {step === 'preview' && check && (
        <SectionCard
          title={t('import.steps.preview')}
          subtitle={t('import.previewHint')}
          footer={
            <>
              <Button onClick={() => setStep('map')}>{t('common:actions.back')}</Button>
              <Button variant="contained" disabled={willImport === 0 || run.isPending} onClick={() => void commit().catch(notify.error)}>
                {t('import.importN', { count: willImport })}
              </Button>
            </>
          }
        >
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 3 }} data-testid="import-summary">
            <Chip color="success" label={t('import.okCount', { count: check.summary.ok })} />
            <Chip color="warning" label={t('import.duplicateCount', { count: check.summary.duplicate })} />
            <Chip color="error" label={t('import.errorCount', { count: check.summary.error })} />
          </Stack>
          {check.summary.duplicate > 0 && (
            <FormControlLabel
              control={<Checkbox checked={allowDuplicates} onChange={(e) => setAllowDuplicates(e.target.checked)} />}
              label={t('import.allowDuplicates')}
            />
          )}
          <ToggleButtonGroup
            size="small"
            exclusive
            value={filter}
            onChange={(_e, v: typeof filter | null) => {
              if (v) {
                setFilter(v);
                setPage(0);
              }
            }}
            sx={{ display: 'flex', my: 2 }}
          >
            <ToggleButton value="all">{t('import.filterAll')}</ToggleButton>
            <ToggleButton value="error">{t('import.filterErrors')}</ToggleButton>
            <ToggleButton value="duplicate">{t('import.filterDuplicates')}</ToggleButton>
          </ToggleButtonGroup>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('import.line')}</TableCell>
                  <TableCell>{t('fields.fullName')}</TableCell>
                  <TableCell>{t('import.status')}</TableCell>
                  <TableCell>{t('import.details')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                  <TableRow key={r.index} data-testid={`row-${r.index}`}>
                    <TableCell>{r.index + 2}</TableCell>
                    <TableCell dir="auto">{nameOf(r.index)}</TableCell>
                    <TableCell>
                      <Chip size="small" color={r.status === 'ok' ? 'success' : r.status === 'duplicate' ? 'warning' : 'error'} label={t(`import.statuses.${r.status}`)} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'pre-line' }}>
                      {r.status === 'error' && r.errors.map(errorText).join('\n')}
                      {r.status === 'duplicate' &&
                        (r.duplicateOf ? (
                          <>
                            {t('import.sameAs')}{' '}
                            <Link component={RouterLink} to={`/clinic/patients/${r.duplicateOf.id}`} dir="auto">
                              {r.duplicateOf.fullName} ({r.duplicateOf.fileNumber})
                            </Link>
                          </>
                        ) : (
                          t('import.sameAsLine', { line: (r.duplicateOfRow ?? 0) + 2 })
                        ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <TablePagination
            component="div"
            count={shown.length}
            page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={PAGE}
            rowsPerPageOptions={[PAGE]}
          />
        </SectionCard>
      )}

      {step === 'done' && result && (
        <SectionCard title={t('import.steps.done')}>
          <Stack spacing={3} alignItems="flex-start">
            <Stack direction="row" spacing={2} alignItems="center" sx={{ color: 'success.main' }}>
              <CheckCircle2 size={28} />
              <Typography variant="h5">{t('import.imported', { count: result.summary.created ?? 0 })}</Typography>
            </Stack>
            <Typography color="text.secondary">
              {t('import.notImported', { count: result.rows.filter((r) => r.status !== 'created').length })}
            </Typography>
            <Stack direction="row" spacing={2}>
              <Button variant="contained" component={RouterLink} to="/clinic/patients">
                {t('import.openList')}
              </Button>
              <Button
                onClick={() => {
                  setStep('upload');
                  setResult(null);
                  setCheck(null);
                }}
              >
                {t('import.another')}
              </Button>
            </Stack>
          </Stack>
        </SectionCard>
      )}
    </>
  );
}
