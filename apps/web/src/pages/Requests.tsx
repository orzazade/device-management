import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import RequestTable from '../components/RequestTable';
import ReturnModal from '../components/ReturnModal';
import { api } from '../lib/api';
import type { RequestRow } from '../lib/requests';

export default function Requests() {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [returnFor, setReturnFor] = useState<RequestRow | null>(null);
  const rows = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => api<RequestRow[]>('/requests'),
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
            <button
              onClick={() => setReturnFor(r)}
              className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white"
            >
              Return
            </button>
          ) : null
        }
      />
      {returnFor && <ReturnModal request={returnFor} onClose={() => setReturnFor(null)} />}
    </div>
  );
}
