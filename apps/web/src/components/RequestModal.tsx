import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import type { DeviceRow } from '../lib/types';

interface UserRow {
  id: string;
  name: string;
  role: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export default function RequestModal({
  device,
  onClose,
}: {
  device: DeviceRow;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<UserRow[]>('/users'),
    enabled: isStaff(user?.role),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/requests', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      onClose();
      nav('/requests');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="w-full max-w-lg rounded-2xl bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          create.mutate({
            deviceId: device.id,
            reason: String(f.get('reason')),
            fromDate: String(f.get('fromDate')),
            toDate: String(f.get('toDate')),
            onBehalfOfId: f.get('onBehalfOfId') || undefined,
          });
        }}
      >
        <h2 className="mb-3 text-lg font-bold">
          Request {device.brand} {device.model}
        </h2>
        {device.holder && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
            Held by <b>{device.holder.name}</b> now. If approved, they’ll be asked to hand it
            over.
          </div>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-semibold text-neutral-500">
            Reason (required)
          </span>
          <textarea
            name="reason"
            required
            minLength={5}
            rows={3}
            placeholder="What will you test and why this device?"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </label>
        <div className="mb-3 flex gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-semibold text-neutral-500">From</span>
            <input
              type="date"
              name="fromDate"
              required
              defaultValue={today()}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="block flex-1">
            <span className="mb-1 block text-xs font-semibold text-neutral-500">To</span>
            <input
              type="date"
              name="toDate"
              required
              defaultValue={plusDays(3)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
        </div>
        {isStaff(user?.role) && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-semibold text-neutral-500">
              On behalf of
            </span>
            <select
              name="onBehalfOfId"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            >
              <option value="">Myself</option>
              {users.data
                ?.filter((u) => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={create.isPending}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Submit request
          </button>
        </div>
      </form>
    </div>
  );
}
