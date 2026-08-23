import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import type { RequestRow } from '../lib/requests';
import { useClickOutside } from '../lib/useClickOutside';
import Bell from './Bell';

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

function Badge({ n }: { n: number | undefined }) {
  if (!n) return null;
  return (
    <span className="ml-auto rounded-full bg-accent px-2 text-[11px] font-semibold leading-[18px] text-white">
      {n}
    </span>
  );
}

const roleLabel: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  tester: 'Tester',
};

export default function Layout() {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();
  const staff = isStaff(user?.role);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userMenuRef = useClickOutside<HTMLDivElement>(userOpen, () => setUserOpen(false));
  const [search, setSearch] = useState('');
  const handovers = useQuery({
    queryKey: ['requests', 'pending-handover'],
    queryFn: () => api<RequestRow[]>('/requests/pending-handover'),
    enabled: !!user,
    refetchInterval: 30000,
  });
  const approvals = useQuery({
    queryKey: ['requests', 'pending-approvals'],
    queryFn: () => api<RequestRow[]>('/requests?scope=all&state=pending'),
    enabled: !!user && staff,
    refetchInterval: 30000,
  });
  if (loading) return <p className="p-10 text-neutral-400">loading…</p>;
  if (!user) return <Navigate to="/login" replace />;

  const initials = user.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2);

  const sidebar = (
    <aside
      className={`flex h-screen w-54 shrink-0 flex-col border-r border-neutral-200 bg-white md:sticky md:top-0 ${
        menuOpen ? 'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50' : 'max-md:hidden'
      }`}
    >
      <div className="border-b border-neutral-200 px-4 py-4">
        <b className="text-base">DeviceDesk</b>
        <small className="block text-[10.5px] uppercase tracking-wider text-neutral-500">
          QA Device Lab
        </small>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" onClick={() => setMenuOpen(false)}>
        <Section label="Lab" />
        <NavLink to="/" end className={linkCls}>Dashboard</NavLink>
        <NavLink to="/devices" className={linkCls}>Devices</NavLink>
        <NavLink to="/requests" className={linkCls}>My requests</NavLink>
        <NavLink to="/handovers" className={linkCls}>
          Handovers
          <Badge n={handovers.data?.length} />
        </NavLink>
        <NavLink to="/repairs" className={linkCls}>Repairs</NavLink>
        {staff && (
          <>
            <Section label="Manage" />
            <NavLink to="/approvals" className={linkCls}>
              Approvals
              <Badge n={approvals.data?.length} />
            </NavLink>
            <NavLink to="/projects" className={linkCls}>Projects</NavLink>
            <NavLink to="/users" className={linkCls}>Users</NavLink>
            <NavLink to="/reports" className={linkCls}>Idle devices</NavLink>
            <NavLink to="/settings" className={linkCls}>Settings</NavLink>
          </>
        )}
        {user.role === 'admin' && (
          <NavLink to="/audit" className={linkCls}>Audit log</NavLink>
        )}
      </nav>
    </aside>
  );

  return (
    <div className="flex min-h-screen">
      {sidebar}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-2.5 md:px-6">
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="rounded-lg border border-neutral-200 px-2.5 py-1.5 md:hidden"
          >
            ☰
          </button>
          <form
            className="max-w-md flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              nav(`/devices?q=${encodeURIComponent(search)}`);
            }}
          >
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices — brand, model, OS, serial, holder…"
              className="w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-2 focus:border-accent focus:bg-white focus:outline-none"
            />
          </form>
          <div className="flex-1" />
          <Bell />
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserOpen(!userOpen)}
              className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white py-1.5 pl-1.5 pr-3 shadow-sm hover:bg-neutral-50"
            >
              <span className="flex h-6.5 w-6.5 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">
                {initials}
              </span>
              <span className="max-sm:hidden">
                <span className="block text-left text-[13px] font-semibold leading-4">
                  {user.name}
                </span>
                <span className="block text-left text-[11px] leading-3 text-neutral-500">
                  {roleLabel[user.role] ?? user.role}
                </span>
              </span>
            </button>
            {userOpen && (
              <div className="absolute right-0 top-11 z-30 w-52 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
                <div className="border-b border-neutral-100 px-4 py-3">
                  <b>{user.name}</b>
                  <div className="text-xs text-neutral-500">{user.email}</div>
                  <div className="mt-1 inline-block rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                    {roleLabel[user.role] ?? user.role}
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="w-full px-4 py-2.5 text-left font-semibold text-red-700 hover:bg-neutral-50"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-5xl p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
