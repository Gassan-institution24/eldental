import { alpha, createTheme, type Theme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import { primaryScale, tokens } from './tokens';

export type ColorMode = 'light' | 'dark';
export type Direction = 'rtl' | 'ltr';

const ARABIC_FONT = '"IBM Plex Sans Arabic", "Tajawal", "Segoe UI", Tahoma, sans-serif';
const LATIN_FONT = '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function createAppTheme(mode: ColorMode, direction: Direction): Theme {
  const t = tokens[mode];
  const isAr = direction === 'rtl';
  const fontFamily = isAr ? `${ARABIC_FONT.split(',')[0]}, ${LATIN_FONT}` : `${LATIN_FONT.split(',')[0]}, ${ARABIC_FONT}`;
  const lineHeight = isAr ? 1.6 : 1.5;

  return createTheme({
    direction,
    palette: {
      mode,
      primary: { main: t.primary, ...primaryScale, contrastText: mode === 'light' ? '#FFFFFF' : '#0F1419' },
      secondary: { main: t.secondary },
      success: { main: tokens.semantic.success },
      warning: { main: tokens.semantic.warning },
      error: { main: tokens.semantic.error },
      info: { main: tokens.semantic.info },
      background: { default: t.background, paper: t.paper },
      divider: t.border,
      text: { primary: t.textPrimary, secondary: t.textSecondary },
    },
    shape: { borderRadius: tokens.radius.input },
    spacing: 4,
    breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
    typography: {
      fontFamily,
      fontSize: 15,
      htmlFontSize: 16,
      h1: { fontSize: 32, fontWeight: 700, lineHeight: 1.3 },
      h2: { fontSize: 26, fontWeight: 700, lineHeight: 1.3 },
      h3: { fontSize: 22, fontWeight: 700, lineHeight: 1.35 },
      h4: { fontSize: 18, fontWeight: 600, lineHeight: 1.4 },
      h5: { fontSize: 16, fontWeight: 600, lineHeight: 1.4 },
      h6: { fontSize: 15, fontWeight: 600, lineHeight: 1.4 },
      body1: { fontSize: 15, lineHeight },
      body2: { fontSize: 13, lineHeight },
      caption: { fontSize: 12, lineHeight },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    transitions: { duration: { shortest: 120, shorter: 150, short: 180, standard: 200 } },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: t.background },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' },
          },
          ':focus-visible': { outline: `2px solid ${t.primary}`, outlineOffset: 2 },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: tokens.radius.button, minHeight: 40 } },
      },
      MuiIconButton: { styleOverrides: { root: { minWidth: 44, minHeight: 44 } } },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { rounded: { borderRadius: tokens.radius.card } } },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: tokens.radius.card, borderColor: t.border } },
      },
      MuiDialog: { styleOverrides: { paper: { borderRadius: tokens.radius.dialog } } },
      MuiMenu: { defaultProps: { elevation: 4 } },
      MuiPopover: { defaultProps: { elevation: 4 } },
      MuiDrawer: { styleOverrides: { paper: { borderColor: t.border } } },
      MuiTextField: { defaultProps: { fullWidth: true, size: 'small' } },
      MuiFormControl: { defaultProps: { fullWidth: true, size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: { root: { borderRadius: tokens.radius.input, backgroundColor: t.paper } },
      },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 600 } } },
      MuiDataGrid: {
        styleOverrides: {
          root: { borderColor: t.border, backgroundColor: t.paper, borderRadius: tokens.radius.card },
          columnHeaders: { backgroundColor: alpha(t.primary, 0.04) },
        },
      },
      MuiAlert: { styleOverrides: { root: { borderRadius: tokens.radius.card } } },
    },
  });
}
