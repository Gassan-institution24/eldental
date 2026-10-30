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
import { ChartTab } from '@/features/clinical/pages/ChartTab';
import { NotesTab, PerioTab } from '@/features/clinical/pages/NotesPerioTabs';
import { PlansTab } from '@/features/clinical/pages/PlansTab';
import {
  ConsentsTab,
  LabOrdersPage,
  LabTab,
  PrescriptionsTab,
} from '@/features/clinical/pages/RecordsTabs';
import { ConsentTemplatesPage, NoteTemplatesPage } from '@/features/clinical/pages/TemplatePages';
import { PatientAppointmentsTab } from '@/features/scheduling/components/PatientAppointmentsTab';
import { CalendarPage } from '@/features/scheduling/pages/CalendarPage';
import { SchedulesPage } from '@/features/scheduling/pages/SchedulesPage';
import { TodayBoardPage } from '@/features/scheduling/pages/TodayBoardPage';
import { RecallsPage, WaitlistPage } from '@/features/scheduling/pages/WaitlistRecallPages';
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
  page(
    <CalendarPage />,
    { perm: 'scheduling.appointment.read', title: 'nav:calendar' },
    'calendar',
  ),
  page(<TodayBoardPage />, { perm: 'scheduling.appointment.read', title: 'nav:today' }, 'today'),
  page(
    <SchedulesPage />,
    { perm: 'scheduling.schedule.read', title: 'nav:schedules' },
    'schedules',
  ),
  page(<WaitlistPage />, { perm: 'scheduling.waitlist.manage', title: 'nav:waitlist' }, 'waitlist'),
  page(<RecallsPage />, { perm: 'scheduling.recall.manage', title: 'nav:recalls' }, 'recalls'),
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
  page(<LabOrdersPage />, { perm: 'clinical.labOrder.read', title: 'nav:labOrders' }, 'lab-orders'),
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
      page(<NoteTemplatesPage />, { perm: 'clinical.note.sign' }, 'note-templates'),
      page(<ConsentTemplatesPage />, { perm: 'clinical.consent.manage' }, 'consents'),
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
    page(<PatientAppointmentsTab />, { perm: 'scheduling.appointment.read' }, 'appointments'),
    page(<ChartTab />, { perm: 'clinical.chart.read' }, 'chart'),
    page(<PlansTab />, { perm: 'clinical.treatmentPlan.read' }, 'plans'),
    page(<NotesTab />, { perm: 'clinical.note.read' }, 'notes'),
    page(<PerioTab />, { perm: 'clinical.perio.read' }, 'perio'),
    page(<DocumentsTab imagingOnly />, { perm: 'clinical.imaging.read' }, 'imaging'),
    page(<PrescriptionsTab />, { perm: 'clinical.prescription.read' }, 'prescriptions'),
    page(<LabTab />, { perm: 'clinical.labOrder.read' }, 'lab'),
    page(<ConsentsTab />, { perm: 'clinical.chart.read' }, 'consents'),
    page(<MedicalTab />, { perm: 'patients.medicalHistory.read' }, 'medical'),
    page(<InsuranceTab />, {}, 'insurance'),
    page(<DocumentsTab />, { perm: 'patients.document.read' }, 'documents'),
    page(<HistoryTab />, {}, 'history'),
    ...PATIENT_EXTRA_ROUTES,
  ];
}
