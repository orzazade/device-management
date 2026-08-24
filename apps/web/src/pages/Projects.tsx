import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../components/Modal';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { api } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { VForm, VField } from '../components/VForm';
import { minLen, required } from '../lib/validate';
import type { ProjectRow } from '../lib/types';

export default function Projects() {
  const qc = useQueryClient();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [editFor, setEditFor] = useState<ProjectRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProjectRow | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = useQuery({
    queryKey: ['projects', showDeleted],
    queryFn: () => api<ProjectRow[]>(showDeleted ? '/projects?deleted=true' : '/projects'),
  });

  const create = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api('/projects', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShow(false);
      setError(null);
      toast('Project created');
    },
    onError: (e) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      setConfirmDelete(null);
      setEditFor(null);
      toast('Project deleted — its devices lost the tag');
    },
    onError: (e) => {
      setConfirmDelete(null);
      setError(e.message);
    },
  });

  const restoreProject = useMutation({
    mutationFn: (id: string) => api(`/projects/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast('Project restored');
    },
    onError: (e) => setError(e.message),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; description: string }) =>
      api(`/projects/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setEditFor(null);
      setError(null);
      toast('Project saved');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Projects</h1>
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
          onClick={() => setShow(true)}
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110"
        >
          New project
        </button>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4">
        {projects.data?.map((p) => (
          <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="font-bold">{p.name}</div>
              {showDeleted ? (
                <button
                  onClick={() => restoreProject.mutate(p.id)}
                  disabled={restoreProject.isPending}
                  className="rounded-lg border border-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-600 hover:border-accent hover:text-accent disabled:opacity-50"
                >
                  Restore
                </button>
              ) : (
                <button
                  onClick={() => setEditFor(p)}
                  className="rounded-lg border border-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-600 hover:border-accent hover:text-accent"
                >
                  Edit
                </button>
              )}
            </div>
            <div className="mb-3 mt-1 text-neutral-500">{p.description || '—'}</div>
            <div className="text-neutral-500">
              {p.deviceCount == null ? '—' : `${p.deviceCount} devices attached`}
            </div>
          </div>
        ))}
      </div>
      {projects.data?.length === 0 && (
        <p className="text-neutral-400">No projects yet. Create the first one.</p>
      )}

      {editFor && (
        <Modal onClose={() => setEditFor(null)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) => {
              update.mutate({
                id: editFor.id,
                name: String(f.get('name')),
                description: String(f.get('description') || ''),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">Edit project</h2>
            <VField name="name" label="Name" className="mb-3" defaultValue={editFor.name}
              rules={[required('Project name is required'), minLen(2)]} />
            <VField name="description" label="Description" className="mb-4"
              defaultValue={editFor.description} />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(editFor)}
                className="rounded-lg border border-red-200 px-4 py-2 font-semibold text-red-700 hover:bg-red-50"
              >
                Delete…
              </button>
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

      {confirmDelete && (
        <ConfirmModal
          title={`Delete project "${confirmDelete.name}"?`}
          body={`Its attached devices keep living — they just lose the project tag (and get it back on restore). Restorable from "Show deleted".`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(confirmDelete.id)}
          onClose={() => setConfirmDelete(null)}
        />
      )}

      {show && (
        <Modal onClose={() => setShow(false)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) => {
              create.mutate({
                name: String(f.get('name')),
                description: String(f.get('description') || ''),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">New project</h2>
            <VField name="name" label="Name" className="mb-3" autoFocus placeholder="MyApp Mobile"
              rules={[required('Project name is required'), minLen(2)]} />
            <VField name="description" label="Description" className="mb-4"
              placeholder="What this project tests" />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShow(false)}
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
