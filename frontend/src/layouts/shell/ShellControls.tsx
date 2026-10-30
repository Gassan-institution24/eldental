import {
  Avatar,
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { Bell, Bug, Building2, FileText, LogOut, Moon, Plus, Sun, User } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useColorMode } from '@/app/providers/AppThemeProvider';
import { trackActivity } from '@/lib/telemetry';
import { useReportProblem } from '@/shared/components/reportProblemStore';
import { useUiStore } from '@/stores/uiStore';

/** ع / EN toggle, available on every screen including login. */
export function LanguageToggle({ size = 'small' }: { size?: 'small' | 'medium' }) {
  const { i18n, t } = useTranslation();
  const isAr = (i18n.resolvedLanguage ?? 'ar') === 'ar';
  const next = isAr ? 'en' : 'ar';
  return (
    <Tooltip title={t('layout.language')}>
      <Button
        size={size}
        variant="outlined"
        color="inherit"
        onClick={() => {
          void i18n.changeLanguage(next);
          trackActivity({ type: 'language_switch', meta: { to: next } });
        }}
        aria-label={t('layout.language')}
        sx={{ minWidth: 48, fontWeight: 700, borderColor: 'divider' }}
        lang={next}
      >
        {isAr ? 'EN' : 'ع'}
      </Button>
    </Tooltip>
  );
}

export function ThemeToggle() {
  const { t } = useTranslation();
  const mode = useColorMode();
  const toggle = useUiStore((s) => s.toggleMode);
  return (
    <Tooltip title={mode === 'dark' ? t('layout.lightMode') : t('layout.darkMode')}>
      <IconButton onClick={() => toggle(mode)} aria-label={t('layout.toggleTheme')}>
        {mode === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </IconButton>
    </Tooltip>
  );
}

export type QuickAction = { key: string; label: string; icon: ReactNode; onClick: () => void };

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (actions.length === 0) return null;
  return (
    <>
      <Tooltip title={t('layout.quickActions')}>
        <IconButton
          aria-label={t('layout.quickActions')}
          onClick={(e) => setAnchor(e.currentTarget)}
          color="primary"
        >
          <Plus size={22} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {actions.map((a) => (
          <MenuItem
            key={a.key}
            onClick={() => {
              setAnchor(null);
              a.onClick();
            }}
          >
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function NotificationsButton({
  count,
  onClick,
}: {
  count: number;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip title={t('layout.notifications')}>
      <IconButton aria-label={t('layout.notifications')} onClick={onClick}>
        <Badge color="error" badgeContent={count} max={99}>
          <Bell size={20} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}

type UserMenuProps = {
  name: string;
  subtitle?: string;
  onLogout: () => void;
  onProfile?: () => void;
  onPayslips?: () => void;
  onSwitchClinic?: () => void;
};

export function UserMenu({
  name,
  subtitle,
  onLogout,
  onProfile,
  onPayslips,
  onSwitchClinic,
}: UserMenuProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const openReport = useReportProblem((s) => s.open);
  const close = () => setAnchor(null);
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
  return (
    <>
      <Tooltip title={t('layout.userMenu')}>
        <IconButton aria-label={t('layout.userMenu')} onClick={(e) => setAnchor(e.currentTarget)}>
          <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: 'primary.main' }}>
            {initials || <User size={16} />}
          </Avatar>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={close}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        <Box sx={{ px: 4, py: 2 }}>
          <Typography fontWeight={600} dir="auto" noWrap>
            {name}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" dir="auto" noWrap>
              {subtitle}
            </Typography>
          )}
        </Box>
        <Divider />
        {onProfile && (
          <MenuItem onClick={() => (close(), onProfile())}>
            <ListItemIcon>
              <User size={18} />
            </ListItemIcon>
            {t('layout.profile')}
          </MenuItem>
        )}
        {onPayslips && (
          <MenuItem onClick={() => (close(), onPayslips())}>
            <ListItemIcon>
              <FileText size={18} />
            </ListItemIcon>
            {t('layout.myPayslips')}
          </MenuItem>
        )}
        {onSwitchClinic && (
          <MenuItem onClick={() => (close(), onSwitchClinic())}>
            <ListItemIcon>
              <Building2 size={18} />
            </ListItemIcon>
            {t('layout.switchClinic')}
          </MenuItem>
        )}
        <MenuItem onClick={() => (close(), openReport())}>
          <ListItemIcon>
            <Bug size={18} />
          </ListItemIcon>
          {t('layout.reportProblem')}
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => (close(), onLogout())}>
          <ListItemIcon>
            <LogOut size={18} />
          </ListItemIcon>
          {t('layout.logout')}
        </MenuItem>
      </Menu>
    </>
  );
}
