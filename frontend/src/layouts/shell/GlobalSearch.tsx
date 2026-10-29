import { Box, ButtonBase, Dialog, InputAdornment, List, ListItemButton, ListItemText, TextField, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { trackActivity } from '@/lib/telemetry';

export type SearchResult = { id: string; title: string; subtitle?: string; group: string; onSelect: () => void };
export type SearchProvider = (q: string) => Promise<SearchResult[]>;

/** Ctrl/⌘+K global search (16_UX_UI_AND_VALIDATION.md §3). Providers are injected per app. */
export function GlobalSearch({ provider, emptyHint }: { provider?: SearchProvider; emptyHint?: ReactNode }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!provider || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      void provider(q.trim()).then((r) => {
        setResults(r);
        setActive(0);
        trackActivity({ type: 'search', meta: { scope: 'global', results: r.length } });
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [q, provider]);

  const select = (r: SearchResult | undefined) => {
    if (!r) return;
    setOpen(false);
    setQ('');
    r.onSelect();
  };

  return (
    <>
      <ButtonBase
        onClick={() => setOpen(true)}
        aria-label={t('layout.searchPlaceholder')}
        sx={{
          flex: 1,
          maxWidth: 480,
          justifyContent: 'flex-start',
          gap: 2,
          px: 3,
          height: 40,
          borderRadius: '10px',
          border: 1,
          borderColor: 'divider',
          color: 'text.secondary',
          bgcolor: 'background.default',
        }}
      >
        <Search size={18} />
        {!compact && (
          <>
            <Typography variant="body2" sx={{ flex: 1, textAlign: 'start' }} noWrap>
              {t('layout.searchPlaceholder')}
            </Typography>
            <Typography variant="caption" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, px: 1 }} dir="ltr">
              {t('layout.searchShortcut')}
            </Typography>
          </>
        )}
      </ButtonBase>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm" fullScreen={compact}>
        <Box sx={{ p: 4 }}>
          <TextField
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('layout.searchPlaceholder')}
            inputProps={{ dir: 'auto', 'aria-label': t('layout.searchPlaceholder') }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter') select(results[active]);
            }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={18} /></InputAdornment> }}
          />
          <List sx={{ mt: 2, maxHeight: 420, overflow: 'auto' }}>
            {results.map((r, i) => (
              <ListItemButton key={`${r.group}-${r.id}`} selected={i === active} onClick={() => select(r)}>
                <ListItemText primary={<span dir="auto">{r.title}</span>} secondary={r.subtitle} />
                <Typography variant="caption" color="text.secondary">
                  {r.group}
                </Typography>
              </ListItemButton>
            ))}
            {q.trim().length >= 2 && results.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 3 }}>
                {t('states.emptySearch', { query: q.trim() })}
              </Typography>
            )}
            {q.trim().length < 2 && emptyHint}
          </List>
        </Box>
      </Dialog>
    </>
  );
}
