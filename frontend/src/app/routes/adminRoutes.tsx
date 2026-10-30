import type { RouteObject } from 'react-router-dom';
import { page, placeholder } from '../routeHelpers';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';

/** Superadmin route tree. */
export const adminRoutes: RouteObject[] = [
  page(
    <PlaceholderPage titleKey="nav:admin.dashboard" />,
    { perm: 'platform.stats.read' },
    undefined,
    true,
  ),
  placeholder('clinics/*', 'nav:admin.clinics', 'platform.clinic.read'),
  placeholder('plans', 'nav:admin.plans', 'platform.plan.manage'),
  placeholder('subscriptions', 'nav:admin.subscriptions', 'platform.subscription.manage'),
  placeholder('catalog/*', 'nav:admin.catalog', 'platform.catalog.manage'),
  placeholder('role-templates', 'nav:admin.roleTemplates', 'platform.catalog.manage'),
  placeholder('users', 'nav:admin.users', 'platform.user.read'),
  placeholder('superadmins', 'nav:admin.superadmins', 'platform.superadmin.manage'),
  placeholder('settings/*', 'nav:admin.settings', 'platform.settings.manage'),
  placeholder('logs/*', 'nav:admin.logs', 'platform.logs.audit.read'),
  placeholder('announcements', 'nav:admin.announcements', 'platform.announcement.manage'),
  placeholder('tickets', 'nav:admin.tickets', 'platform.ticket.manage'),
];
