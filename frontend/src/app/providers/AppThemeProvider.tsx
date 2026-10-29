import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { prefixer } from 'stylis';
import rtlPlugin from 'stylis-plugin-rtl';
import { dirOf } from '@/i18n';
import { useUiStore } from '@/stores/uiStore';
import { createAppTheme, type ColorMode } from '@/theme/createAppTheme';
import '@/lib/dates';

const rtlCache = createCache({ key: 'muirtl', stylisPlugins: [prefixer, rtlPlugin] });
const ltrCache = createCache({ key: 'muiltr', stylisPlugins: [prefixer] });

export function useColorMode(): ColorMode {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const pref = useUiStore((s) => s.modePref);
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
}

/** Direction follows the UI language (ar → rtl) with the matching Emotion cache. */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const lang = i18n.resolvedLanguage ?? 'ar';
  const direction = dirOf(lang);
  const mode = useColorMode();
  const theme = useMemo(() => createAppTheme(mode, direction), [mode, direction]);

  return (
    <CacheProvider value={direction === 'rtl' ? rtlCache : ltrCache}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale={lang}>
          <CssBaseline enableColorScheme />
          {children}
        </LocalizationProvider>
      </ThemeProvider>
    </CacheProvider>
  );
}
