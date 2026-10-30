import { alpha, createTheme, type Theme } from '@mui/material/styles';
import type {} from '@mui/x-data-grid/themeAugmentation';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import { brand, primaryScale, tokens } from './tokens';

export type ColorMode = 'light' | 'dark';
export type Direction = 'rtl' | 'ltr';

const ARABIC_FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';
const LATIN_FONT = '"Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

declare module '@mui/material/styles' {
  interface Theme {
    brand: typeof brand & { elevated: string };
  }
  interface ThemeOptions {
    brand?: typeof brand & { elevated: string };
  }
}

export function createAppTheme(mode: ColorMode, direction: Direction): Theme {
  const t = tokens[mode];
  const isAr = direction === 'rtl';
  const fontFamily = isAr ? `"IBM Plex Sans Arabic", ${LATIN_FONT}` : `"Inter", ${ARABIC_FONT}`;
  const lineHeight = isAr ? 1.65 : 1.55;
  const heading = { fontWeight: 800, letterSpacing: isAr ? 0 : '-0.02em', lineHeight: 1.2 };

  return createTheme({
    direction,
    brand: { ...brand, elevated: t.elevated },
    palette: {
      mode,
      primary: { main: t.primary, ...primaryScale, contrastText: '#FFFFFF' },
      secondary: { main: t.secondary, contrastText: '#FFFFFF' },
      success: { main: tokens.semantic.success },
      warning: { main: tokens.semantic.warning },
      error: { main: tokens.semantic.error },
      info: { main: tokens.semantic.info },
      background: { default: t.background, paper: t.paper },
      divider: t.border,
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      action: {
        hover: alpha(t.primary, mode === 'dark' ? 0.1 : 0.05),
        selected: alpha(t.primary, 0.12),
      },
    },
    shape: { borderRadius: tokens.radius.input },
    spacing: 4,
    breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
    typography: {
      fontFamily,
      fontSize: 15,
      htmlFontSize: 16,
      h1: { fontSize: 'clamp(2.25rem, 5vw, 3.75rem)', ...heading },
      h2: { fontSize: 'clamp(1.75rem, 3.4vw, 2.5rem)', ...heading },
      h3: { fontSize: 'clamp(1.35rem, 2.2vw, 1.75rem)', ...heading, fontWeight: 750 },
      h4: { fontSize: 20, fontWeight: 700, lineHeight: 1.35 },
      h5: { fontSize: 17, fontWeight: 700, lineHeight: 1.4 },
      h6: { fontSize: 15, fontWeight: 700, lineHeight: 1.4 },
      subtitle1: { fontSize: 17, lineHeight, color: t.textSecondary },
      body1: { fontSize: 15, lineHeight },
      body2: { fontSize: 13.5, lineHeight },
      caption: { fontSize: 12, lineHeight },
      overline: { fontSize: 12, fontWeight: 700, letterSpacing: isAr ? 0 : '0.12em' },
      button: { textTransform: 'none', fontWeight: 650, letterSpacing: 0 },
    },
    transitions: { duration: { shortest: 120, shorter: 150, short: 180, standard: 220 } },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: t.background, WebkitFontSmoothing: 'antialiased' },
          '::selection': { background: alpha(t.primary, 0.25) },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': {
              animationDuration: '0.01ms !important',
              transitionDuration: '0.01ms !important',
            },
          },
          ':focus-visible': { outline: `2px solid ${t.primary}`, outlineOffset: 2 },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            background: alpha(t.textSecondary, 0.25),
            borderRadius: 8,
            border: `2px solid transparent`,
            backgroundClip: 'padding-box',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: tokens.radius.button, minHeight: 42, paddingInline: 18 },
          sizeLarge: { minHeight: 50, fontSize: 16, paddingInline: 26 },
          containedPrimary: {
            backgroundImage: brand.gradient,
            boxShadow: `0 8px 24px -10px ${alpha(brand.indigo, 0.7)}`,
            '&:hover': {
              backgroundImage: brand.gradient,
              filter: 'brightness(1.06)',
              boxShadow: `0 10px 28px -10px ${alpha(brand.violet, 0.8)}`,
            },
            '&.Mui-disabled': { backgroundImage: 'none' },
          },
          outlined: {
            borderColor: t.border,
            '&:hover': {
              borderColor: alpha(t.primary, 0.5),
              backgroundColor: alpha(t.primary, 0.04),
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: { root: { minWidth: 44, minHeight: 44, borderRadius: 12 } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          rounded: { borderRadius: tokens.radius.card },
          root: { backgroundImage: 'none' },
        },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.card,
            borderColor: t.border,
            boxShadow: mode === 'light' ? '0 1px 2px rgba(16,24,40,.04)' : 'none',
          },
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: tokens.radius.dialog, boxShadow: t.elevated } },
      },
      MuiMenu: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          paper: { border: `1px solid ${t.border}`, boxShadow: t.elevated, borderRadius: 14 },
        },
      },
      MuiPopover: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          paper: { border: `1px solid ${t.border}`, boxShadow: t.elevated, borderRadius: 14 },
        },
      },
      MuiDrawer: { styleOverrides: { paper: { borderColor: t.border } } },
      MuiTextField: { defaultProps: { fullWidth: true, size: 'small' } },
      MuiFormControl: { defaultProps: { fullWidth: true, size: 'small' } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: tokens.radius.input,
            backgroundColor: mode === 'light' ? '#FFFFFF' : alpha('#FFFFFF', 0.02),
            transition: 'box-shadow .18s ease',
            '&.Mui-focused': { boxShadow: `0 0 0 4px ${alpha(t.primary, 0.14)}` },
          },
          notchedOutline: { borderColor: t.border },
        },
      },
      MuiInputBase: { styleOverrides: { inputSizeSmall: { paddingBlock: 10 } } },
      MuiTooltip: {
        defaultProps: { arrow: true },
        styleOverrides: { tooltip: { borderRadius: 8, fontSize: 12.5 } },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 650, borderRadius: 999 } } },
      MuiTableCell: { styleOverrides: { head: { fontWeight: 700, color: t.textSecondary } } },
      MuiTab: {
        styleOverrides: { root: { textTransform: 'none', fontWeight: 650, minHeight: 44 } },
      },
      MuiAccordion: {
        defaultProps: { disableGutters: true, elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${t.border}`,
            borderRadius: 14,
            '&:before': { display: 'none' },
            '&:not(:last-of-type)': { marginBottom: 12 },
          },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: {
            borderColor: t.border,
            backgroundColor: t.paper,
            borderRadius: tokens.radius.card,
          },
          columnHeaders: { backgroundColor: alpha(t.primary, 0.04) },
        },
      },
      MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 999 } } },
    },
  });
}
