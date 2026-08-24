import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import RequestTable from '../components/RequestTable';
import Modal from '../components/Modal';
import ReturnModal from '../components/ReturnModal';
import { api } from '../lib/api';
import type { RequestRow } from '../lib/requests';

export default function Requests() {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [returnFor, setReturnFor] = useState<RequestRow | null>(null);
  const [extendFor, setExtendFor] = useState<RequestRow | null>(null);
  const rows = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => api<RequestRow[]>('/requests'),
  });

  const extend = useMutation({
    mutationFn: ({ id, fromDate, toDate }: { id: string; fromDate: string; toDate: string }) =>
      api(`/requests/${id}/time`, { method: 'PATCH', body: { fromDate, toDate } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      setExtendFor(null);
      setError(null);
      toast('Loan extended');
    },
    onError: (e) => setError(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      toast('Request cancelled');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">My requests</h1>
        <div className="flex-1" />
        <Link
          to="/devices"
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110"
        >
          Find a device
        </Link>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <RequestTable
        rows={rows.data}
        error={rows.isError}
        onRetry={() => rows.refetch()}
        empty="No requests yet. Find a device and ask for it."
        actions={(r) =>
          r.state === 'pending' || r.state === 'approved' ? (
            <button
              onClick={() => cancel.mutate(r.id)}
              disabled={cancel.isPending}
              className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold disabled:opacity-50"
            >
              {r.state === 'approved' ? 'Cancel booking' : 'Cancel'}
            </button>
          ) : r.state === 'active' || r.state === 'overdue' ? (
            <span className="flex gap-1.5">
              <button
                onClick={() => setExtendFor(r)}
                className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold"
              >
                Extend
              </button>
              <button
                onClick={() => setReturnFor(r)}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white"
              >
                Return
              </button>
            </span>
          ) : null
        }
      />
      {returnFor && <ReturnModal request={returnFor} onClose={() => setReturnFor(null)} />}
      {extendFor && (
        <Modal onClose={() => setExtendFor(null)}>
          <form
            className="w-full max-w-sm rounded-2xl bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const to = String(new FormData(e.currentTarget).get('toDate'));
              if (!to) return;
              extend.mutate({ id: extendFor.id, fromDate: extendFor.fromDate, toDate: to });
            }}
          >
            <h2 className="mb-1 text-lg font-bold">
              Extend {extendFor.device.brand} {extendFor.device.model}
            </h2>
            <p className="mb-3 text-neutral-500">
              Currently due back {extendFor.toDate}. If someone else booked the days you pick,
              the extension is refused with the reason.
            </p>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">
                Keep it until
              </span>
              <input
                type="date"
                name="toDate"
                required
                min={new Date().toISOString().slice(0, 10)}
                defaultValue={extendFor.toDate}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              />
            </label>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExtendFor(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={extend.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {extend.isPending ? 'Extending…' : 'Extend loan'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
