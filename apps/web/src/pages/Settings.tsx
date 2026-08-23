import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Rule {
  event: string;
  label: string;
  inapp: boolean;
  email: boolean;
}

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ approvalMode: string }>('/settings'),
  });
  const rules = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api<Rule[]>('/notification-rules'),
  });

  const setMode = useMutation({
    mutationFn: (mode: string) =>
      api('/settings/approval-mode', { method: 'PATCH', body: { mode } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
    onError: (e) => setError(e.message),
  });

  const patchRule = useMutation({
    mutationFn: ({ event, field, value }: { event: string; field: string; value: boolean }) =>
      api(`/notification-rules/${event}`, { method: 'PATCH', body: { [field]: value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-rules'] }),
    onError: (e) => setError(e.message),
  });

  const mode = settings.data?.approvalMode;

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Settings</h1>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      <div className="mb-4 max-w-2xl rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold">Approval policy</h2>
        <p className="mb-3 text-neutral-500">A config switch, not code — flip it any time.</p>
        <label className="mb-2 flex items-start gap-2.5">
          <input
            type="radio"
            checked={mode === 'all'}
            disabled={user?.role !== 'admin'}
            onChange={() => setMode.mutate('all')}
            className="mt-1"
          />
          <span>
            <b>Every request needs approval</b> (launch policy)
          </span>
        </label>
        <label className="flex items-start gap-2.5">
          <input
            type="radio"
            checked={mode === 'busy_only'}
            disabled={user?.role !== 'admin'}
            onChange={() => setMode.mutate('busy_only')}
            className="mt-1"
          />
          <span>
            <b>Free devices auto-approve</b> — approval only when the device is in someone’s
            hands
          </span>
        </label>
        {user?.role !== 'admin' && (
          <p className="mt-2 text-xs text-neutral-400">Only an Admin can change this.</p>
        )}
      </div>

      <div className="max-w-2xl overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 p-5 pb-3">
          <h2 className="font-bold">Notifications</h2>
          <p className="text-neutral-500">Which channel fires for which event.</p>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-5 py-2.5">Event</th>
              <th className="px-5 py-2.5 text-center">In-app</th>
              <th className="px-5 py-2.5 text-center">Email</th>
            </tr>
          </thead>
          <tbody>
            {rules.data?.map((r) => (
              <tr key={r.event} className="border-b border-neutral-100 last:border-0">
                <td className="px-5 py-2.5">{r.label}</td>
                {(['inapp', 'email'] as const).map((field) => (
                  <td key={field} className="px-5 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={r[field]}
                      onChange={(e) =>
                        patchRule.mutate({ event: r.event, field, value: e.target.checked })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="p-5 pt-3 text-neutral-500">
          Email goes through corporate SMTP. Failed sends stay visible in an outbox with the
          error — they are never silently dropped.
        </p>
      </div>
    </div>
  );
}
