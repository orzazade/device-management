import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface Rule {
  event: string;
  label: string;
  inapp: boolean;
  email: boolean;
}

interface OutboxRow {
  id: string;
  toEmail: string;
  subject: string;
  state: 'pending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
interface OutboxData {
  counts: { pending: number; sent: number; failed: number };
  rows: OutboxRow[];
}

export default function Settings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ approvalMode: string }>('/settings'),
  });
  const rules = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api<Rule[]>('/notification-rules'),
  });

  const outbox = useQuery({
    queryKey: ['email-outbox'],
    queryFn: () => api<OutboxData>('/email-outbox'),
  });

  const retryMail = useMutation({
    mutationFn: (id: string) => api(`/email-outbox/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-outbox'] });
      toast('Queued for another send');
    },
    onError: (e) => setError(e.message),
  });

  const setMode = useMutation({
    mutationFn: (mode: string) =>
      api('/settings/approval-mode', { method: 'PATCH', body: { mode } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Approval policy saved');
    },
    onError: (e) => setError(e.message),
  });

  const patchRule = useMutation({
    mutationFn: ({ event, field, value }: { event: string; field: string; value: boolean }) =>
      api(`/notification-rules/${event}`, { method: 'PATCH', body: { [field]: value } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notification-rules'] });
      toast('Notification rule saved');
    },
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
            name="approvalMode"
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
            name="approvalMode"
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
          Email goes through corporate SMTP. Failed sends stay visible in the outbox below
          with the error — they are never silently dropped.
        </p>
      </div>

      <div className="mt-4 max-w-2xl overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 p-5 pb-3">
          <h2 className="font-bold">Email outbox</h2>
          <p className="text-neutral-500">
            {outbox.data
              ? `${outbox.data.counts.pending} waiting · ${outbox.data.counts.sent} sent · ${outbox.data.counts.failed} failed`
              : 'Every queued email, newest first.'}
          </p>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-5 py-2.5">To</th>
              <th className="px-5 py-2.5">Subject</th>
              <th className="px-5 py-2.5">State</th>
              <th className="px-5 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {outbox.data?.rows.map((m) => (
              <tr key={m.id} className="border-b border-neutral-100 align-top last:border-0">
                <td className="whitespace-nowrap px-5 py-2.5">{m.toEmail}</td>
                <td className="px-5 py-2.5">
                  {m.subject}
                  {m.lastError && (
                    <span className="mt-0.5 block text-xs text-red-600">
                      {m.attempts}× failed: {m.lastError}
                    </span>
                  )}
                </td>
                <td className="px-5 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      m.state === 'sent'
                        ? 'bg-green-100 text-green-800'
                        : m.state === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {m.state}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right">
                  {m.state === 'failed' && (
                    <button
                      onClick={() => retryMail.mutate(m.id)}
                      className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {outbox.data?.rows.length === 0 && (
          <p className="p-5 text-neutral-400">Nothing queued yet.</p>
        )}
      </div>
    </div>
  );
}
