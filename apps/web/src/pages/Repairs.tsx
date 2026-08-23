import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import Chip from '../components/Chip';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';

interface RepairRow {
  id: string;
  device: { id: string; brand?: string; model?: string };
  reportedBy: { id: string; name: string } | null;
  issue: string;
  state: string;
  createdAt: string;
}

export default function Repairs() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const rows = useQuery({ queryKey: ['repairs'], queryFn: () => api<RepairRow[]>('/repairs') });

  const act = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'advance' | 'write-off' }) =>
      api(`/repairs/${id}/${verb}`, { method: 'POST' }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['repairs'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      setError(null);
      toast(v.verb === 'advance' ? 'Repair moved forward' : 'Device written off and retired');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Repairs</h1>
        <span className="text-neutral-500">
          reported → repair requested → in repair → fixed / written off
        </span>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">Device</th>
              <th className="px-4 py-2.5">Issue</th>
              <th className="px-4 py-2.5">Opened</th>
              <th className="px-4 py-2.5">By</th>
              <th className="px-4 py-2.5">State</th>
              {isStaff(user?.role) && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 align-top last:border-0">
                <td className="px-4 py-2.5">
                  <b>
                    {r.device.brand} {r.device.model}
                  </b>
                </td>
                <td className="max-w-72 px-4 py-2.5">{r.issue}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5">{r.reportedBy?.name ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <Chip status={r.state} />
                </td>
                {isStaff(user?.role) && (
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {!['fixed', 'written_off'].includes(r.state) && (
                      <button
                        onClick={() => act.mutate({ id: r.id, verb: 'advance' })}
                        className="mr-1.5 rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold"
                      >
                        Advance →
                      </button>
                    )}
                    {['repair_requested', 'in_repair'].includes(r.state) &&
                      user?.role === 'admin' && (
                        <button
                          onClick={() => act.mutate({ id: r.id, verb: 'write-off' })}
                          className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-red-700"
                        >
                          Write off
                        </button>
                      )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.data?.length === 0 && (
          <p className="p-6 text-neutral-400">No repairs. Long may it last.</p>
        )}
      </div>
    </div>
  );
}
