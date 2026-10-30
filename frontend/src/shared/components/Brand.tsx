import { Box, Typography, type BoxProps, type TypographyProps } from '@mui/material';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { brand } from '@/theme/tokens';

/** The ElDental mark: a stylised tooth on the brand gradient. */
export function LogoMark({ size = 36 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <Box
      component="svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden
      sx={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={brand.indigo} />
          <stop offset=".55" stopColor={brand.violet} />
          <stop offset="1" stopColor={brand.cyan} />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#g${id})`} />
      <path
        d="M17 12.5c-4.4 0-7 3.4-7 8.1 0 6.1 3.2 9.6 4.7 15.8.8 3.4 4.2 3.4 5 0l1.5-6.1c.6-2.3 2.9-2.3 3.5 0l1.5 6.1c.8 3.4 4.2 3.4 5 0 1.5-6.2 4.8-9.7 4.8-15.8 0-4.7-2.6-8.1-7-8.1-3.2 0-4.9 1.6-7 1.6s-3.8-1.6-7-1.6z"
        fill="#fff"
      />
      <path
        d="M30.5 17.5c1.6.5 2.6 1.9 2.6 3.7"
        stroke={brand.violet}
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity=".55"
      />
    </Box>
  );
}

type LogoProps = { to?: string; subtitle?: string; size?: number; light?: boolean };

/** Logo mark + word mark, optionally linking home. */
export function Logo({ to, subtitle, size = 36, light }: LogoProps) {
  const { t } = useTranslation();
  const content = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, minWidth: 0 }}>
      <LogoMark size={size} />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          fontWeight={800}
          fontSize={size * 0.5}
          lineHeight={1.1}
          noWrap
          sx={{ color: light ? '#fff' : 'text.primary', letterSpacing: '-0.01em' }}
        >
          {t('appName')}
        </Typography>
        {subtitle && (
          <Typography
            variant="caption"
            noWrap
            display="block"
            dir="auto"
            sx={{ color: light ? 'rgba(255,255,255,.6)' : 'text.secondary' }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </Box>
  );
  if (!to) return content;
  return (
    <Box
      component={RouterLink}
      to={to}
      sx={{ textDecoration: 'none', color: 'inherit', display: 'inline-flex' }}
      aria-label={t('appName')}
    >
      {content}
    </Box>
  );
}

/** Text filled with the brand gradient. */
export function GradientText({
  children,
  ...rest
}: TypographyProps & { component?: React.ElementType }) {
  return (
    <Typography
      component="span"
      {...rest}
      sx={{
        backgroundImage: brand.gradient,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        color: 'transparent',
        font: 'inherit',
        ...rest.sx,
      }}
    >
      {children}
    </Typography>
  );
}

/** Soft blurred colour blobs + dot grid used behind heroes and the auth panel. */
export function GlowBackdrop({ sx, dense }: BoxProps & { dense?: boolean }) {
  return (
    <Box
      aria-hidden
      sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', ...sx }}
    >
      <Box
        sx={{
          position: 'absolute',
          width: 520,
          height: 520,
          borderRadius: '50%',
          top: -160,
          insetInlineStart: -120,
          background: brand.indigo,
          opacity: dense ? 0.45 : 0.22,
          filter: 'blur(110px)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: 460,
          height: 460,
          borderRadius: '50%',
          top: 40,
          insetInlineEnd: -140,
          background: brand.cyan,
          opacity: dense ? 0.35 : 0.18,
          filter: 'blur(120px)',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: 380,
          height: 380,
          borderRadius: '50%',
          bottom: -160,
          insetInlineStart: '35%',
          background: brand.violet,
          opacity: dense ? 0.4 : 0.16,
          filter: 'blur(120px)',
        }}
      />
      <Box
        sx={(theme) => ({
          position: 'absolute',
          inset: 0,
          backgroundImage: `radial-gradient(${theme.palette.mode === 'dark' || dense ? 'rgba(255,255,255,.07)' : 'rgba(15,23,42,.06)'} 1px, transparent 1px)`,
          backgroundSize: '22px 22px',
          maskImage: 'radial-gradient(ellipse at center, #000 30%, transparent 75%)',
        })}
      />
    </Box>
  );
}
