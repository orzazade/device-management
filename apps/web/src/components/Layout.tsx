import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { isStaff, useAuth } from '../lib/auth';

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-neutral-100 ${
    isActive ? 'bg-accent-soft text-accent font-semibold' : 'text-neutral-900'
  }`;

function Section({ label }: { label: string }) {
  return (
    <div className="mt-3 mb-1 px-3 text-[10.5px] uppercase tracking-wider text-neutral-500">
      {label}
    </div>
  );
}

export default function Layout() {
  const { user, loading, logout } = useAuth();
  if (loading) return <p className="p-10 text-neutral-400">loading…</p>;
  if (!user) return <Navigate to="/login" replace />;

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-54 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-4">
          <b className="text-base">DeviceDesk</b>
          <small className="block text-[10.5px] uppercase tracking-wider text-neutral-500">
            QA Device Lab
          </small>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <Section label="Lab" />
          <NavLink to="/" end className={linkCls}>Dashboard</NavLink>
          {isStaff(user.role) && (
            <>
              <Section label="Manage" />
              <NavLink to="/users" className={linkCls}>Users</NavLink>
            </>
          )}
          {user.role === 'admin' && (
            <NavLink to="/audit" className={linkCls}>Audit log</NavLink>
          )}
        </nav>
        <div className="border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500">
          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-neutral-100 font-bold">
            {initials}
          </span>
          {user.name}
          <div className="mt-1 flex items-center justify-between">
            <span className="capitalize">{user.role}</span>
            <button onClick={logout} className="text-accent hover:underline">
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
