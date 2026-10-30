import { Box, Button, GlobalStyles, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Eraser } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { proceduresApi, type ClinicProcedure } from '@/features/clinic-settings/api';
import { useSeedName } from '@/shared/hooks/useSeedName';
import { useConditions } from '../api';

/** The clinic price list (≤ 100 rows per page; enough for one picker) + name helper. */
export function useProcedureLookup() {
  const list = proceduresApi.useList({ limit: 100 });
  const seedName = useSeedName('procedure');
  const items = useMemo(() => list.data?.data ?? [], [list.data]);
  const byId = useMemo(() => new Map(items.map((p) => [p.id, p])), [items]);
  const label = useCallback(
    (p?: ClinicProcedure | string) => {
      const proc = typeof p === 'string' ? byId.get(p) : p;
      return proc ? `${proc.code} · ${seedName(proc)}` : '';
    },
    [byId, seedName],
  );
  return { items, byId, label, loading: list.isLoading };
}

/** Condition code → colour, from the global tooth-conditions catalog. */
export function useConditionColors() {
  const q = useConditions();
  const seedName = useSeedName('condition');
  const colors = useMemo(
    () => Object.fromEntries((q.data ?? []).map((c) => [c.code, c.color])),
    [q.data],
  );
  return { list: q.data ?? [], colors, name: (code: string) => seedName({ systemKey: code }) };
}

/** Finger / mouse signature on a canvas → PNG data URL. */
export function SignaturePad({
  onChange,
  height = 180,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
}) {
  const { t } = useTranslation('clinical');
  const theme = useTheme();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, [height]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <Box>
      <Box
        sx={{
          position: 'relative',
          border: 2,
          borderStyle: 'dashed',
          borderColor: 'divider',
          borderRadius: 2,
          bgcolor: '#fff',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={ref}
          aria-label={t('signature.area')}
          style={{ width: '100%', height, display: 'block', cursor: 'crosshair' }}
          onPointerDown={(e) => {
            drawing.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const ctx = e.currentTarget.getContext('2d');
            const p = point(e);
            ctx?.beginPath();
            ctx?.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = e.currentTarget.getContext('2d');
            const p = point(e);
            ctx?.lineTo(p.x, p.y);
            ctx?.stroke();
            if (empty) setEmpty(false);
          }}
          onPointerUp={(e) => {
            drawing.current = false;
            if (!empty) onChange(e.currentTarget.toDataURL('image/png'));
          }}
        />
        {empty && (
          <Typography
            variant="body2"
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: alpha(theme.palette.common.black, 0.35),
              pointerEvents: 'none',
            }}
          >
            {t('signature.hint')}
          </Typography>
        )}
      </Box>
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
        <Button size="small" startIcon={<Eraser size={14} />} onClick={clear} disabled={empty}>
          {t('signature.clear')}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * Printable sheet: everything else on the page is hidden while printing, so the browser's
 * "Save as PDF" produces a clean A4 document in either language.
 */
export function PrintArea({ children }: { children: ReactNode }) {
  return (
    <>
      <GlobalStyles
        styles={{
          '@media print': {
            'body *': { visibility: 'hidden' },
            '#print-area, #print-area *': { visibility: 'visible' },
            '#print-area': {
              position: 'absolute',
              insetInlineStart: 0,
              top: 0,
              width: '100%',
              padding: '12mm',
              background: '#fff',
              color: '#000',
            },
            '@page': { size: 'A4', margin: '10mm' },
          },
        }}
      />
      <Box
        id="print-area"
        sx={{
          bgcolor: '#fff',
          color: '#111',
          p: 6,
          borderRadius: 2,
          border: 1,
          borderColor: 'divider',
        }}
      >
        {children}
      </Box>
    </>
  );
}

export const toothList = (raw: string): number[] =>
  raw
    .split(/[\s,،]+/)
    .map((x) => Number(x.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))))
    .filter((n) => Number.isInteger(n) && n > 0);
