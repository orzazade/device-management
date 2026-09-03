import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastProvider } from './components/Toasts';
import { AuthProvider, SessionExpiryRedirect, useAuth, type Role } from './lib/auth';
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

/** Blocks a route group by role. The API refuses anyway (403) — this keeps
 * testers from ever landing on staff pages via a typed URL. */
function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) return <Navigate to="/" replace />;
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
              <Route element={<RequireRole roles={['admin']} />}>
                <Route path="/reports" element={<Reports />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route element={<RequireRole roles={['admin']} />}>
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
