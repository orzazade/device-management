import type { ReactNode } from 'react';
import Chip from './Chip';
import LoadFailed from './LoadFailed';
import type { RequestRow } from '../lib/requests';

export default function RequestTable({
  rows,
  actions,
  empty = 'Nothing here.',
  error = false,
  onRetry,
}: {
  rows: RequestRow[] | undefined;
  actions?: (r: RequestRow) => ReactNode;
  empty?: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  if (error && onRetry) return <LoadFailed what="requests" onRetry={onRetry} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
            <th className="px-4 py-2.5">Device</th>
            <th className="px-4 py-2.5">Requester</th>
            <th className="px-4 py-2.5">When</th>
            <th className="px-4 py-2.5">Reason</th>
            <th className="px-4 py-2.5">State</th>
            {actions && <th className="px-4 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr key={r.id} className="border-b border-neutral-100 align-top last:border-0">
              <td className="px-4 py-2.5">
                <b>
                  {r.device.brand} {r.device.model}
                </b>
                {(r.state === 'pending' || r.state === 'approved') && (
                  <div className="text-xs text-neutral-500">
                    {r.device.holder ? r.device.holder.name : 'lab desk'} → {r.requester.name}
                  </div>
                )}
                {r.device.damageNote && (
                  <div className="text-xs font-semibold text-amber-700">🛠 {r.device.damageNote}</div>
                )}
                {r.state === 'pending' && r.device.status && r.device.status !== 'available' && (
                  <div className="text-xs text-neutral-500">device is {r.device.status.replace('_', ' ')}</div>
                )}
              </td>
              <td className="px-4 py-2.5">{r.requester.name}</td>
              <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                {r.fromDate}
                <br />
                {r.toDate}
              </td>
              <td className="max-w-64 px-4 py-2.5">{r.reason}</td>
              <td className="px-4 py-2.5">
                <Chip status={r.state} />
                {r.state === 'rejected' && r.decisionNote && (
                  <div className="mt-1 max-w-44 text-xs text-neutral-500">{r.decisionNote}</div>
                )}
              </td>
              {actions && <td className="whitespace-nowrap px-4 py-2.5">{actions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p className="p-6 text-neutral-400">{empty}</p>}
    </div>
  );
}
