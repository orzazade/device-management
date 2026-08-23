import { useQuery } from '@tanstack/react-query';
import ChangeDiff from '../components/ChangeDiff';
import { api } from '../lib/api';

interface AuditRow {
  id: string;
  actorName: string;
  entityType: string;
  entityId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
}

export default function Audit() {
  const rows = useQuery({ queryKey: ['audit'], queryFn: () => api<AuditRow[]>('/audit') });
  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Audit log</h1>
        <span className="text-neutral-500">Append-only. Who, what, old → new.</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Who</th>
              <th className="px-4 py-2.5">What</th>
              <th className="px-4 py-2.5">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0 align-top">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
                  {new Date(r.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2.5">{r.actorName}</td>
                <td className="px-4 py-2.5">
                  <span className="capitalize">{r.entityType.replace(/_/g, ' ')}</span>{' '}
                  <span className="font-semibold">{r.action.replace(/_/g, ' ')}</span>
                </td>
                <td className="px-4 py-2.5">
                  <ChangeDiff oldValue={r.oldValue} newValue={r.newValue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.isLoading && <p className="p-6 text-neutral-400">loading…</p>}
        {rows.data?.length === 0 && <p className="p-6 text-neutral-400">No entries yet.</p>}
      </div>
    </div>
  );
}
