import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
import { AcceptInvitationPage, ChangePasswordPage, ForgotPasswordPage, ResetPasswordPage } from '@/features/auth/pages/PasswordPages';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { SelectClinicPage } from '@/features/auth/pages/SelectClinicPage';
import { AdminLayout } from '@/layouts/AdminLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { ClinicLayout } from '@/layouts/ClinicLayout';
import { PortalLayout } from '@/layouts/PortalLayout';
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
      { path: '/', element: <HomeRedirect /> },
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
