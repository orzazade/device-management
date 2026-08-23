import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { api } from '../lib/api';
import type { ProjectRow } from '../lib/types';

export default function Projects() {
  const qc = useQueryClient();
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [editFor, setEditFor] = useState<ProjectRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectRow[]>('/projects') });

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
              <button
                onClick={() => setEditFor(p)}
                className="rounded-lg border border-neutral-200 px-2.5 py-0.5 text-xs font-semibold text-neutral-600 hover:border-accent hover:text-accent"
              >
                Edit
              </button>
            </div>
            <div className="mb-3 mt-1 text-neutral-500">{p.description || '—'}</div>
            <div className="text-neutral-500">{p.deviceCount} devices attached</div>
          </div>
        ))}
      </div>
      {projects.data?.length === 0 && (
        <p className="text-neutral-400">No projects yet. Create the first one.</p>
      )}

      {editFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
          onClick={(e) => e.target === e.currentTarget && setEditFor(null)}
        >
          <form
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              update.mutate({
                id: editFor.id,
                name: String(f.get('name')),
                description: String(f.get('description') || ''),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">Edit project</h2>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">Name</span>
              <input
                name="name"
                required
                minLength={2}
                defaultValue={editFor.name}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">Description</span>
              <input
                name="description"
                defaultValue={editFor.description}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              />
            </label>
            <div className="flex justify-end gap-2">
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
          </form>
        </div>
      )}

      {show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
          onClick={(e) => e.target === e.currentTarget && setShow(false)}
        >
          <form
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              create.mutate({
                name: String(f.get('name')),
                description: String(f.get('description') || ''),
              });
            }}
          >
            <h2 className="mb-4 text-lg font-bold">New project</h2>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">Name</span>
              <input name="name" required minLength={2} className="w-full rounded-lg border border-neutral-300 px-3 py-2" />
            </label>
            <label className="mb-4 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">Description</span>
              <input name="description" className="w-full rounded-lg border border-neutral-300 px-3 py-2" />
            </label>
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
          </form>
        </div>
      )}
    </div>
  );
}
