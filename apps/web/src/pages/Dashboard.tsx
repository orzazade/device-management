import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toasts';
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

interface DashStats {
  availableNow: number;
  openRepairs: number;
  overdue: { id: string; device: string; holder: string; dueDate: string }[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api<DeviceRow[]>('/devices') });
  const stats = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api<DashStats>('/reports/dashboard'),
    refetchInterval: 60000,
  });
  const handovers = useQuery({
    queryKey: ['requests', 'pending-handover'],
    queryFn: () => api<RequestRow[]>('/requests/pending-handover'),
  });
  const confirmHandover = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/handover`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast('Handover confirmed');
    },
    onError: (e) => toast(e.message, 'error'),
  });
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
      {isStaff(user?.role) && (stats.data?.overdue.length ?? 0) > 0 && (
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
          <Link to="/loans" className="mt-1 inline-block font-semibold text-red-700">
            Chase them on the Loans board →
          </Link>
        </div>
      )}
      <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3">
        <Link to="/devices" className="text-inherit no-underline">
          <Stat k={stats.data?.availableNow ?? '…'} label="Devices available now" />
        </Link>
        <Stat k={mine.length} label="In my hands" />
        {isStaff(user?.role) && (
          <Link to="/approvals" className="text-inherit no-underline">
            <Stat k={pending.data?.length ?? '…'} label="Waiting for approval" />
          </Link>
        )}
        <Link to="/repairs" className="text-inherit no-underline">
          <Stat k={stats.data?.openRepairs ?? '…'} label="In repair flow" />
        </Link>
      </div>
      {(handovers.data?.length ?? 0) > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 font-bold">Hand these over</h2>
          <RequestTable
            rows={handovers.data}
            empty=""
            actions={(r) => (
              <button
                onClick={() => confirmHandover.mutate(r.id)}
                disabled={confirmHandover.isPending}
                className="rounded-lg bg-accent px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
              >
                Confirm handover
              </button>
            )}
          />
        </div>
      )}
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
