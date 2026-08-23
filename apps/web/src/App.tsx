import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider } from './lib/auth';
import Approvals from './pages/Approvals';
import Audit from './pages/Audit';
import Dashboard from './pages/Dashboard';
import Handovers from './pages/Handovers';
import Requests from './pages/Requests';
import DeviceDetail from './pages/DeviceDetail';
import Devices from './pages/Devices';
import Import from './pages/Import';
import Login from './pages/Login';
import Projects from './pages/Projects';
import Settings from './pages/Settings';
import Users from './pages/Users';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/devices/:id" element={<DeviceDetail />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/handovers" element={<Handovers />} />
              <Route path="/import" element={<Import />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/users" element={<Users />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/audit" element={<Audit />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
