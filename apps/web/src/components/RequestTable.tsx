import type { ReactNode } from 'react';
import Chip from './Chip';
import type { RequestRow } from '../lib/requests';

export default function RequestTable({
  rows,
  actions,
  empty = 'Nothing here.',
}: {
  rows: RequestRow[] | undefined;
  actions?: (r: RequestRow) => ReactNode;
  empty?: string;
}) {
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
                {r.state === 'pending' && r.device.holder && (
                  <div className="text-xs text-neutral-500">held by {r.device.holder.name}</div>
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
