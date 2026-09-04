import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../components/Modal';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { api } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { VForm, VField } from '../components/VForm';
import { email, minLen, password, required } from '../lib/validate';
import { useAuth, useCan } from '../lib/auth';

/** What a new account gets when nobody chooses otherwise. */
const BASELINE_ROLE = 'Lab Tester';

interface UserRow {
  id: string;
  name: string;
  email: string;
  /** The roles this account holds, by name. */
  roles?: string[];
  active: boolean;
  holds?: number;
  createdAt: string;
}

export default function Users() {
  const { user: me } = useAuth();
  const can = useCan();
  const qc = useQueryClient();
  const toast = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editFor, setEditFor] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [rolesFor, setRolesFor] = useState<UserRow | null>(null);
  const [pickedRoles, setPickedRoles] = useState<Set<string>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users', showDeleted],
    queryFn: () => api<UserRow[]>(showDeleted ? '/users?deleted=true' : '/users'),
  });

  const roleList = useQuery({
    queryKey: ['roles'],
    queryFn: () => api<{ id: string; name: string; description: string }[]>('/roles'),
    enabled: can('users.roles.assign'),
  });

  const assignRoles = useMutation({
    mutationFn: ({ id, roleIds }: { id: string; roleIds: string[] }) =>
      api(`/users/${id}/roles`, { method: 'PUT', body: { roleIds } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      setRolesFor(null);
      setError(null);
      toast('Roles updated');
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
    mutationFn: (body: {
      name: string;
      email: string;
      password: string;
      roleIds?: string[];
    }) => api('/users', { method: 'POST', body }),
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
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email…"
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
        />
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
              <th className="px-4 py-2.5">Holds</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {users.data
              ?.filter(
                (u) =>
                  !q ||
                  u.name.toLowerCase().includes(q.toLowerCase()) ||
                  u.email.toLowerCase().includes(q.toLowerCase()),
              )
              .map((u) => (
              <tr key={u.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5 font-semibold">{u.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {(u.roles?.length ? u.roles : ['No role']).map((name: string) => (
                      <span
                        key={name}
                        data-testid="user-role-chip"
                        className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent"
                      >
                        {name}
                      </span>
                    ))}
                    {can('users.roles.assign') && u.id !== me?.id && (
                      <button
                        data-testid="user-edit-roles"
                        onClick={() => {
                          setError(null);
                          setPickedRoles(
                            new Set(
                              (roleList.data ?? [])
                                .filter((r) => (u.roles ?? []).includes(r.name))
                                .map((r) => r.id),
                            ),
                          );
                          setRolesFor(u);
                        }}
                        className="rounded-lg border border-neutral-300 px-2 py-0.5 text-xs font-semibold"
                      >
                        Change
                      </button>
                    )}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">{u.holds ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {showDeleted ? (
                    <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
                      Deleted
                    </span>
                  ) : u.active ? (
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
                    can('users.restore') && (
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
                ...(can('users.update') && editFor.id !== me?.id
                  ? { active: f.get('active') === 'on' }
                  : {}),
                ...(can('users.update') && f.get('newPassword')
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
            {can('users.update') && (
              <>
                <VField
                  name="newPassword"
                  label="New password (leave empty to keep current)"
                  type="password"
                  className="mb-3"
                  rules={[password()]}
                />
                {editFor.id !== me?.id && (
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
              {can('users.delete') && editFor.id !== me?.id && (
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

      {rolesFor && (
        <Modal onClose={() => setRolesFor(null)}>
          <div className="w-full max-w-md self-center rounded-2xl bg-white p-6">
            <h2 className="mb-1 text-lg font-bold">Roles for {rolesFor.name}</h2>
            <p className="mb-4 text-neutral-500">
              Their access changes on their next click — they do not need to sign
              in again.
            </p>
            <div className="mb-5 flex flex-col gap-2">
              {roleList.data?.map((r) => (
                <label key={r.id} className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    data-testid={`assign-${r.name}`}
                    checked={pickedRoles.has(r.id)}
                    onChange={() => {
                      const next = new Set(pickedRoles);
                      next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                      setPickedRoles(next);
                    }}
                    className="mt-0.5 h-4 w-4 flex-none"
                  />
                  <span>
                    <b>{r.name}</b>
                    <span className="block text-sm text-neutral-500">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRolesFor(null)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 font-semibold"
              >
                Cancel
              </button>
              <button
                data-testid="assign-save"
                onClick={() =>
                  assignRoles.mutate({ id: rolesFor.id, roleIds: [...pickedRoles] })
                }
                disabled={assignRoles.isPending}
                className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-white disabled:opacity-50"
              >
                Save roles
              </button>
            </div>
          </div>
        </Modal>
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
              const picked = String(f.get('roleId') ?? '');
              create.mutate({
                name: String(f.get('name')),
                email: String(f.get('email')),
                password: String(f.get('password')),
                // Left empty the server grants the baseline role, which is
                // what somebody without permission to assign roles gets.
                ...(picked ? { roleIds: [picked] } : {}),
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
            {can('users.roles.assign') ? (
              <label className="mb-4 block">
                <span className="mb-1 block text-xs font-semibold text-neutral-500">Role</span>
                <select
                  name="roleId"
                  data-testid="create-role"
                  defaultValue=""
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2"
                >
                  {/* The empty value is the baseline role, named rather than
                      blank so the default does not look like a missing choice. */}
                  <option value="">{BASELINE_ROLE}</option>
                  {(roleList.data ?? [])
                    .filter((r) => r.name !== BASELINE_ROLE)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <p className="mb-4 text-sm text-neutral-500">
                They start as {BASELINE_ROLE}. Changing that needs permission to
                assign roles.
              </p>
            )}
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
