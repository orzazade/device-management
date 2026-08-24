import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import RequestTable from '../components/RequestTable';
import { api } from '../lib/api';
import type { RequestRow } from '../lib/requests';

export default function Handovers() {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const rows = useQuery({
    queryKey: ['requests', 'pending-handover'],
    queryFn: () => api<RequestRow[]>('/requests/pending-handover'),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/handover`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      setError(null);
      toast('Handover confirmed — device assigned');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Handovers</h1>
        <span className="text-neutral-500">
          Physically hand the device over, then confirm here.
        </span>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <RequestTable
        rows={rows.data}
        error={rows.isError}
        onRetry={() => rows.refetch()}
        empty="No handovers waiting for you."
        actions={(r) => (
          <button
            onClick={() => confirm.mutate(r.id)}
            disabled={confirm.isPending}
            className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            Confirm handover
          </button>
        )}
      />
      <p className="mt-3 text-neutral-500">
        The assignment only changes after the current holder (or the lab desk) confirms — the
        system never pretends a phone moved when it didn’t.
      </p>
    </div>
  );
}
