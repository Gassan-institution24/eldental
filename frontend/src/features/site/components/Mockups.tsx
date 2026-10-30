import { Avatar, Box, Card, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { CalendarCheck, CheckCircle2, CreditCard, Globe, TrendingUp, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { brand } from '@/theme/tokens';

/** Decorative previews of the product. Purely visual (aria-hidden), all text is translated. */

function Window({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Card
      aria-hidden
      sx={(theme) => ({
        borderRadius: '20px',
        overflow: 'hidden',
        boxShadow:
          theme.palette.mode === 'dark'
            ? '0 40px 80px -30px rgba(0,0,0,.8)'
            : '0 40px 80px -30px rgba(30,27,75,.35)',
        borderColor: alpha(theme.palette.primary.main, 0.15),
        ...sx,
      })}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          px: 4,
          py: 2.5,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.default',
        }}
        dir="ltr"
      >
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <Box key={c} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />
        ))}
      </Stack>
      {children}
    </Card>
  );
}

function Kpi({
  icon,
  label,
  value,
  delta,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  delta: string;
}) {
  return (
    <Box
      sx={{
        p: 3,
        borderRadius: '14px',
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        minWidth: 0,
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        sx={{ color: 'text.secondary', mb: 1.5 }}
      >
        <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
        <Typography variant="caption" noWrap>
          {label}
        </Typography>
      </Stack>
      <Stack direction="row" alignItems="baseline" spacing={1.5}>
        <Typography fontWeight={800} fontSize={20} dir="ltr">
          {value}
        </Typography>
        <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 700 }} dir="ltr">
          {delta}
        </Typography>
      </Stack>
    </Box>
  );
}

function Bars() {
  const theme = useTheme();
  const values = [42, 58, 50, 72, 64, 86, 78];
  return (
    <Box
      component="svg"
      viewBox="0 0 280 110"
      sx={{ width: '100%', height: 110, display: 'block' }}
    >
      <defs>
        <linearGradient id="barg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={brand.violet} />
          <stop offset="1" stopColor={brand.indigo} stopOpacity=".55" />
        </linearGradient>
      </defs>
      {values.map((v, i) => (
        <rect
          key={i}
          x={10 + i * 38}
          y={105 - v}
          width="24"
          height={v}
          rx="7"
          fill={i === 5 ? 'url(#barg)' : alpha(theme.palette.primary.main, 0.18)}
        />
      ))}
      <path
        d="M22 70 C 60 60, 98 64, 136 46 S 212 22, 250 30"
        fill="none"
        stroke={brand.cyan}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </Box>
  );
}

const STATUS = {
  waiting: '#F59E0B',
  inChair: brand.violet,
  done: '#10B981',
  booked: brand.cyan,
} as const;

function ScheduleRow({
  name,
  treatment,
  time,
  status,
}: {
  name: string;
  treatment: string;
  time: string;
  status: keyof typeof STATUS;
}) {
  const { t } = useTranslation('site');
  const label = status === 'booked' ? t('mock.booked') : t(`mock.${status}`);
  return (
    <Stack
      direction="row"
      spacing={3}
      alignItems="center"
      sx={{
        py: 2.25,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography
        variant="caption"
        fontWeight={700}
        sx={{ width: 44, color: 'text.secondary' }}
        dir="ltr"
      >
        {time}
      </Typography>
      <Avatar
        sx={{
          width: 30,
          height: 30,
          fontSize: 13,
          bgcolor: alpha(STATUS[status], 0.15),
          color: STATUS[status],
          fontWeight: 700,
        }}
      >
        {name.slice(0, 1)}
      </Avatar>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={650} noWrap>
          {name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap display="block">
          {treatment}
        </Typography>
      </Box>
      <Box
        sx={{
          px: 2,
          py: 0.5,
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 700,
          color: STATUS[status],
          bgcolor: alpha(STATUS[status], 0.12),
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </Box>
    </Stack>
  );
}

export function FloatCard({
  icon,
  title,
  value,
  sx,
}: {
  icon: ReactNode;
  title: string;
  value?: string;
  sx?: object;
}) {
  return (
    <Card
      aria-hidden
      sx={(theme) => ({
        position: 'absolute',
        px: 3.5,
        py: 2.5,
        borderRadius: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: 2.5,
        boxShadow: theme.brand.elevated,
        bgcolor: alpha(theme.palette.background.paper, 0.9),
        backdropFilter: 'blur(10px)',
        animation: 'eldFloat 6s ease-in-out infinite',
        '@keyframes eldFloat': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        ...sx,
      })}
    >
      <Box
        sx={{
          width: 36,
          height: 36,
          borderRadius: '10px',
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          backgroundImage: brand.gradient,
        }}
      >
        {icon}
      </Box>
      <Box>
        <Typography variant="body2" fontWeight={700} noWrap>
          {title}
        </Typography>
        {value && (
          <Typography variant="caption" color="text.secondary" dir="ltr" display="block">
            {value}
          </Typography>
        )}
      </Box>
    </Card>
  );
}

/** Hero visual: the clinic dashboard with floating event cards. */
export function DashboardMock() {
  const { t } = useTranslation('site');
  return (
    <Box sx={{ position: 'relative', px: { xs: 0, md: 4 } }}>
      <Window>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '64px 1fr' } }}>
          <Box
            sx={{
              display: { xs: 'none', sm: 'flex' },
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              py: 4,
              background: brand.sidebar,
            }}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <Box
                key={i}
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '10px',
                  bgcolor: i === 0 ? 'transparent' : 'rgba(255,255,255,.08)',
                  backgroundImage: i === 0 ? brand.gradient : 'none',
                }}
              />
            ))}
          </Box>
          <Box sx={{ p: { xs: 3, sm: 5 }, bgcolor: 'background.default' }}>
            <Typography fontWeight={800} sx={{ mb: 4 }}>
              {t('mock.greeting')}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                gap: 3,
                mb: 4,
              }}
            >
              <Kpi
                icon={<CalendarCheck size={15} />}
                label={t('mock.appointments')}
                value="38"
                delta="+12%"
              />
              <Kpi
                icon={<CreditCard size={15} />}
                label={t('mock.revenue')}
                value="1,240"
                delta="+8%"
              />
              <Kpi icon={<Users size={15} />} label={t('mock.newPatients')} value="9" delta="+3" />
              <Kpi
                icon={<TrendingUp size={15} />}
                label={t('mock.noShow')}
                value="2.1%"
                delta="−1.4"
              />
            </Box>
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr' }, gap: 3 }}
            >
              <Box
                sx={{
                  p: 4,
                  borderRadius: '14px',
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Typography variant="body2" fontWeight={700} sx={{ mb: 1 }}>
                  {t('mock.schedule')}
                </Typography>
                <ScheduleRow
                  time="09:00"
                  name={t('mock.p1')}
                  treatment={t('mock.t1')}
                  status="done"
                />
                <ScheduleRow
                  time="10:30"
                  name={t('mock.p2')}
                  treatment={t('mock.t2')}
                  status="inChair"
                />
                <ScheduleRow
                  time="11:15"
                  name={t('mock.p3')}
                  treatment={t('mock.t3')}
                  status="waiting"
                />
                <ScheduleRow
                  time="12:00"
                  name={t('mock.p4')}
                  treatment={t('mock.t4')}
                  status="booked"
                />
              </Box>
              <Box
                sx={{
                  p: 4,
                  borderRadius: '14px',
                  border: 1,
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  display: { xs: 'none', md: 'block' },
                }}
              >
                <Typography variant="body2" fontWeight={700} sx={{ mb: 3 }}>
                  {t('mock.week')}
                </Typography>
                <Bars />
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 3, display: 'block' }}
                >
                  {t('mock.chart')}
                </Typography>
                <ToothRow compact />
              </Box>
            </Box>
          </Box>
        </Box>
      </Window>
      <FloatCard
        icon={<CheckCircle2 size={18} />}
        title={t('mock.plan')}
        value="2,450.000 JOD"
        sx={{
          top: { xs: -18, md: 40 },
          insetInlineStart: { xs: 8, md: -24 },
          display: { xs: 'none', sm: 'flex' },
        }}
      />
      <FloatCard
        icon={<CreditCard size={18} />}
        title={t('mock.paid')}
        value="INV-2026-000184"
        sx={{
          bottom: { xs: -18, md: 60 },
          insetInlineEnd: { xs: 8, md: -20 },
          animationDelay: '1.5s',
        }}
      />
      <FloatCard
        icon={<Globe size={18} />}
        title={t('mock.booked')}
        value="10:30 · Dr. Sara"
        sx={{
          bottom: -26,
          insetInlineStart: '30%',
          animationDelay: '3s',
          display: { xs: 'none', lg: 'flex' },
        }}
      />
    </Box>
  );
}

/** A row of stylised teeth with a few coloured surfaces. Never mirrored (dental convention). */
export function ToothRow({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  const fills: Record<number, string> = {
    1: brand.cyan,
    3: '#EF4444',
    4: brand.violet,
    6: '#10B981',
  };
  const n = compact ? 8 : 16;
  return (
    <Box dir="ltr">
      <Box
        component="svg"
        viewBox={`0 0 ${n * 34} 70`}
        sx={{ width: '100%', display: 'block', mt: 2 }}
      >
        {Array.from({ length: n }, (_, i) => {
          const x = i * 34 + 3;
          const f = fills[i % 8];
          return (
            <g key={i}>
              <path
                d={`M${x + 4} 10 q12 -10 24 0 q4 18 -2 34 q-4 12 -6 22 h-8 q-2 -10 -6 -22 q-6 -16 -2 -34z`}
                fill={theme.palette.mode === 'dark' ? '#1C2440' : '#F1F3FB'}
                stroke={alpha(theme.palette.text.primary, 0.25)}
                strokeWidth="1.2"
              />
              {f && <circle cx={x + 16} cy={22} r={6} fill={f} opacity=".9" />}
            </g>
          );
        })}
      </Box>
    </Box>
  );
}

/** Spotlight visual for the clinical section. */
export function ChartMock() {
  const { t } = useTranslation('site');
  return (
    <Window>
      <Box sx={{ p: 5 }}>
        <Typography fontWeight={800}>{t('mock.chart')}</Typography>
        <ToothRow />
        <ToothRow />
        <Stack direction="row" spacing={2} sx={{ mt: 4, flexWrap: 'wrap', rowGap: 2 }}>
          {[
            ['#EF4444', 'caries'],
            [brand.violet, 'crown'],
            [brand.cyan, 'filling'],
            ['#10B981', 'rct'],
          ].map(([c, k]) => (
            <Stack key={k} direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />
              <Typography variant="caption" color="text.secondary">
                {t(`mock.${k}`)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Window>
  );
}

/** Spotlight visual for the front-desk section. */
export function BoardMock() {
  const { t } = useTranslation('site');
  return (
    <Window>
      <Box sx={{ p: 5, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 3 }}>
        {(['waiting', 'inChair', 'done'] as const).map((col, ci) => (
          <Box
            key={col}
            sx={{ p: 3, borderRadius: '14px', bgcolor: 'background.default', minWidth: 0 }}
          >
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 2 }}>
              <Typography variant="caption" fontWeight={700} noWrap>
                {t(`mock.${col}`)}
              </Typography>
              <Typography variant="caption" sx={{ color: STATUS[col], fontWeight: 800 }}>
                {3 - ci}
              </Typography>
            </Stack>
            {Array.from({ length: 3 - ci }, (_, i) => (
              <Box
                key={i}
                sx={{
                  p: 2,
                  mb: 2,
                  borderRadius: '10px',
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  borderInlineStart: `3px solid ${STATUS[col]}`,
                }}
              >
                <Box
                  sx={{ height: 8, width: '70%', borderRadius: 4, bgcolor: 'divider', mb: 1.5 }}
                />
                <Box sx={{ height: 6, width: '45%', borderRadius: 4, bgcolor: 'divider' }} />
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Window>
  );
}

/** Spotlight visual for the back-office section. */
export function LedgerMock() {
  const { t } = useTranslation('site');
  const rows = [
    ['1210', t('mock.arPatients'), '1,250.000', ''],
    ['4120', t('mock.revRestorative'), '', '1,077.586'],
    ['2200', t('mock.vat'), '', '172.414'],
  ];
  return (
    <Window>
      <Box sx={{ p: 5 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 3 }}>
          <Typography fontWeight={800}>JE-2026-000412</Typography>
          <Box
            sx={{
              px: 2,
              py: 0.5,
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              color: '#10B981',
              bgcolor: alpha('#10B981', 0.12),
            }}
          >
            {t('mock.posted')} ✓
          </Box>
        </Stack>
        {rows.map((r) => (
          <Box
            key={r[0]}
            sx={{
              display: 'grid',
              gridTemplateColumns: '56px 1fr 90px 90px',
              gap: 2,
              py: 2,
              borderBottom: 1,
              borderColor: 'divider',
              fontSize: 13,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {r[0]}
            </Typography>
            <Typography variant="body2" noWrap>
              {r[1]}
            </Typography>
            <Typography variant="body2" textAlign="end" fontWeight={650}>
              {r[2]}
            </Typography>
            <Typography variant="body2" textAlign="end" fontWeight={650}>
              {r[3]}
            </Typography>
          </Box>
        ))}
        <Box sx={{ display: 'grid', gridTemplateColumns: '56px 1fr 90px 90px', gap: 2, pt: 3 }}>
          <span />
          <Typography variant="body2" fontWeight={800}>
            Σ
          </Typography>
          <Typography
            variant="body2"
            textAlign="end"
            fontWeight={800}
            sx={{ color: 'success.main' }}
          >
            1,250.000
          </Typography>
          <Typography
            variant="body2"
            textAlign="end"
            fontWeight={800}
            sx={{ color: 'success.main' }}
          >
            1,250.000
          </Typography>
        </Box>
      </Box>
    </Window>
  );
}
