import { Navigate, type RouteObject } from 'react-router-dom';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import {
  BookingRulesPage,
  GeneralSettingsPage,
  HoursPage,
} from '@/features/clinic-settings/pages/GeneralPages';
import { IntegrationsPage } from '@/features/clinic-settings/pages/IntegrationsPage';
import { ProceduresPage } from '@/features/clinic-settings/pages/ProceduresPage';
import {
  AppointmentTypesPage,
  ChairsPage,
  TaxRatesPage,
} from '@/features/clinic-settings/pages/ResourcePages';
import { SettingsLayout } from '@/features/clinic-settings/pages/SettingsLayout';
import { page, placeholder } from '../routeHelpers';

/** Clinic route tree (10_FRONTEND.md §3). Modules replace placeholders as they land. */
export const clinicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to="dashboard" replace /> },
  page(<DashboardPage />, { title: 'nav:dashboard' }, 'dashboard'),
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
  {
    path: 'settings',
    element: <SettingsLayout />,
    handle: { perm: 'clinic.settings.read' },
    children: [
      { index: true, element: <Navigate to="general" replace /> },
      page(<GeneralSettingsPage />, { perm: 'clinic.settings.read' }, 'general'),
      page(<HoursPage />, { perm: 'clinic.settings.read' }, 'hours'),
      page(<BookingRulesPage />, { perm: 'clinic.settings.read' }, 'booking'),
      page(<ChairsPage />, { perm: 'clinic.chair.manage' }, 'chairs'),
      page(
        <AppointmentTypesPage />,
        { perm: 'clinic.appointmentType.manage' },
        'appointment-types',
      ),
      page(<ProceduresPage />, { perm: 'clinic.procedure.manage' }, 'procedures'),
      page(<TaxRatesPage />, { perm: 'accounting.account.read' }, 'taxes'),
      page(<IntegrationsPage />, { perm: 'clinic.settings.update' }, 'integrations'),
      placeholder('roles', 'settings:tabs.roles', 'staff.role.manage'),
      placeholder('logs', 'settings:tabs.logs', 'logs.activity.read'),
    ],
  },
  placeholder('me', 'common:layout.profile'),
];
