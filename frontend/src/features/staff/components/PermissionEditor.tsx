import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  FormControlLabel,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { ChevronDown, Lock, Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FieldAccess, Scope } from '@/shared/generated/rbac/rbac.types';
import { toSearchName } from '@/shared/generated/validation/normalize';
import type { FieldDef, Grant, Registry } from '../api';

const LEVELS: FieldAccess[] = ['hidden', 'masked', 'read', 'write'];

type Props = {
  registry: Registry;
  value: Grant[];
  onChange: (next: Grant[]) => void;
  readOnly?: boolean;
  /** Overrides mode: permissions can also be explicitly removed. */
  revoked?: Set<string>;
  onToggleRevoked?: (permission: string) => void;
};

/** Effective field map of a resource in a grant list (missing keys → registry default). */
export function resourceFieldMap(
  value: Grant[],
  resource: string,
  fields: Record<string, FieldDef>,
): Record<string, FieldAccess> {
  const grant =
    value.find((g) => g.permission === `${resource}.read`) ??
    value.find((g) => g.permission.startsWith(`${resource}.`));
  return Object.fromEntries(
    Object.entries(fields).map(([f, def]) => [f, grant?.fields?.[f] ?? def.default]),
  );
}

/**
 * Module → resource → actions (own/all) → fields (hidden/masked/read/write), with search,
 * presets and group bulk-set (04 §7). Field rules apply to every permission of the resource.
 */
export function PermissionEditor({
  registry,
  value,
  onChange,
  readOnly,
  revoked,
  onToggleRevoked,
}: Props) {
  const { t } = useTranslation(['perm', 'roles']);
  const [q, setQ] = useState('');
  const [openFields, setOpenFields] = useState<Record<string, boolean>>({});
  const byPerm = useMemo(() => new Map(value.map((g) => [g.permission, g])), [value]);
  const needle = toSearchName(q);

  const permLabel = (key: string) => t(`perm:${key}`, { defaultValue: key });
  const resLabel = (res: string) => t(`perm:resources.${res}`, { defaultValue: res });
  const fieldLabel = (f: string) => t(`perm:fields.${f}`, { defaultValue: f });

  const setGrant = (permission: string, patch: Partial<Grant> | null) => {
    const others = value.filter((g) => g.permission !== permission);
    if (patch === null) return onChange(others);
    const current = byPerm.get(permission);
    const resource = permission.split('.').slice(0, -1).join('.');
    // New permissions inherit the resource's current field rules so the resource stays consistent.
    const sibling = value.find((g) => g.permission.startsWith(`${resource}.`) && g.fields);
    onChange([
      ...others,
      {
        permission,
        scope: 'all',
        ...(sibling?.fields ? { fields: sibling.fields } : {}),
        ...current,
        ...patch,
      },
    ]);
  };

  const setFields = (resource: string, fields: Record<string, FieldAccess>) => {
    onChange(value.map((g) => (g.permission.startsWith(`${resource}.`) ? { ...g, fields } : g)));
  };

  const modules = registry.modules
    .map((m) => ({
      module: m,
      resources: Object.entries(registry.resources).filter(([res, r]) => {
        if (r.module !== m) return false;
        if (!needle) return true;
        const hay = toSearchName(
          [
            resLabel(res),
            ...r.actions.map((a) => permLabel(a.key)),
            ...Object.keys(r.fields ?? {}).map(fieldLabel),
          ].join(' '),
        );
        return hay.includes(needle);
      }),
    }))
    .filter((m) => m.resources.length > 0);

  return (
    <Box>
      <TextField
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('roles:search')}
        sx={{ mb: 4, maxWidth: 420 }}
        inputProps={{ dir: 'auto', 'aria-label': t('roles:search') }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search size={16} />
            </InputAdornment>
          ),
        }}
      />
      {modules.map(({ module, resources }) => {
        const granted = resources.reduce(
          (n, [, r]) => n + r.actions.filter((a) => byPerm.has(a.key)).length,
          0,
        );
        return (
          <Accordion key={module} defaultExpanded={Boolean(needle)} sx={{ mb: 3 }}>
            <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ px: 5 }}>
              <Stack direction="row" spacing={3} alignItems="center" sx={{ flex: 1 }}>
                <Typography fontWeight={700}>{t(`perm:modules.${module}`)}</Typography>
                {granted > 0 && (
                  <Chip size="small" color="primary" variant="outlined" label={granted} />
                )}
              </Stack>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 5, pt: 0 }}>
              {resources.map(([res, r]) => {
                const hasAny = r.actions.some((a) => byPerm.has(a.key));
                const fieldMap = r.fields ? resourceFieldMap(value, res, r.fields) : null;
                const visibleCount = fieldMap
                  ? Object.values(fieldMap).filter((l) => l !== 'hidden').length
                  : 0;
                return (
                  <Box key={res} sx={{ py: 3, borderTop: 1, borderColor: 'divider' }}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={3}
                      alignItems={{ md: 'center' }}
                    >
                      <Typography fontWeight={650} sx={{ width: { md: 200 }, flexShrink: 0 }}>
                        {resLabel(res)}
                      </Typography>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2, flex: 1 }}>
                        {r.actions.map((a) => {
                          const g = byPerm.get(a.key);
                          const isRevoked = revoked?.has(a.key);
                          return (
                            <Stack
                              key={a.key}
                              direction="row"
                              alignItems="center"
                              sx={(th) => ({
                                pl: 1,
                                pr: g && a.scopes.length > 1 ? 1 : 3,
                                borderRadius: '10px',
                                border: 1,
                                borderColor: g ? alpha(th.palette.primary.main, 0.4) : 'divider',
                                bgcolor: g
                                  ? alpha(th.palette.primary.main, 0.06)
                                  : isRevoked
                                    ? alpha(th.palette.error.main, 0.06)
                                    : 'transparent',
                              })}
                            >
                              <Tooltip title={permLabel(a.key)}>
                                <FormControlLabel
                                  sx={{ m: 0 }}
                                  disabled={readOnly}
                                  control={
                                    <Checkbox
                                      size="small"
                                      checked={Boolean(g)}
                                      onChange={(e) =>
                                        setGrant(
                                          a.key,
                                          e.target.checked
                                            ? { scope: a.scopes.includes('all') ? 'all' : 'own' }
                                            : null,
                                        )
                                      }
                                    />
                                  }
                                  label={
                                    <Typography
                                      variant="body2"
                                      sx={{ textDecoration: isRevoked ? 'line-through' : 'none' }}
                                    >
                                      {t(`perm:actions.${a.action}`, { defaultValue: a.action })}
                                    </Typography>
                                  }
                                />
                              </Tooltip>
                              {g && a.scopes.length > 1 && (
                                <ToggleButtonGroup
                                  size="small"
                                  exclusive
                                  value={g.scope}
                                  disabled={readOnly}
                                  onChange={(_e, v: Scope | null) =>
                                    v && setGrant(a.key, { scope: v })
                                  }
                                  sx={{
                                    ml: 1,
                                    '& .MuiToggleButton-root': {
                                      py: 0.25,
                                      px: 1.5,
                                      fontSize: 12,
                                      textTransform: 'none',
                                    },
                                  }}
                                >
                                  {a.scopes.map((s) => (
                                    <Tooltip key={s} title={t(`perm:scope.${s}Hint`)}>
                                      <ToggleButton value={s}>{t(`perm:scope.${s}`)}</ToggleButton>
                                    </Tooltip>
                                  ))}
                                </ToggleButtonGroup>
                              )}
                              {onToggleRevoked && !g && (
                                <Button
                                  size="small"
                                  color={isRevoked ? 'inherit' : 'error'}
                                  sx={{ minWidth: 0, ml: 1, fontSize: 12 }}
                                  onClick={() => onToggleRevoked(a.key)}
                                  disabled={readOnly}
                                >
                                  {isRevoked ? t('staff:revoked') : t('staff:revoke')}
                                </Button>
                              )}
                            </Stack>
                          );
                        })}
                      </Stack>
                      {r.fields && hasAny && (
                        <Button
                          size="small"
                          startIcon={<SlidersHorizontal size={16} />}
                          onClick={() => setOpenFields((o) => ({ ...o, [res]: !o[res] }))}
                          sx={{ flexShrink: 0 }}
                        >
                          {t('roles:fieldsCount', {
                            visible: visibleCount,
                            total: Object.keys(r.fields).length,
                          })}
                        </Button>
                      )}
                    </Stack>
                    {r.fields && fieldMap && (
                      <Collapse in={Boolean(openFields[res] || (needle && hasAny))} unmountOnExit>
                        <FieldRules
                          registry={registry}
                          fields={r.fields}
                          map={fieldMap}
                          readOnly={readOnly}
                          onChange={(m) => setFields(res, m)}
                          fieldLabel={fieldLabel}
                          needle={needle}
                        />
                      </Collapse>
                    )}
                  </Box>
                );
              })}
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}

function FieldRules({
  registry,
  fields,
  map,
  onChange,
  readOnly,
  fieldLabel,
}: {
  registry: Registry;
  fields: Record<string, FieldDef>;
  map: Record<string, FieldAccess>;
  onChange: (m: Record<string, FieldAccess>) => void;
  readOnly?: boolean;
  fieldLabel: (f: string) => string;
  needle?: string;
}) {
  const { t } = useTranslation(['perm', 'roles']);
  const groups = registry.fieldGroupOrder.filter((g) =>
    Object.values(fields).some((d) => d.group === g),
  );
  const preset = (kind: 'basic' | 'contact' | 'all') => {
    const next: Record<string, FieldAccess> = {};
    for (const [f, d] of Object.entries(fields)) {
      if (kind === 'all') next[f] = 'write';
      else
        next[f] =
          d.group === 'basic' || (kind === 'contact' && d.group === 'contact') ? 'read' : 'hidden';
    }
    onChange(next);
  };
  return (
    <Box
      sx={(th) => ({
        mt: 3,
        p: 4,
        borderRadius: '12px',
        bgcolor: alpha(th.palette.primary.main, 0.03),
        border: 1,
        borderColor: 'divider',
      })}
    >
      {!readOnly && (
        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          sx={{ mb: 3, flexWrap: 'wrap', rowGap: 2 }}
        >
          <Typography variant="caption" fontWeight={700}>
            {t('roles:presets')}
          </Typography>
          <Button size="small" variant="outlined" onClick={() => preset('basic')}>
            {t('roles:presetBasic')}
          </Button>
          <Button size="small" variant="outlined" onClick={() => preset('contact')}>
            {t('roles:presetContact')}
          </Button>
          <Button size="small" variant="outlined" onClick={() => preset('all')}>
            {t('roles:presetAll')}
          </Button>
        </Stack>
      )}
      {groups.map((g) => {
        const entries = Object.entries(fields).filter(([, d]) => d.group === g);
        return (
          <Box key={g} sx={{ mb: 3 }}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary">
                {t(`perm:groups.${g}`)}
              </Typography>
              {!readOnly && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  onChange={(_e, v: FieldAccess | null) =>
                    v &&
                    onChange({
                      ...map,
                      ...Object.fromEntries(
                        entries.map(([f, d]) => [f, v === 'masked' && !d.maskable ? 'hidden' : v]),
                      ),
                    })
                  }
                  sx={{
                    '& .MuiToggleButton-root': {
                      py: 0,
                      px: 1.5,
                      fontSize: 11,
                      textTransform: 'none',
                    },
                  }}
                  aria-label={t('roles:groupSet')}
                >
                  {LEVELS.map((l) => (
                    <ToggleButton key={l} value={l}>
                      {t(`perm:access.${l}`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              )}
            </Stack>
            {entries.map(([f, d]) => (
              <Stack
                key={f}
                direction={{ xs: 'column', sm: 'row' }}
                alignItems={{ sm: 'center' }}
                spacing={2}
                sx={{ py: 1 }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  sx={{ width: { sm: 220 }, flexShrink: 0 }}
                >
                  <Typography variant="body2">{fieldLabel(f)}</Typography>
                  {d.sensitive && (
                    <Box sx={{ color: 'warning.main', display: 'flex' }}>
                      <Lock size={13} />
                    </Box>
                  )}
                </Stack>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={map[f]}
                  disabled={readOnly}
                  onChange={(_e, v: FieldAccess | null) => v && onChange({ ...map, [f]: v })}
                  sx={{
                    '& .MuiToggleButton-root': {
                      py: 0.25,
                      px: 2,
                      fontSize: 12,
                      textTransform: 'none',
                    },
                  }}
                  aria-label={fieldLabel(f)}
                >
                  {LEVELS.map((l) => (
                    <ToggleButton key={l} value={l} disabled={l === 'masked' && !d.maskable}>
                      {t(`perm:access.${l}`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

/** Plain-language summary for a resource, e.g. "Can see staff: name, phone. Cannot see: salary." */
export function useAccessSummary() {
  const { t, i18n } = useTranslation(['perm', 'roles']);
  const fmt = new Intl.ListFormat(i18n.resolvedLanguage ?? 'ar', {
    style: 'long',
    type: 'conjunction',
  });
  return (
    value: Grant[],
    resource: string,
    fields: Record<string, FieldDef> | undefined,
    isOwner = false,
  ): string[] => {
    const resLabel = t(`perm:resources.${resource}`);
    if (isOwner) return [t('roles:ownerRole')];
    if (!value.some((g) => g.permission === `${resource}.read`))
      return [t('roles:summaryNoAccess', { resource: resLabel })];
    if (!fields) return [];
    const map = resourceFieldMap(value, resource, fields);
    const list = (lvls: FieldAccess[]) =>
      Object.entries(map)
        .filter(([, l]) => lvls.includes(l))
        .map(([f]) => t(`perm:fields.${f}`));
    const out = [
      t('roles:summaryFields', { resource: resLabel, fields: fmt.format(list(['read', 'write'])) }),
    ];
    const masked = list(['masked']);
    const hidden = list(['hidden']);
    if (masked.length) out.push(t('roles:summaryMasked', { fields: fmt.format(masked) }));
    if (hidden.length) out.push(t('roles:summaryHidden', { fields: fmt.format(hidden) }));
    return out;
  };
}
