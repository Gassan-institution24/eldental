import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { page, placeholder } from '../routeHelpers';

const AdminDashboardPage = lazy(() =>
  import('@/features/admin/pages/AdminDashboardPage').then((m) => ({
    default: m.AdminDashboardPage,
  })),
);
const ClinicsListPage = lazy(() =>
  import('@/features/admin/pages/ClinicsPages').then((m) => ({ default: m.ClinicsListPage })),
);
const ClinicDetailPage = lazy(() =>
  import('@/features/admin/pages/ClinicsPages').then((m) => ({ default: m.ClinicDetailPage })),
);
const SubscriptionsPage = lazy(() =>
  import('@/features/admin/pages/ClinicsPages').then((m) => ({ default: m.SubscriptionsPage })),
);
const PlansPage = lazy(() =>
  import('@/features/admin/pages/CatalogPages').then((m) => ({ default: m.PlansPage })),
);
const CatalogPage = lazy(() =>
  import('@/features/admin/pages/CatalogPages').then((m) => ({ default: m.CatalogPage })),
);
const RoleTemplatesPage = lazy(() =>
  import('@/features/admin/pages/CatalogPages').then((m) => ({ default: m.RoleTemplatesPage })),
);
const UsersPage = lazy(() =>
  import('@/features/admin/pages/AccessPages').then((m) => ({ default: m.UsersPage })),
);
const SuperadminsPage = lazy(() =>
  import('@/features/admin/pages/AccessPages').then((m) => ({ default: m.SuperadminsPage })),
);
const LogsPage = lazy(() =>
  import('@/features/admin/pages/LogsPage').then((m) => ({ default: m.LogsPage })),
);

/** Superadmin route tree (04 §8). Settings/integrations, announcements and tickets come later (Part C). */
export const adminRoutes: RouteObject[] = [
  page(
    <AdminDashboardPage />,
    { perm: 'platform.stats.read', title: 'nav:admin.dashboard' },
    undefined,
    true,
  ),
  page(
    <ClinicsListPage />,
    { perm: 'platform.clinic.read|platform.subscription.manage', title: 'nav:admin.clinics' },
    'clinics',
  ),
  page(
    <ClinicDetailPage />,
    { perm: 'platform.clinic.read|platform.subscription.manage', title: 'nav:admin.clinics' },
    'clinics/:id',
  ),
  page(<PlansPage />, { perm: 'platform.plan.manage', title: 'nav:admin.plans' }, 'plans'),
  page(
    <SubscriptionsPage />,
    { perm: 'platform.subscription.manage', title: 'nav:admin.subscriptions' },
    'subscriptions',
  ),
  page(<CatalogPage />, { perm: 'platform.catalog.manage', title: 'nav:admin.catalog' }, 'catalog'),
  page(
    <RoleTemplatesPage />,
    { perm: 'platform.catalog.manage', title: 'nav:admin.roleTemplates' },
    'role-templates',
  ),
  page(<UsersPage />, { perm: 'platform.user.read', title: 'nav:admin.users' }, 'users'),
  page(
    <SuperadminsPage />,
    { perm: 'platform.superadmin.manage', title: 'nav:admin.superadmins' },
    'superadmins',
  ),
  page(
    <LogsPage />,
    {
      perm: 'platform.logs.audit.read|platform.logs.activity.read|platform.logs.issues.read|platform.logs.errors.read|platform.logs.requests.read',
      title: 'nav:admin.logs',
    },
    'logs',
  ),
  placeholder('settings/*', 'nav:admin.settings', 'platform.settings.manage'),
  placeholder('announcements', 'nav:admin.announcements', 'platform.announcement.manage'),
  placeholder('tickets', 'nav:admin.tickets', 'platform.ticket.manage'),
];
