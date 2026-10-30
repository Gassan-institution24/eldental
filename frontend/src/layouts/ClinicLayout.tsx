import { Alert, Button, Stack } from '@mui/material';
import {
  BadgeDollarSign,
  BarChart3,
  BookOpen,
  Boxes,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Clock,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  ReceiptText,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Stethoscope,
  Timer,
  Truck,
  UserPlus,
  Users,
  Wallet,
  CalendarPlus,
  Plane,
  Clock3,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLogout } from '@/features/auth/api/authApi';
import { useSessionData } from '@/features/auth/api/session';
import { usePatientSearchProvider } from '@/features/patients/api/patientSearch';
import { NotificationsMenu } from '@/features/notifications/components/NotificationsMenu';
import { usePermission } from '@/shared/rbac/usePermission';
import { AppointmentDrawer } from '@/features/scheduling/components/AppointmentDrawer';
import { QuickBookDrawer } from '@/features/scheduling/components/QuickBookDrawer';
import { useRealtime } from '@/lib/socket';
import { AppShell, Brand, type NavGroup } from './shell/AppShell';
import { GlobalSearch } from './shell/GlobalSearch';
import { LanguageToggle, QuickActions, ThemeToggle, UserMenu } from './shell/ShellControls';
import { useQuickBook } from '@/features/scheduling/components/quickBookStore';

type ItemDef = { key: string; to: string; icon: React.ReactNode; perm?: string; end?: boolean };
type GroupDef = { key: string; items: ItemDef[] };

const I = 20;
export const CLINIC_NAV: GroupDef[] = [
  {
    key: 'front',
    items: [
      {
        key: 'dashboard',
        to: '/clinic/dashboard',
        icon: <LayoutDashboard size={I} />,
        perm: 'reports.dashboard.read',
      },
      {
        key: 'calendar',
        to: '/clinic/calendar',
        icon: <CalendarDays size={I} />,
        perm: 'scheduling.appointment.read',
      },
      {
        key: 'today',
        to: '/clinic/today',
        icon: <ListChecks size={I} />,
        perm: 'scheduling.appointment.read',
      },
      {
        key: 'schedules',
        to: '/clinic/schedules',
        icon: <Clock3 size={I} />,
        perm: 'scheduling.schedule.read',
      },
      {
        key: 'waitlist',
        to: '/clinic/waitlist',
        icon: <Timer size={I} />,
        perm: 'scheduling.waitlist.manage',
      },
      {
        key: 'recalls',
        to: '/clinic/recalls',
        icon: <RefreshCcw size={I} />,
        perm: 'scheduling.recall.manage',
      },
    ],
  },
  {
    key: 'clinical',
    items: [
      {
        key: 'patients',
        to: '/clinic/patients',
        icon: <Users size={I} />,
        perm: 'patients.patient.read',
      },
    ],
  },
  {
    key: 'finance',
    items: [
      {
        key: 'invoices',
        to: '/clinic/billing/invoices',
        icon: <ReceiptText size={I} />,
        perm: 'billing.invoice.read',
      },
      {
        key: 'payments',
        to: '/clinic/billing/payments',
        icon: <CreditCard size={I} />,
        perm: 'billing.payment.read',
      },
      {
        key: 'cash',
        to: '/clinic/billing/cash',
        icon: <Wallet size={I} />,
        perm: 'billing.cashSession.manage',
      },
      {
        key: 'insurance',
        to: '/clinic/billing/insurance',
        icon: <ShieldCheck size={I} />,
        perm: 'billing.insurance.manage',
      },
      {
        key: 'claims',
        to: '/clinic/billing/claims',
        icon: <FileText size={I} />,
        perm: 'billing.insurance.manage',
      },
    ],
  },
  {
    key: 'accounting',
    items: [
      {
        key: 'accounts',
        to: '/clinic/accounting/accounts',
        icon: <BookOpen size={I} />,
        perm: 'accounting.account.read',
      },
      {
        key: 'journals',
        to: '/clinic/accounting/journals',
        icon: <FileSpreadsheet size={I} />,
        perm: 'accounting.journal.read',
      },
      {
        key: 'suppliers',
        to: '/clinic/accounting/suppliers',
        icon: <Truck size={I} />,
        perm: 'accounting.supplier.manage',
      },
      {
        key: 'bills',
        to: '/clinic/accounting/bills',
        icon: <ClipboardList size={I} />,
        perm: 'accounting.supplier.manage',
      },
      {
        key: 'expenses',
        to: '/clinic/accounting/expenses',
        icon: <BadgeDollarSign size={I} />,
        perm: 'accounting.expense.create',
      },
      {
        key: 'periods',
        to: '/clinic/accounting/periods',
        icon: <CalendarClock size={I} />,
        perm: 'accounting.period.manage',
      },
      {
        key: 'accountingReports',
        to: '/clinic/accounting/reports',
        icon: <BarChart3 size={I} />,
        perm: 'accounting.report.read',
      },
      {
        key: 'einvoices',
        to: '/clinic/accounting/einvoices',
        icon: <Landmark size={I} />,
        perm: 'accounting.einvoice.manage',
      },
    ],
  },
  {
    key: 'hr',
    items: [
      {
        key: 'staff',
        to: '/clinic/hr/staff',
        icon: <Stethoscope size={I} />,
        perm: 'staff.member.read',
      },
      { key: 'shifts', to: '/clinic/hr/shifts', icon: <Clock size={I} />, perm: 'hr.shift.manage' },
      {
        key: 'attendance',
        to: '/clinic/hr/attendance',
        icon: <ListChecks size={I} />,
        perm: 'hr.attendance.read',
      },
      { key: 'leave', to: '/clinic/hr/leave', icon: <Plane size={I} />, perm: 'hr.leave.read' },
      {
        key: 'payroll',
        to: '/clinic/hr/payroll',
        icon: <Wallet size={I} />,
        perm: 'hr.payroll.run',
      },
      {
        key: 'myPayslips',
        to: '/clinic/hr/my-payslips',
        icon: <FileText size={I} />,
        perm: 'hr.payroll.read',
      },
    ],
  },
  {
    key: 'inventory',
    items: [
      {
        key: 'inventoryItems',
        to: '/clinic/inventory',
        icon: <Boxes size={I} />,
        perm: 'inventory.item.read',
      },
    ],
  },
  {
    key: 'reports',
    items: [
      {
        key: 'reportsOperational',
        to: '/clinic/reports',
        icon: <BarChart3 size={I} />,
        perm: 'reports.operational.read',
      },
    ],
  },
  {
    key: 'settings',
    items: [
      {
        key: 'settingsGeneral',
        to: '/clinic/settings',
        icon: <Settings size={I} />,
        perm: 'clinic.settings.read',
      },
    ],
  },
];

/** Clinic app shell: nav filtered by permission + top bar with search and quick actions (16 §3). */
export function ClinicLayout() {
  const { t } = useTranslation('nav');
  const { t: tc } = useTranslation();
  const session = useSessionData();
  const { can } = usePermission();
  const navigate = useNavigate();
  const logout = useLogout();
  const searchProvider = usePatientSearchProvider();
  useRealtime();
  const openQuickBook = useQuickBook((s) => s.open);

  const nav: NavGroup[] = useMemo(
    () =>
      CLINIC_NAV.map((g) => ({
        key: g.key,
        label: t(`groups.${g.key}`),
        items: g.items
          .filter((i) => can(i.perm))
          .map((i) => ({ key: i.key, to: i.to, icon: i.icon, label: t(i.key), end: i.end })),
      })),
    [t, can],
  );

  const quick = [
    can('scheduling.appointment.book') && {
      key: 'appt',
      label: tc('layout.newAppointment'),
      icon: <CalendarPlus size={18} />,
      onClick: () => openQuickBook({}),
    },
    can('patients.patient.create') && {
      key: 'patient',
      label: tc('layout.newPatient'),
      icon: <UserPlus size={18} />,
      onClick: () => navigate('/clinic/patients/new'),
    },
    can('billing.payment.create') && {
      key: 'payment',
      label: tc('layout.newPayment'),
      icon: <CreditCard size={18} />,
      onClick: () => navigate('/clinic/billing/payments?new=1'),
    },
  ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; onClick: () => void }[];

  const banner = (
    <>
      {session?.impersonation && (
        <Alert
          severity="warning"
          sx={{ borderRadius: 0 }}
          action={
            <Button color="inherit" size="small" onClick={() => void logout()}>
              {tc('layout.stopImpersonating')}
            </Button>
          }
        >
          {tc('layout.impersonating', { name: session.staff?.name ?? session.user.displayName })}
        </Alert>
      )}
      {session?.clinic?.readOnly && !session.impersonation && (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          {tc('layout.subscriptionReadOnly')}
        </Alert>
      )}
    </>
  );

  return (
    <>
      <AppShell
        nav={nav}
        brand={<Brand subtitle={session?.clinic?.name} />}
        banner={banner}
        topbar={
          <>
            <GlobalSearch provider={can('patients.patient.read') ? searchProvider : undefined} />
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ marginInlineStart: 'auto' }}
            >
              <QuickActions actions={quick} />
              <NotificationsMenu />
              <LanguageToggle />
              <ThemeToggle />
              <UserMenu
                name={session?.staff?.name ?? session?.user.displayName ?? ''}
                subtitle={session?.clinic?.name}
                onLogout={() => void logout()}
                onProfile={() => navigate('/clinic/me')}
                onPayslips={
                  can('hr.payroll.read') ? () => navigate('/clinic/hr/my-payslips') : undefined
                }
                onSwitchClinic={
                  session && session.clinics.length > 1
                    ? () => navigate('/select-clinic')
                    : undefined
                }
              />
            </Stack>
          </>
        }
      />
      {can('scheduling.appointment.book') && <QuickBookDrawer />}
      {can('scheduling.appointment.read') && <AppointmentDrawer />}
    </>
  );
}
