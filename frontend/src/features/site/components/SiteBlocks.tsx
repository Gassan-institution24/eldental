import { Box, Chip, Container, Stack, Typography, type BoxProps } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GlowBackdrop } from '@/shared/components/Brand';
import { brand } from '@/theme/tokens';

/** Fades content up when it scrolls into view (respects reduced motion via the theme). */
export function Reveal({ children, delay = 0, ...rest }: BoxProps & { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <Box
      ref={ref}
      {...rest}
      sx={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(24px)',
        transition: `opacity .7s ease ${delay}ms, transform .7s cubic-bezier(.2,.7,.2,1) ${delay}ms`,
        ...rest.sx,
      }}
    >
      {children}
    </Box>
  );
}

export function Section({
  children,
  id,
  tinted,
  sx,
}: {
  children: ReactNode;
  id?: string;
  tinted?: boolean;
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      component="section"
      id={id}
      sx={{
        py: { xs: 16, md: 24 },
        position: 'relative',
        bgcolor: tinted ? 'background.paper' : undefined,
        ...sx,
      }}
    >
      <Container maxWidth="lg">{children}</Container>
    </Box>
  );
}

export function Overline({ children }: { children: ReactNode }) {
  return (
    <Chip
      label={children}
      size="small"
      sx={(theme) => ({
        bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.08),
        color: 'primary.main',
        fontWeight: 700,
        px: 1,
        mb: 4,
        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
      })}
    />
  );
}

export function SectionHeading({
  overline,
  title,
  subtitle,
  align = 'center',
}: {
  overline?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <Reveal
      sx={{
        textAlign: align,
        maxWidth: align === 'center' ? 760 : 'none',
        mx: align === 'center' ? 'auto' : 0,
        mb: { xs: 10, md: 14 },
      }}
    >
      {overline && <Overline>{overline}</Overline>}
      <Typography variant="h2" component="h2">
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="subtitle1" sx={{ mt: 4 }}>
          {subtitle}
        </Typography>
      )}
    </Reveal>
  );
}

/** Gradient icon tile used across feature grids. */
export function IconTile({ children, size = 48 }: { children: ReactNode; size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: '14px',
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        backgroundImage: brand.gradient,
        boxShadow: `0 10px 24px -10px ${alpha(brand.violet, 0.8)}`,
        flexShrink: 0,
      }}
    >
      {children}
    </Box>
  );
}

/** Page hero for inner pages (about, pricing, security…). */
export function PageHero({
  overline,
  title,
  subtitle,
  children,
}: {
  overline: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        pt: { xs: 32, md: 40 },
        pb: { xs: 14, md: 20 },
        overflow: 'hidden',
      }}
    >
      <GlowBackdrop />
      <Container maxWidth="md" sx={{ position: 'relative', textAlign: 'center' }}>
        <Reveal>
          <Overline>{overline}</Overline>
          <Typography variant="h1" component="h1">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="subtitle1" sx={{ mt: 5, fontSize: { md: 19 } }}>
              {subtitle}
            </Typography>
          )}
          {children}
        </Reveal>
      </Container>
    </Box>
  );
}

export function CheckList({ items }: { items: ReactNode[] }) {
  return (
    <Stack spacing={2.5} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {items.map((it, i) => (
        <Stack key={i} component="li" direction="row" spacing={3} alignItems="flex-start">
          <Box
            aria-hidden
            sx={{
              width: 22,
              height: 22,
              mt: 0.25,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              backgroundImage: brand.gradient,
              color: '#fff',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            ✓
          </Box>
          <Typography>{it}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}
