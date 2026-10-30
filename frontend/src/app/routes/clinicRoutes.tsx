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
import { RolesPage } from '@/features/staff/pages/RolesPage';
import { StaffListPage } from '@/features/staff/pages/StaffListPage';
import { MyProfileRedirect, StaffProfilePage } from '@/features/staff/pages/StaffProfilePage';
import { PatientListPage } from '@/features/patients/pages/PatientListPage';
import { PatientCreatePage, PatientEditPage } from '@/features/patients/pages/PatientFormPage';
import { PatientWorkspace } from '@/features/patients/pages/PatientWorkspace';
import { PATIENT_EXTRA_ROUTES } from './patientExtraRoutes';
import {
  DocumentsTab,
  HistoryTab,
  InsuranceTab,
  MedicalTab,
  OverviewTab,
} from '@/features/patients/pages/PatientTabs';
import { page, placeholder } from '../routeHelpers';

/** Clinic route tree (10_FRONTEND.md §3). Modules replace placeholders as they land. */
export const clinicRoutes: RouteObject[] = [
  { index: true, element: <Navigate to="dashboard" replace /> },
  page(<DashboardPage />, { title: 'nav:dashboard' }, 'dashboard'),
  placeholder('calendar', 'nav:calendar', 'scheduling.appointment.read'),
  placeholder('today', 'nav:today', 'scheduling.appointment.read'),
  placeholder('waitlist', 'nav:waitlist', 'scheduling.waitlist.manage'),
  placeholder('recalls', 'nav:recalls', 'scheduling.recall.manage'),
  page(<PatientListPage />, { perm: 'patients.patient.read' }, 'patients'),
  page(<PatientCreatePage />, { perm: 'patients.patient.create' }, 'patients/new'),
  page(<PatientEditPage />, { perm: 'patients.patient.update' }, 'patients/:id/edit'),
  {
    path: 'patients/:id',
    element: <PatientWorkspace />,
    handle: { perm: 'patients.patient.read' },
    children: patientTabRoutes(),
  },
  placeholder('billing/*', 'nav:invoices', 'billing.invoice.read'),
  placeholder('accounting/*', 'nav:accounts', 'accounting.account.read'),
  page(<StaffListPage />, { perm: 'staff.member.read' }, 'hr/staff'),
  page(<StaffProfilePage />, { perm: 'staff.member.read' }, 'hr/staff/:id'),
  placeholder('hr/*', 'nav:shifts', 'hr.shift.manage'),
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
      page(<RolesPage />, { perm: 'staff.role.manage' }, 'roles'),
      placeholder('logs', 'settings:tabs.logs', 'logs.activity.read'),
    ],
  },
  page(<MyProfileRedirect />, {}, 'me'),
];

/** Workspace tabs; clinical and billing modules add their own children. */
function patientTabRoutes(): RouteObject[] {
  return [
    { index: true, element: <OverviewTab /> },
    page(<MedicalTab />, { perm: 'patients.medicalHistory.read' }, 'medical'),
    page(<InsuranceTab />, {}, 'insurance'),
    page(<DocumentsTab />, { perm: 'patients.document.read' }, 'documents'),
    page(<HistoryTab />, {}, 'history'),
    ...PATIENT_EXTRA_ROUTES,
  ];
}
