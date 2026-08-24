import { useQuery } from '@tanstack/react-query';
import LoadFailed from '../components/LoadFailed';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Chip from '../components/Chip';
import { api } from '../lib/api';

interface IdleRow {
  id: string;
  brand: string;
  model: string;
  serial: string;
  status: string;
  lastActivity: string;
}

export default function Reports() {
  const [days, setDays] = useState(90);
  const rows = useQuery({
    queryKey: ['idle-devices', days],
    queryFn: () => api<IdleRow[]>(`/reports/idle-devices?days=${days}`),
  });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Idle devices</h1>
        <span className="text-neutral-500">
          Nobody requested these in the last
        </span>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5"
        >
          {[30, 60, 90, 180].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
              <th className="px-4 py-2.5">Device</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((d) => (
              <tr key={d.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-2.5">
                  <Link to={`/devices/${d.id}`} className="font-bold text-inherit no-underline hover:text-accent">
                    {d.brand} {d.model}
                  </Link>
                  <br />
                  <span className="font-mono text-xs text-neutral-500">{d.serial}</span>
                </td>
                <td className="px-4 py-2.5">
                  <Chip status={d.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                  {new Date(d.lastActivity).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.isError && (
          <div className="p-4"><LoadFailed what="the idle report" onRetry={() => rows.refetch()} /></div>
        )}
        {rows.data?.length === 0 && (
          <p className="p-6 text-neutral-400">
            Nothing idle — every device was used in the last {days} days. 🎉
          </p>
        )}
      </div>
      <p className="mt-3 text-neutral-500">
        Devices that sit unused are money on a shelf — this list tells the team what not to buy
        again.
      </p>
    </div>
  );
}
