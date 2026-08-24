import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../components/Modal';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { api } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { VForm, VField } from '../components/VForm';
import { email, minLen, password, required } from '../lib/validate';
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
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editFor, setEditFor] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [roleChange, setRoleChange] = useState<{ user: UserRow; role: Role } | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', showDeleted],
    queryFn: () => api<UserRow[]>(showDeleted ? '/users?deleted=true' : '/users'),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      api(`/users/${id}/role`, { method: 'PATCH', body: { role } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('Role updated');
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setConfirmDelete(null);
      setEditFor(null);
      setError(null);
      toast('User deleted — restorable from "Show deleted"');
    },
    onError: (e) => {
      setConfirmDelete(null);
      setError(e.message);
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => api(`/users/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('User restored');
    },
    onError: (e) => setError(e.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api(`/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditFor(null);
      setError(null);
      toast('User saved');
    },
    onError: (e) => setError(e.message),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; email: string; role: Role; password: string }) =>
      api('/users', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setError(null);
      toast('User created');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Users</h1>
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-neutral-500">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          Show deleted
        </label>
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
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
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
                      disabled={changeRole.isPending}
                      onChange={(e) =>
                        setRoleChange({ user: u, role: e.target.value as Role })
                      }
                      className="rounded-lg border border-neutral-300 px-2 py-1 disabled:opacity-50"
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
                <td className="px-4 py-2.5">
                  {u.active ? (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-600">
                      Deactivated
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {showDeleted ? (
                    me?.role === 'admin' && (
                      <button
                        onClick={() => restore.mutate(u.id)}
                        disabled={restore.isPending}
                        className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        Restore
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => setEditFor(u)}
                      className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <p className="p-6 text-neutral-400">loading…</p>}
      </div>

      {editFor && (
        <Modal onClose={() => setEditFor(null)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) => {
              update.mutate({
                id: editFor.id,
                name: String(f.get('name')),
                email: String(f.get('email')),
                ...(me?.role === 'admin' && editFor.id !== me.id
                  ? { active: f.get('active') === 'on' }
                  : {}),
                ...(me?.role === 'admin' && f.get('newPassword')
                  ? { newPassword: String(f.get('newPassword')) }
                  : {}),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">Edit {editFor.name}</h2>
            <VField
              name="name"
              label="Name"
              className="mb-3"
              defaultValue={editFor.name}
              rules={[required('Name is required'), minLen(2)]}
            />
            <VField
              name="email"
              label="Email"
              type="email"
              className="mb-3"
              defaultValue={editFor.email}
              rules={[required('Email is required'), email()]}
            />
            {me?.role === 'admin' && (
              <>
                <VField
                  name="newPassword"
                  label="New password (leave empty to keep current)"
                  type="password"
                  className="mb-3"
                  rules={[password()]}
                />
                {editFor.id !== me.id && (
                  <label className="mb-3 flex items-center gap-2.5">
                    <input type="checkbox" name="active" defaultChecked={editFor.active} />
                    <span>
                      <b>Active</b> — unchecked users cannot sign in
                    </span>
                  </label>
                )}
              </>
            )}
            <div className="mt-4 flex items-center gap-2">
              {me?.role === 'admin' && editFor.id !== me.id && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(editFor)}
                  className="rounded-lg border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50"
                >
                  Delete…
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setEditFor(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={update.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </VForm>
        </Modal>
      )}

      {roleChange && (
        <ConfirmModal
          title={`Make ${roleChange.user.name} a ${roleLabel[roleChange.role]}?`}
          body={`${roleChange.user.name} goes from ${roleLabel[roleChange.user.role]} to ${roleLabel[roleChange.role]} immediately — their access changes on their next click.`}
          confirmLabel="Change role"
          busy={changeRole.isPending}
          onConfirm={() => {
            changeRole.mutate({ id: roleChange.user.id, role: roleChange.role });
            setRoleChange(null);
          }}
          onClose={() => setRoleChange(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body="They disappear from lists and cannot sign in. History stays, and an Admin can restore them anytime."
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) => {
              create.mutate({
                name: String(f.get('name')),
                email: String(f.get('email')),
                role: String(f.get('role')) as Role,
                password: String(f.get('password')),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">Add user</h2>
            <VField name="name" label="Name" className="mb-3" autoFocus
              rules={[required('Name is required'), minLen(2)]} placeholder="Aysel Aliyeva" />
            <VField name="email" label="Email" type="email" className="mb-3"
              rules={[required('Email is required'), email()]} placeholder="name@company.com" />
            <VField name="password" label="Password" type="password" className="mb-3"
              rules={[required('Password is required'), password()]} />
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
          </VForm>
        </Modal>
      )}
    </div>
  );
}
