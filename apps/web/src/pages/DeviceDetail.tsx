import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Chip from '../components/Chip';
import { api } from '../lib/api';
import type { AuditRow, DeviceRow } from '../lib/types';

const short = (v: unknown) => (v == null ? '—' : JSON.stringify(v));

export default function DeviceDetail() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'specs' | 'history' | 'repairs'>('specs');
  const device = useQuery({
    queryKey: ['device', id],
    queryFn: () => api<DeviceRow>(`/devices/${id}`),
  });
  const history = useQuery({
    queryKey: ['device-history', id],
    queryFn: () => api<AuditRow[]>(`/devices/${id}/history`),
    enabled: tab === 'history',
  });

  const d = device.data;
  if (device.isLoading) return <p className="text-neutral-400">loading…</p>;
  if (!d) return <p className="text-neutral-400">Device not found.</p>;

  const tabBtn = (key: typeof tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      className={`border-b-2 px-3 py-2.5 font-semibold ${
        tab === key ? 'border-accent text-accent' : 'border-transparent text-neutral-500'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/devices" className="text-accent no-underline">
          ←
        </Link>
        <h1 className="text-xl font-bold">
          {d.brand} {d.model}
        </h1>
        <Chip status={d.status} />
      </div>

      {d.damageNote && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
          🛠 Known damage: <b>{d.damageNote}</b>
        </div>
      )}

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex gap-1 border-b border-neutral-200 px-4">
          {tabBtn('specs', 'Specs')}
          {tabBtn('history', 'History')}
          {tabBtn('repairs', 'Repairs')}
        </div>

        {tab === 'specs' && (
          <dl className="grid grid-cols-[150px_1fr] gap-x-4 gap-y-1.5 p-4">
            <dt className="text-neutral-500">OS</dt>
            <dd>
              {d.os} {d.osVersion}
            </dd>
            <dt className="text-neutral-500">Specs</dt>
            <dd>{d.specs || '—'}</dd>
            <dt className="text-neutral-500">Serial</dt>
            <dd className="font-mono text-xs">{d.serial}</dd>
            <dt className="text-neutral-500">IMEI</dt>
            <dd className="font-mono text-xs">{d.imei || '—'}</dd>
            <dt className="text-neutral-500">Current holder</dt>
            <dd>{d.holder?.name ?? '— (lab desk)'}</dd>
            <dt className="text-neutral-500">Project</dt>
            <dd>{d.project?.name ?? '—'}</dd>
            <dt className="text-neutral-500">Accessories</dt>
            <dd>{d.accessories.length ? d.accessories.join(' · ') : 'none'}</dd>
          </dl>
        )}

        {tab === 'history' &&
          (history.data?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-2.5">When</th>
                    <th className="px-4 py-2.5">Who</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Old → New</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((a) => (
                    <tr key={a.id} className="border-b border-neutral-100 align-top last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                        {new Date(a.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">{a.actorName}</td>
                      <td className="px-4 py-2.5">{a.action}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {short(a.oldValue)} → {short(a.newValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-6 text-neutral-400">
              {history.isLoading ? 'loading…' : 'No history yet.'}
            </p>
          ))}

        {tab === 'repairs' && (
          <p className="p-6 text-neutral-400">Repair flow arrives in slice S6.</p>
        )}
      </div>
    </div>
  );
}
