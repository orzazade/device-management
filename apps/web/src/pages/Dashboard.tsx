import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Chip from '../components/Chip';
import RequestTable from '../components/RequestTable';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import type { RequestRow } from '../lib/requests';
import type { DeviceRow } from '../lib/types';

function Stat({ k, label }: { k: number | string; label: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold tabular-nums">{k}</div>
      <div className="text-neutral-500">{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<DeviceRow[]>('/devices') });
  const myRequests = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => api<RequestRow[]>('/requests'),
  });
  const pending = useQuery({
    queryKey: ['requests', 'pending-approvals'],
    queryFn: () => api<RequestRow[]>('/requests?scope=all&state=pending'),
    enabled: isStaff(user?.role),
  });

  const mine = devices.data?.filter((d) => d.holder?.id === user?.id) ?? [];
  const openRequests =
    myRequests.data?.filter((r) => !['returned', 'rejected', 'cancelled'].includes(r.state)) ??
    [];

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold">Hi, {user?.name.split(' ')[0]}</h1>
        <p className="text-neutral-500">Here’s the lab right now.</p>
      </div>
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Stat
          k={devices.data?.filter((d) => d.status === 'available').length ?? '…'}
          label="Devices available now"
        />
        <Stat k={mine.length} label="In my hands" />
        {isStaff(user?.role) && (
          <Stat k={pending.data?.length ?? '…'} label="Waiting for approval" />
        )}
        <Stat
          k={devices.data?.filter((d) => d.status === 'in_repair').length ?? '…'}
          label="In repair"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          <h2 className="mb-2 font-bold">My requests</h2>
          <RequestTable
            rows={openRequests}
            empty="No open requests. Find a device and ask for it."
            error={myRequests.isError}
            onRetry={() => myRequests.refetch()}
          />
        </div>
        <div>
          <h2 className="mb-2 font-bold">Devices I hold</h2>
          <div className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            {mine.map((d) => (
              <Link
                key={d.id}
                to={`/devices/${d.id}`}
                className="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 last:border-0 hover:bg-neutral-50"
              >
                <span>
                  <b>
                    {d.brand} {d.model}
                  </b>
                  <br />
                  <small className="text-neutral-500">
                    {d.os} {d.osVersion}
                  </small>
                </span>
                <Chip status={d.status} />
              </Link>
            ))}
            {mine.length === 0 && <p className="p-6 text-neutral-400">Nothing checked out.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
