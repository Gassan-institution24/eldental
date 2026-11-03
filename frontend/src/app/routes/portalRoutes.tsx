import type { RouteObject } from 'react-router-dom';
import { page } from '../routeHelpers';
import { AppointmentsPage } from '@/features/portal/pages/AppointmentsPage';
import { BookPage } from '@/features/portal/pages/BookPage';
import { DocumentsPage } from '@/features/portal/pages/DocumentsPage';
import { FamilyPage } from '@/features/portal/pages/FamilyPage';
import { InvoicesPage } from '@/features/portal/pages/InvoicesPage';
import { PlansPage } from '@/features/portal/pages/PlansPage';
import { PortalHomePage } from '@/features/portal/pages/PortalHomePage';
import { ProfilePage } from '@/features/portal/pages/ProfilePage';

/** Patient portal (Phase 9). */
export const portalRoutes: RouteObject[] = [
  page(<PortalHomePage />, {}, undefined, true),
  page(<BookPage />, { title: 'nav:portal.book' }, 'book'),
  page(<AppointmentsPage />, { title: 'nav:portal.appointments' }, 'appointments'),
  page(<PlansPage />, { title: 'nav:portal.plans' }, 'plans'),
  page(<InvoicesPage />, { title: 'nav:portal.invoices' }, 'invoices'),
  page(<DocumentsPage />, { title: 'nav:portal.documents' }, 'documents'),
  page(<FamilyPage />, { title: 'nav:portal.family' }, 'family'),
  page(<ProfilePage />, { title: 'nav:portal.profile' }, 'profile'),
];

/** Public pages (no auth): clinic page + online booking, portal login/signup. */
export const publicRoutes: RouteObject[] = [];
