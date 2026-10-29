import { Navigate, type RouteObject } from 'react-router-dom';
import { placeholder } from '../routeHelpers';

/** Clinic route tree (10_FRONTEND.md §3). Modules replace placeholders as phases land. */
export const clinicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to="dashboard" replace /> },
  placeholder('dashboard', 'nav:dashboard', 'reports.dashboard.read'),
  placeholder('calendar', 'nav:calendar', 'scheduling.appointment.read'),
  placeholder('today', 'nav:today', 'scheduling.appointment.read'),
  placeholder('waitlist', 'nav:waitlist', 'scheduling.waitlist.manage'),
  placeholder('recalls', 'nav:recalls', 'scheduling.recall.manage'),
  placeholder('patients/*', 'nav:patients', 'patients.patient.read'),
  placeholder('billing/*', 'nav:invoices', 'billing.invoice.read'),
  placeholder('accounting/*', 'nav:accounts', 'accounting.account.read'),
  placeholder('hr/*', 'nav:staff', 'staff.member.read'),
  placeholder('inventory', 'nav:inventoryItems', 'inventory.item.read'),
  placeholder('reports', 'nav:reportsOperational', 'reports.operational.read'),
  placeholder('settings/*', 'nav:settingsGeneral', 'clinic.settings.read'),
  placeholder('me', 'common:layout.profile'),
];
