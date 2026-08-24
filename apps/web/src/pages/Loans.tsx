import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '../components/Chip';
import LoadFailed from '../components/LoadFailed';
import ReturnModal from '../components/ReturnModal';
import { api } from '../lib/api';
import type { RequestRow } from '../lib/requests';

/** Lab-wide loans board for staff: what is out, with whom, and what is
 * late. Overdue exists as a state and fires notifications — this is the
 * screen where the people responsible for chasing devices can SEE it. */
export default function Loans() {
  const [returnFor, setReturnFor] = useState<RequestRow | null>(null);
  const rows = useQuery({
    queryKey: ['requests', 'all-open'],
    queryFn: () => api<RequestRow[]>('/requests?scope=all'),
    refetchInterval: 60000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const open = (rows.data ?? []).filter((r) =>
    ['overdue', 'active', 'approved'].includes(r.state),
  );
  const overdue = open.filter((r) => r.state === 'overdue');
  const active = open.filter((r) => r.state === 'active');
  const approved = open.filter((r) => r.state === 'approved');

  const daysLate = (r: RequestRow) =>
    Math.max(0, Math.round((Date.parse(today) - Date.parse(r.toDate)) / 86400000));

  const section = (title: string, list: RequestRow[], opts?: { late?: boolean; empty: string }) => (
    <div className="mb-6">
      <h2 className="mb-2 font-bold">
        {title} <span className="font-normal text-neutral-400">({list.length})</span>
      </h2>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">Device</th>
              <th className="px-4 py-2.5">With</th>
              <th className="px-4 py-2.5">From</th>
              <th className="px-4 py-2.5">Due back</th>
              {opts?.late && <th className="px-4 py-2.5">Late by</th>}
              <th className="px-4 py-2.5">State</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link to={`/devices/${r.device.id}`} className="font-semibold text-inherit no-underline hover:text-accent">
                    {r.device.brand} {r.device.model}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{r.requester.name}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{r.fromDate}</td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{r.toDate}</td>
                {opts?.late && (
                  <td className="px-4 py-2.5 font-semibold text-red-700">
                    {daysLate(r)} {daysLate(r) === 1 ? 'day' : 'days'}
                  </td>
                )}
                <td className="px-4 py-2.5"><Chip status={r.state} /></td>
                <td className="px-4 py-2.5 text-right">
                  {(r.state === 'active' || r.state === 'overdue') && (
                    <button
                      onClick={() => setReturnFor(r)}
                      className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white"
                    >
                      Check in
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.isError ? (
          <div className="p-4"><LoadFailed what="loans" onRetry={() => rows.refetch()} /></div>
        ) : (
          list.length === 0 && (
            <p className="p-5 text-neutral-400">{rows.isLoading ? 'loading…' : opts?.empty}</p>
          )
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Loans</h1>
        <span className="text-neutral-500">Every device that is out or promised, lab-wide.</span>
      </div>
      {section('Overdue — chase these', overdue, { late: true, empty: 'Nothing is late. 🎉' })}
      {section('Out now', active, { empty: 'No device is out right now.' })}
      {section('Approved, awaiting handover', approved, { empty: 'Nothing waiting for handover.' })}
      {returnFor && <ReturnModal request={returnFor} onClose={() => setReturnFor(null)} />}
    </div>
  );
}
