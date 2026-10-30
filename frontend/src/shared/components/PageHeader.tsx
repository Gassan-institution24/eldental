import {
  Box,
  Breadcrumbs,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { MoreVertical } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';

export type Crumb = { label: string; to?: string };
export type SecondaryAction = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
};

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: Crumb[];
  /** One primary button per view (top-end: right in LTR, left in RTL). */
  primary?: ReactNode;
  actions?: ReactNode;
  secondary?: SecondaryAction[];
};

export function PageHeader({ title, subtitle, breadcrumbs, primary, actions, secondary }: Props) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const items = (secondary ?? []).filter((s) => !s.hidden);

  return (
    <Box component="header" sx={{ mb: 5 }}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs aria-label={t('layout.breadcrumbs')} sx={{ mb: 1, fontSize: 13 }}>
          {breadcrumbs.map((c, i) =>
            c.to && i < breadcrumbs.length - 1 ? (
              <Link
                key={c.label}
                component={RouterLink}
                to={c.to}
                underline="hover"
                color="text.secondary"
              >
                {c.label}
              </Link>
            ) : (
              <Typography key={c.label} fontSize={13} color="text.primary" dir="auto">
                {c.label}
              </Typography>
            ),
          )}
        </Breadcrumbs>
      )}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={3}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h2" component="h1" dir="auto" sx={{ wordBreak: 'break-word' }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={2} alignItems="center" flexShrink={0}>
          {actions}
          {items.length > 0 && (
            <>
              <Tooltip title={t('actions.more')}>
                <IconButton
                  aria-label={t('actions.more')}
                  onClick={(e) => setAnchor(e.currentTarget)}
                >
                  <MoreVertical size={20} />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
                {items.map((s) => (
                  <MenuItem
                    key={s.label}
                    disabled={s.disabled}
                    onClick={() => {
                      setAnchor(null);
                      s.onClick();
                    }}
                  >
                    {s.icon && <Box sx={{ display: 'inline-flex', mr: 2 }}>{s.icon}</Box>}
                    {s.label}
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}
          {primary}
        </Stack>
      </Stack>
    </Box>
  );
}
