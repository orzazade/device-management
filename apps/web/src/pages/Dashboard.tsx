import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Chip from '../components/Chip';
import RequestTable from '../components/RequestTable';
import { api } from '../lib/api';
import { useAuth, useCan } from '../lib/auth';
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

interface DashStats {
  availableNow: number;
  openRepairs: number;
  overdue: { id: string; device: string; holder: string; dueDate: string }[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const can = useCan();
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<DeviceRow[]>('/devices'),
    refetchInterval: 60000,
  });
  const stats = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api<DashStats>('/reports/dashboard'),
    refetchInterval: 60000,
  });
  const myRequests = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => api<RequestRow[]>('/requests'),
    refetchInterval: 60000,
  });
  const pending = useQuery({
    queryKey: ['requests', 'pending-approvals'],
    queryFn: () => api<RequestRow[]>('/requests?scope=all&state=pending'),
    enabled: can('reports.viewAll'),
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
      {can('reports.viewAll') && (stats.data?.overdue.length ?? 0) > 0 && (
        <div className="mb-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
          <b className="text-red-800">
            {stats.data!.overdue.length} device{stats.data!.overdue.length > 1 ? 's are' : ' is'} overdue
          </b>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-red-800">
            {stats.data!.overdue.map((o) => (
              <span key={o.id}>
                {o.device} — {o.holder} (due {o.dueDate})
              </span>
            ))}
          </div>
          <Link to="/requests" className="mt-1 inline-block font-semibold text-red-700">
            Chase them on the Requests page →
          </Link>
        </div>
      )}
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Link to="/devices" className="text-inherit no-underline">
          <Stat k={stats.data?.availableNow ?? '…'} label="Devices available now" />
        </Link>
        {/* Every other tile shows "…" until its query lands. This one
            counted an empty list as a real zero, so somebody holding three
            devices was told they held none for as long as the request took. */}
        <Stat k={devices.isLoading ? '…' : mine.length} label="In my hands" />
        {can('requests.viewAll') && (
          <Link to="/requests" className="text-inherit no-underline">
            <Stat k={pending.data?.length ?? '…'} label="Waiting for approval" />
          </Link>
        )}
        <Link to="/repairs" className="text-inherit no-underline">
          <Stat k={stats.data?.openRepairs ?? '…'} label="In repair flow" />
        </Link>
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
                    {(() => {
                      const loan = myRequests.data?.find(
                        (r) => r.device.id === d.id && ['active', 'overdue'].includes(r.state),
                      );
                      return loan
                        ? `due back ${loan.toDate}`
                        : `${d.os} ${d.osVersion}`;
                    })()}
                  </small>
                </span>
                <Chip status={d.status} />
              </Link>
            ))}
            {devices.isLoading ? (
              <p className="p-6 text-neutral-400">loading…</p>
            ) : (
              mine.length === 0 && (
                <p className="p-6 text-neutral-400">Nothing checked out.</p>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
