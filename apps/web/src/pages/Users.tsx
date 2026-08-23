import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth, type Role } from '../lib/auth';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

const ROLES: Role[] = ['admin', 'manager', 'tester'];
const roleLabel: Record<Role, string> = { admin: 'Admin', manager: 'Manager', tester: 'Tester' };

export default function Users() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/users') });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (e) => setError(e.message),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; email: string; role: Role; password: string }) =>
      api('/users', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Users</h1>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110"
        >
          Add user
        </button>
      </div>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Email</th>
              <th className="px-4 py-2.5">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5 font-semibold">{u.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-2.5">
                  {me?.role === 'admin' && u.id !== me.id ? (
                    <select
                      value={u.role}
                      onChange={(e) =>
                        changeRole.mutate({ id: u.id, role: e.target.value as Role })
                      }
                      className="rounded-lg border border-neutral-300 px-2 py-1"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel[r]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    roleLabel[u.role]
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <p className="p-6 text-neutral-400">loading…</p>}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
          onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}
        >
          <form
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              create.mutate({
                name: String(f.get('name')),
                email: String(f.get('email')),
                role: String(f.get('role')) as Role,
                password: String(f.get('password')),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">Add user</h2>
            {(['name', 'email', 'password'] as const).map((field) => (
              <label key={field} className="mb-3 block">
                <span className="mb-1 block text-xs font-semibold text-neutral-500 capitalize">
                  {field}
                </span>
                <input
                  name={field}
                  required
                  minLength={field === 'password' ? 8 : 2}
                  type={field === 'name' ? 'text' : field}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                />
              </label>
            ))}
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">Role</span>
              <select name="role" defaultValue="tester" className="w-full rounded-lg border border-neutral-300 px-3 py-2">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={create.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
