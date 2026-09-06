import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState } from 'react';
import Chip from '../components/Chip';
import ConfirmModal from '../components/ConfirmModal';
import Modal from '../components/Modal';
import { VForm, VField } from '../components/VForm';
import { minLen, required } from '../lib/validate';
import { api } from '../lib/api';
import { useCan } from '../lib/auth';

interface RepairRow {
  id: string;
  device: { id: string; brand?: string; model?: string };
  reportedBy: { id: string; name: string } | null;
  issue: string;
  state: string;
  createdAt: string;
}

export default function Repairs() {
  const can = useCan();
  // The actions column exists only if there is at least one action in it.
  const canAct = can('repairs.advance') || can('repairs.cancel') || can('repairs.writeOff');
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [writeOffFor, setWriteOffFor] = useState<RepairRow | null>(null);
  const [cancelFor, setCancelFor] = useState<RepairRow | null>(null);
  const rows = useQuery({ queryKey: ['repairs'], queryFn: () => api<RepairRow[]>('/repairs') });
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const OPEN_STATES = ['reported', 'repair_requested', 'in_repair'];
  const visible = rows.data?.filter((r) =>
    tab === 'open' ? OPEN_STATES.includes(r.state) : !OPEN_STATES.includes(r.state),
  );
  const openCount = rows.data?.filter((r) => OPEN_STATES.includes(r.state)).length ?? 0;
  const closedCount = (rows.data?.length ?? 0) - openCount;

  const act = useMutation({
    mutationFn: ({ id, verb, body }: { id: string; verb: 'advance' | 'write-off' | 'cancel'; body?: Record<string, unknown> }) =>
      api(`/repairs/${id}/${verb}`, { method: 'POST', body }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['repairs'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      setError(null);
      setWriteOffFor(null);
      setCancelFor(null);
      toast(
        v.verb === 'advance'
          ? 'Repair moved forward'
          : v.verb === 'cancel'
            ? 'Report cancelled'
            : 'Device written off and retired',
      );
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Repairs</h1>
        <span className="text-neutral-500">
          Send a phone here from its device page → “Send to repair”. Flow: reported →
          repair requested → in repair → fixed / written off
        </span>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <div className="mb-3 flex gap-1.5">
        {(['open', 'closed'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold ${
              tab === t ? 'bg-accent text-white' : 'border border-neutral-300 bg-white'
            }`}
          >
            {t === 'open' ? `Open (${openCount})` : `Closed (${closedCount})`}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">Device</th>
              <th className="px-4 py-2.5">Issue</th>
              <th className="px-4 py-2.5">Opened</th>
              <th className="px-4 py-2.5">By</th>
              <th className="px-4 py-2.5">State</th>
              {canAct && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {visible?.map((r) => (
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
                {canAct && (
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {!['fixed', 'written_off'].includes(r.state) && (
                      <button
                        onClick={() => act.mutate({ id: r.id, verb: 'advance' })}
                        disabled={act.isPending && act.variables?.id === r.id}
                        className="mr-1.5 rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        {({ reported: 'Request repair →', repair_requested: 'Send to repair →', in_repair: 'Mark fixed ✓' } as Record<string, string>)[r.state] ?? 'Advance →'}
                      </button>
                    )}
                    {['reported', 'repair_requested'].includes(r.state) && (
                      <button
                        onClick={() => setCancelFor(r)}
                        disabled={act.isPending}
                        className="mr-1.5 rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold disabled:opacity-50"
                      >
                        Cancel report
                      </button>
                    )}
                    {['repair_requested', 'in_repair'].includes(r.state) &&
                      can('repairs.writeOff') && (
                        <button
                          onClick={() => setWriteOffFor(r)}
                          disabled={act.isPending}
                          className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                        >
                          Write off…
                        </button>
                      )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {visible?.length === 0 && (
          <p className="p-6 text-neutral-400">
            {tab === 'open' ? 'No open repairs. Long may it last.' : 'Nothing closed yet.'}
          </p>
        )}
      </div>

      {cancelFor && (
        <ConfirmModal
          title={`Cancel this damage report?`}
          body={`“${cancelFor.issue}” on ${cancelFor.device.brand} ${cancelFor.device.model} will be closed as a mistake and the damage note cleared. ${cancelFor.reportedBy?.name ?? 'The reporter'} is notified.`}
          confirmLabel="Yes, cancel the report"
          busy={act.isPending}
          onConfirm={() => act.mutate({ id: cancelFor.id, verb: 'cancel' })}
          onClose={() => setCancelFor(null)}
        />
      )}

      {writeOffFor && (
        <Modal onClose={() => setWriteOffFor(null)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) =>
              act.mutate({ id: writeOffFor.id, verb: 'write-off', body: { reason: String(f.get('reason')) } })
            }
          >
            <h2 className="mb-1 text-lg font-bold">
              Write off {writeOffFor.device.brand} {writeOffFor.device.model}?
            </h2>
            <p className="mb-3 text-neutral-500">
              This retires the device permanently and closes any open loan. Finance will ask why —
              the reason goes into the audit log.
            </p>
            <div className="mb-3">
              <VField
                name="reason"
                label="Reason"
                textarea
                rows={2}
                maxLength={300}
                autoFocus
                placeholder="e.g. Board damage after drop, repair quote exceeds value"
                rules={[required('Say why this device is being scrapped'), minLen(5)]}
              />
            </div>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setWriteOffFor(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={act.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {act.isPending ? 'Writing off…' : 'Write off device'}
              </button>
            </div>
          </VForm>
        </Modal>
      )}
    </div>
  );
}
