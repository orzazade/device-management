import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import ConfirmModal from '../components/ConfirmModal';
import Modal from '../components/Modal';
import PermissionTree, { type Catalogue } from '../components/PermissionTree';
import { useToast } from '../components/Toasts';
import { VField, VForm } from '../components/VForm';
import { api } from '../lib/api';
import { minLen, required } from '../lib/validate';

interface RoleRow {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
  holders: number;
}

const btn = 'rounded-lg px-3 py-1.5 text-sm font-semibold disabled:opacity-50';

export default function Roles() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editFor, setEditFor] = useState<RoleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleRow | null>(null);
  const [renameFor, setRenameFor] = useState<RoleRow | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/roles') });
  const catalogue = useQuery({
    queryKey: ['permissions'],
    queryFn: () => api<Catalogue>('/permissions'),
  });

  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    setEditFor(null);
    setCreating(false);
    setConfirmDelete(null);
    setRenameFor(null);
    setError(null);
    setNote(null);
    toast(msg);
  };

  const create = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api<RoleRow>('/roles', { method: 'POST', body }),
    onSuccess: (role) => {
      // Straight into the permission editor: a role with no permissions is
      // not yet useful, and making people find it in the list to carry on
      // would be a needless second step.
      qc.invalidateQueries({ queryKey: ['roles'] });
      setCreating(false);
      setPicked(new Set());
      setEditFor(role);
      toast('Role created — now choose what it can do');
    },
    onError: (e) => setError(e.message),
  });

  const savePermissions = useMutation({
    mutationFn: ({ id, keys }: { id: string; keys: string[] }) =>
      api(`/roles/${id}/permissions`, { method: 'PUT', body: { keys } }),
    onSuccess: () => done('Permissions saved'),
    onError: (e) => setError(e.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; description: string }) =>
      api(`/roles/${id}`, { method: 'PATCH', body }),
    onSuccess: () => done('Role updated'),
    onError: (e) => setError(e.message),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}/duplicate`, { method: 'POST' }),
    onSuccess: () => done('Role duplicated'),
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => done('Role deleted'),
    onError: (e) => {
      setConfirmDelete(null);
      setError(e.message);
    },
  });

  const openEditor = (role: RoleRow) => {
    setPicked(new Set(role.permissions));
    setNote(null);
    setError(null);
    setEditFor(role);
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Roles</h1>
        <span className="text-neutral-500">{roles.data?.length ?? '…'}</span>
        <div className="flex-1" />
        <button
          data-testid="role-new"
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
          className={`${btn} bg-accent text-white`}
        >
          New role
        </button>
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left">
          <thead className="border-b border-neutral-200 text-sm text-neutral-500">
            <tr>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">Can do</th>
              <th className="px-4 py-2.5">People</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {roles.data?.map((r) => (
              <tr key={r.id} data-testid="role-row" className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <b>{r.name}</b>
                  {r.isSystem && (
                    <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                      Built in
                    </span>
                  )}
                  <div className="text-sm text-neutral-500">{r.description}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">
                  {r.permissions.length} of {countAll(catalogue.data)}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5">{r.holders}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right">
                  <button
                    data-testid="role-permissions"
                    onClick={() => openEditor(r)}
                    className={`${btn} mr-1.5 border border-neutral-300`}
                  >
                    Permissions
                  </button>
                  {!r.isSystem && (
                    <button
                      data-testid="role-rename"
                      onClick={() => {
                        setError(null);
                        setRenameFor(r);
                      }}
                      className={`${btn} mr-1.5 border border-neutral-300`}
                    >
                      Rename
                    </button>
                  )}
                  <button
                    data-testid="role-duplicate"
                    onClick={() => duplicate.mutate(r.id)}
                    disabled={duplicate.isPending}
                    className={`${btn} mr-1.5 border border-neutral-300`}
                  >
                    Duplicate
                  </button>
                  {!r.isSystem && (
                    <button
                      data-testid="role-delete"
                      onClick={() => setConfirmDelete(r)}
                      className={`${btn} border border-neutral-300 text-red-700`}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {roles.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-neutral-500">
                  No roles yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------- create */}
      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <div className="w-full max-w-md self-center rounded-2xl bg-white p-6">
            <h2 className="mb-1 text-lg font-bold">New role</h2>
            <p className="mb-4 text-neutral-500">
              Name it first, then choose what it can do.
            </p>
            <VForm
              onValidSubmit={(f: FormData) =>
                create.mutate({
                  name: String(f.get('name')),
                  description: String(f.get('description') ?? ''),
                })
              }
            >
              <VField
                name="name"
                label="Name"
                className="mb-3"
                autoFocus
                rules={[required('Give the role a name'), minLen(2)]}
              />
              <VField name="description" label="What is it for?" className="mb-4" />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className={`${btn} border border-neutral-300`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={create.isPending}
                  className={`${btn} bg-accent text-white`}
                >
                  Create
                </button>
              </div>
            </VForm>
          </div>
        </Modal>
      )}

      {/* -------------------------------------------------- permissions */}
      {editFor && catalogue.data && (
        <Modal onClose={() => setEditFor(null)}>
          <div className="w-full max-w-3xl self-start rounded-2xl bg-white p-6">
            <h2 className="mb-1 text-lg font-bold">{editFor.name}</h2>
            <p className="mb-4 text-neutral-500">
              {editFor.isSystem
                ? 'Built-in roles show what they grant; Super Admin always holds everything.'
                : 'Tick what this role can do. Some options need another one to work.'}
            </p>

            {note && (
              <p
                data-testid="permission-note"
                className="mb-3 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent"
              >
                {note}
              </p>
            )}
            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>
            )}

            <PermissionTree
              catalogue={catalogue.data}
              selected={picked}
              readOnly={editFor.name === 'Super Admin'}
              onChange={(next, why) => {
                setPicked(next);
                setNote(why);
              }}
            />

            <div className="mt-5 flex items-center justify-end gap-2">
              <span className="mr-auto text-sm text-neutral-500">
                {picked.size} selected
              </span>
              <button
                type="button"
                onClick={() => setEditFor(null)}
                className={`${btn} border border-neutral-300`}
              >
                Cancel
              </button>
              <button
                data-testid="role-save-permissions"
                onClick={() =>
                  savePermissions.mutate({ id: editFor.id, keys: [...picked] })
                }
                disabled={savePermissions.isPending || editFor.name === 'Super Admin'}
                className={`${btn} bg-accent text-white`}
              >
                Save permissions
              </button>
            </div>
          </div>
        </Modal>
      )}

      {renameFor && (
        <Modal onClose={() => setRenameFor(null)}>
          <div className="w-full max-w-md self-center rounded-2xl bg-white p-6">
            <h2 className="mb-4 text-lg font-bold">Rename {renameFor.name}</h2>
            <VForm
              onValidSubmit={(f: FormData) =>
                rename.mutate({
                  id: renameFor.id,
                  name: String(f.get('name')),
                  description: String(f.get('description') ?? ''),
                })
              }
            >
              <VField
                name="name"
                label="Name"
                className="mb-3"
                autoFocus
                defaultValue={renameFor.name}
                rules={[required('Give the role a name'), minLen(2)]}
              />
              <VField
                name="description"
                label="What is it for?"
                className="mb-4"
                defaultValue={renameFor.description}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRenameFor(null)}
                  className={`${btn} border border-neutral-300`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rename.isPending}
                  className={`${btn} bg-accent text-white`}
                >
                  Save
                </button>
              </div>
            </VForm>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body={
            confirmDelete.holders > 0
              ? `${confirmDelete.holders} ${confirmDelete.holders === 1 ? 'person holds' : 'people hold'} this role. Take it off them first.`
              : 'Nobody holds this role, so nobody loses access.'
          }
          confirmLabel="Yes, delete this role"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function countAll(cat?: Catalogue): number {
  if (!cat) return 0;
  return cat.modules.reduce(
    (n, m) => n + m.features.reduce((k, f) => k + f.permissions.length, 0),
    0,
  );
}
