import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toasts';
import { AuthProvider, SessionExpiryRedirect, useAuth } from './lib/auth';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';
import Requests from './pages/Requests';
import DeviceDetail from './pages/DeviceDetail';
import Devices from './pages/Devices';
import Login from './pages/Login';
import Projects from './pages/Projects';
import Repairs from './pages/Repairs';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Roles from './pages/Roles';
import Users from './pages/Users';

function NotFound() {
  return (
    <div className="py-16 text-center">
      <p className="text-5xl">🤷</p>
      <h1 className="mt-3 text-xl font-bold">This page doesn’t exist</h1>
      <p className="mt-1 text-neutral-500">
        The link may be old.{' '}
        <Link to="/" className="font-semibold text-accent">
          Back to the dashboard
        </Link>
      </p>
    </div>
  );
}

/** Blocks a route by permission. The API refuses anyway (403) — this keeps
 * someone from landing on a page that would only show them an error. */
function RequirePermission({ need }: { need: string }) {
  const { user } = useAuth();
  if (user && !user.permissions?.includes(need)) return <Navigate to="/" replace />;
  return <Outlet />;
}

const qc = queryClient;

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <SessionExpiryRedirect />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/devices/:id" element={<DeviceDetail />} />
              <Route path="/requests" element={<Requests />} />
              {/* Old bookmarks from before the lifecycle pages were merged. */}
              <Route path="/handovers" element={<Navigate to="/requests" replace />} />
              <Route path="/approvals" element={<Navigate to="/requests" replace />} />
              <Route path="/loans" element={<Navigate to="/requests" replace />} />
              <Route path="/repairs" element={<Repairs />} />
              <Route element={<RequirePermission need="reports.idle.view" />}>
                <Route path="/reports" element={<Reports />} />
              </Route>
              {/* The screen manages groups; reading the list is a different,
                  much wider permission that feeds the request dialog. */}
              <Route element={<RequirePermission need="projects.create" />}>
                <Route path="/projects" element={<Projects />} />
              </Route>
              <Route element={<RequirePermission need="users.view" />}>
                <Route path="/users" element={<Users />} />
              </Route>
              <Route element={<RequirePermission need="roles.view" />}>
                <Route path="/roles" element={<Roles />} />
              </Route>
              <Route element={<RequirePermission need="settings.view" />}>
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route element={<RequirePermission need="audit.view" />}>
                <Route path="/audit" element={<Audit />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
