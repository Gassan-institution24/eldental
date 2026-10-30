import { Stack } from '@mui/material';
import {
  Activity,
  BookMarked,
  Building2,
  CreditCard,
  LayoutDashboard,
  Megaphone,
  Package,
  Settings,
  ShieldCheck,
  LifeBuoy,
  Users,
  KeyRound,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLogout } from '@/features/auth/api/authApi';
import { useSessionData } from '@/features/auth/api/session';
import { usePermission } from '@/shared/rbac/usePermission';
import { NotificationsMenu } from '@/features/notifications/components/NotificationsMenu';
import { AppShell, Brand, type NavGroup } from './shell/AppShell';
import { LanguageToggle, ThemeToggle, UserMenu } from './shell/ShellControls';

const I = 20;
export const ADMIN_NAV = [
  {
    key: 'platform',
    items: [
      {
        key: 'admin.dashboard',
        to: '/admin',
        icon: <LayoutDashboard size={I} />,
        perm: 'platform.stats.read',
        end: true,
      },
      {
        key: 'admin.clinics',
        to: '/admin/clinics',
        icon: <Building2 size={I} />,
        perm: 'platform.clinic.read',
      },
      {
        key: 'admin.plans',
        to: '/admin/plans',
        icon: <Package size={I} />,
        perm: 'platform.plan.manage',
      },
      {
        key: 'admin.subscriptions',
        to: '/admin/subscriptions',
        icon: <CreditCard size={I} />,
        perm: 'platform.subscription.manage',
      },
      {
        key: 'admin.catalog',
        to: '/admin/catalog',
        icon: <BookMarked size={I} />,
        perm: 'platform.catalog.manage',
      },
      {
        key: 'admin.roleTemplates',
        to: '/admin/role-templates',
        icon: <KeyRound size={I} />,
        perm: 'platform.catalog.manage',
      },
    ],
  },
  {
    key: 'settings',
    items: [
      {
        key: 'admin.users',
        to: '/admin/users',
        icon: <Users size={I} />,
        perm: 'platform.user.read',
      },
      {
        key: 'admin.superadmins',
        to: '/admin/superadmins',
        icon: <ShieldCheck size={I} />,
        perm: 'platform.superadmin.manage',
      },
      {
        key: 'admin.settings',
        to: '/admin/settings',
        icon: <Settings size={I} />,
        perm: 'platform.settings.manage',
      },
    ],
  },
  {
    key: 'monitoring',
    items: [
      {
        key: 'admin.logs',
        to: '/admin/logs',
        icon: <Activity size={I} />,
        perm: 'platform.logs.audit.read',
      },
      {
        key: 'admin.announcements',
        to: '/admin/announcements',
        icon: <Megaphone size={I} />,
        perm: 'platform.announcement.manage',
      },
      {
        key: 'admin.tickets',
        to: '/admin/tickets',
        icon: <LifeBuoy size={I} />,
        perm: 'platform.ticket.manage',
      },
    ],
  },
];

/** Superadmin panel shell (`/admin`). */
export function AdminLayout() {
  const { t } = useTranslation('nav');
  const { t: tc } = useTranslation();
  const session = useSessionData();
  const { can } = usePermission();
  const logout = useLogout();
  const nav: NavGroup[] = useMemo(
    () =>
      ADMIN_NAV.map((g) => ({
        key: g.key,
        label: t(`groups.${g.key}`),
        items: g.items
          .filter((i) => can(i.perm))
          .map((i) => ({ key: i.key, to: i.to, icon: i.icon, label: t(i.key), end: i.end })),
      })),
    [t, can],
  );
  return (
    <AppShell
      nav={nav}
      brand={<Brand subtitle={tc('layout.adminPanel')} />}
      topbar={
        <Stack direction="row" spacing={1} alignItems="center" sx={{ marginInlineStart: 'auto' }}>
          <NotificationsMenu />
          <LanguageToggle />
          <ThemeToggle />
          <UserMenu
            name={session?.user.displayName ?? ''}
            subtitle={session?.user.email}
            onLogout={() => void logout()}
          />
        </Stack>
      }
    />
  );
}
