import type { RouteObject } from 'react-router-dom';
import { page, placeholder } from '../routeHelpers';
import { PlaceholderPage } from '@/shared/components/PlaceholderPage';

/** Patient portal (Phase 9). */
export const portalRoutes: RouteObject[] = [
  page(<PlaceholderPage titleKey="nav:portal.home" />, {}, undefined, true),
  placeholder('book', 'nav:portal.book'),
  placeholder('appointments', 'nav:portal.appointments'),
  placeholder('plans', 'nav:portal.plans'),
  placeholder('invoices', 'nav:portal.invoices'),
  placeholder('family', 'nav:portal.family'),
  placeholder('profile', 'nav:portal.profile'),
];

/** Public pages (no auth): clinic page + online booking, portal login/signup. */
export const publicRoutes: RouteObject[] = [];
