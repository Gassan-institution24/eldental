import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
import {
  AcceptInvitationPage,
  ChangePasswordPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from '@/features/auth/pages/PasswordPages';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { SelectClinicPage } from '@/features/auth/pages/SelectClinicPage';
import { AdminLayout } from '@/layouts/AdminLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { ClinicLayout } from '@/layouts/ClinicLayout';
import { PortalLayout } from '@/layouts/PortalLayout';
import { PublicLayout } from '@/layouts/PublicLayout';
import { HomePage } from '@/features/site/pages/HomePage';
import {
  AboutPage,
  FeaturesPage,
  LegalPage,
  PricingPage,
  SecurityPage,
} from '@/features/site/pages/InfoPages';
import { ContactPage } from '@/features/site/pages/ContactPage';
import { PatientsPage } from '@/features/site/pages/PatientsPage';
import { PatientAuthLayout } from '@/layouts/PatientAuthLayout';
import { PatientLoginPage, PatientRegisterPage } from '@/features/portal/pages/PatientAuthPages';
import { NotFoundPage } from '@/shared/components/PlaceholderPage';
import { AuthGuard, GuestGuard, HomeRedirect } from './guards';
import { RouteTracker } from './RouteTracker';
import { clinicRoutes } from './routes/clinicRoutes';
import { adminRoutes } from './routes/adminRoutes';
import { portalRoutes, publicRoutes } from './routes/portalRoutes';

function Root() {
  return (
    <>
      <RouteTracker />
      <Outlet />
    </>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/features', element: <FeaturesPage /> },
          { path: '/pricing', element: <PricingPage /> },
          { path: '/about', element: <AboutPage /> },
          { path: '/security', element: <SecurityPage /> },
          { path: '/contact', element: <ContactPage /> },
          { path: '/patients', element: <PatientsPage /> },
          { path: '/privacy', element: <LegalPage kind="privacy" /> },
          { path: '/terms', element: <LegalPage kind="terms" /> },
        ],
      },
      { path: '/app', element: <HomeRedirect /> },
      {
        element: (
          <GuestGuard>
            <AuthLayout />
          </GuestGuard>
        ),
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
          { path: '/invite/:token', element: <AcceptInvitationPage /> },
        ],
      },
      {
        element: (
          <AuthGuard>
            <AuthLayout />
          </AuthGuard>
        ),
        children: [
          { path: '/select-clinic', element: <SelectClinicPage /> },
          { path: '/change-password', element: <ChangePasswordPage /> },
        ],
      },
      {
        path: '/clinic',
        element: (
          <AuthGuard kind="staff" needsClinic>
            <ClinicLayout />
          </AuthGuard>
        ),
        children: clinicRoutes,
      },
      {
        path: '/admin',
        element: (
          <AuthGuard kind="platform">
            <AdminLayout />
          </AuthGuard>
        ),
        children: adminRoutes,
      },
      ...publicRoutes,
      {
        element: (
          <GuestGuard>
            <PatientAuthLayout />
          </GuestGuard>
        ),
        children: [
          { path: '/portal/login', element: <PatientLoginPage /> },
          { path: '/portal/register', element: <PatientRegisterPage /> },
        ],
      },
      {
        path: '/portal',
        element: (
          <AuthGuard kind="patient">
            <PortalLayout />
          </AuthGuard>
        ),
        children: portalRoutes,
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
