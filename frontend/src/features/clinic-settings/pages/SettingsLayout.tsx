import {
  Box,
  Card,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tab,
  Tabs,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Armchair,
  Building2,
  CalendarRange,
  Clock,
  KeyRound,
  ListChecks,
  Plug,
  Receipt,
  ScrollText,
  Stethoscope,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/shared/components/PageHeader';
import { usePermission } from '@/shared/rbac/usePermission';

const TABS = [
  { key: 'general', to: 'general', icon: <Building2 size={18} />, perm: 'clinic.settings.read' },
  { key: 'hours', to: 'hours', icon: <Clock size={18} />, perm: 'clinic.settings.read' },
  { key: 'booking', to: 'booking', icon: <ListChecks size={18} />, perm: 'clinic.settings.read' },
  { key: 'chairs', to: 'chairs', icon: <Armchair size={18} />, perm: 'clinic.chair.manage' },
  {
    key: 'appointmentTypes',
    to: 'appointment-types',
    icon: <CalendarRange size={18} />,
    perm: 'clinic.appointmentType.manage',
  },
  {
    key: 'procedures',
    to: 'procedures',
    icon: <Stethoscope size={18} />,
    perm: 'clinic.procedure.manage',
  },
  { key: 'taxes', to: 'taxes', icon: <Receipt size={18} />, perm: 'accounting.account.read' },
  {
    key: 'integrations',
    to: 'integrations',
    icon: <Plug size={18} />,
    perm: 'clinic.settings.update',
  },
  { key: 'roles', to: 'roles', icon: <KeyRound size={18} />, perm: 'staff.role.manage' },
  { key: 'logs', to: 'logs', icon: <ScrollText size={18} />, perm: 'logs.activity.read' },
] as const;

/** Settings shell: side menu on desktop, scrollable tabs on mobile. */
export function SettingsLayout() {
  const { t } = useTranslation('settings');
  const { can } = usePermission();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const location = useLocation();
  const navigate = useNavigate();
  const tabs = TABS.filter((tab) => can(tab.perm));
  const current =
    tabs.find((tab) => location.pathname.includes(`/settings/${tab.to}`))?.to ?? tabs[0]?.to;

  return (
    <Box>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      {mobile ? (
        <Tabs
          value={current}
          onChange={(_e, v: string) => navigate(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{ mb: 5, borderBottom: 1, borderColor: 'divider' }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.key}
              value={tab.to}
              label={t(`tabs.${tab.key}`)}
              icon={tab.icon}
              iconPosition="start"
            />
          ))}
        </Tabs>
      ) : null}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '240px 1fr' },
          gap: 6,
          alignItems: 'start',
        }}
      >
        {!mobile && (
          <Card component="nav" sx={{ p: 2, position: 'sticky', top: 96 }} aria-label={t('title')}>
            <List dense disablePadding>
              {tabs.map((tab) => {
                const active = current === tab.to;
                return (
                  <ListItemButton
                    key={tab.key}
                    component={NavLink}
                    to={tab.to}
                    aria-current={active ? 'page' : undefined}
                    sx={(th) => ({
                      borderRadius: '10px',
                      mb: 0.5,
                      color: active ? 'primary.main' : 'text.primary',
                      bgcolor: active ? alpha(th.palette.primary.main, 0.1) : 'transparent',
                    })}
                  >
                    <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>{tab.icon}</ListItemIcon>
                    <ListItemText
                      primary={t(`tabs.${tab.key}`)}
                      primaryTypographyProps={{ fontWeight: active ? 700 : 500, fontSize: 14 }}
                    />
                  </ListItemButton>
                );
              })}
            </List>
          </Card>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
