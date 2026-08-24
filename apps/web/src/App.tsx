import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { ToastProvider, toastFromAnywhere } from './components/Toasts';
import { AuthProvider, useAuth, type Role } from './lib/auth';
import Approvals from './pages/Approvals';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';
import Handovers from './pages/Handovers';
import Loans from './pages/Loans';
import Requests from './pages/Requests';
import DeviceDetail from './pages/DeviceDetail';
import Devices from './pages/Devices';
import Login from './pages/Login';
import Projects from './pages/Projects';
import Repairs from './pages/Repairs';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Users from './pages/Users';

/** Blocks a route group by role. The API refuses anyway (403) — this keeps
 * testers from ever landing on staff pages via a typed URL. */
function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (user && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <Outlet />;
}

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  // A failed fetch must be loud everywhere — never a silently empty screen.
  queryCache: new QueryCache({
    onError: (err) =>
      toastFromAnywhere(
        err instanceof Error && err.message ? `Loading failed: ${err.message}` : 'Loading failed',
      ),
  }),
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/devices/:id" element={<DeviceDetail />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/handovers" element={<Handovers />} />
              <Route path="/repairs" element={<Repairs />} />
              <Route element={<RequireRole roles={['admin', 'manager']} />}>
                <Route path="/loans" element={<Loans />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/users" element={<Users />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
              <Route element={<RequireRole roles={['admin']} />}>
                <Route path="/audit" element={<Audit />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
