import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import RangeCalendar, { type BookingRange, type DateRange } from '../components/RangeCalendar';
import RequestTable from '../components/RequestTable';
import { api } from '../lib/api';
import type { RequestRow } from '../lib/requests';

export default function Approvals() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [timeFor, setTimeFor] = useState<RequestRow | null>(null);
  const [overrideRange, setOverrideRange] = useState<DateRange>({ from: null, to: null });
  const overrideBookings = useQuery({
    queryKey: ['device-bookings', timeFor?.device.id, timeFor?.id],
    queryFn: () =>
      api<BookingRange[]>(
        `/devices/${timeFor!.device.id}/bookings?excludeRequestId=${timeFor!.id}`,
      ),
    enabled: !!timeFor,
  });

  const rows = useQuery({
    queryKey: ['requests', 'pending-approvals'],
    queryFn: () => api<RequestRow[]>('/requests?scope=all&state=pending'),
  });

  const act = useMutation({
    mutationFn: ({ id, verb }: { id: string; verb: 'approve' | 'reject' }) =>
      api(`/requests/${id}/${verb}`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const override = useMutation({
    mutationFn: ({ id, fromDate, toDate }: { id: string; fromDate: string; toDate: string }) =>
      api(`/requests/${id}/time`, { method: 'PATCH', body: { fromDate, toDate } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      setTimeFor(null);
      setError(null);
    },
    onError: (e) => setError(e.message),
  });

  const btn = 'rounded-lg px-3 py-1 text-xs font-semibold';

  return (
    <div>
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-xl font-bold">Approvals</h1>
        <span className="text-neutral-500">
          Policy: every request needs approval — change in Settings later.
        </span>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      <RequestTable
        rows={rows.data}
        empty="Nothing waiting for approval. 🎉"
        actions={(r) => (
          <span className="flex gap-1.5">
            <button
              onClick={() => act.mutate({ id: r.id, verb: 'approve' })}
              className={`${btn} bg-accent text-white`}
            >
              Approve
            </button>
            <button
              onClick={() => act.mutate({ id: r.id, verb: 'reject' })}
              className={`${btn} border border-neutral-300 text-red-700`}
            >
              Reject
            </button>
            <button
              onClick={() => {
                setTimeFor(r);
                setOverrideRange({ from: r.fromDate, to: r.toDate });
              }}
              className={`${btn} border border-neutral-300`}
            >
              Time…
            </button>
          </span>
        )}
      />

      {timeFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
          onClick={(e) => e.target === e.currentTarget && setTimeFor(null)}
        >
          <form
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!overrideRange.from || !overrideRange.to) return;
              override.mutate({
                id: timeFor.id,
                fromDate: overrideRange.from,
                toDate: overrideRange.to,
              });
            }}
          >
            <h2 className="mb-2 text-lg font-bold">Override time range</h2>
            <p className="mb-4 text-neutral-500">
              Every change here is written to the audit log. Other bookings on this device are
              blocked in the calendar.
            </p>
            <div className="mb-4">
              {overrideBookings.isLoading ? (
                <p className="p-4 text-neutral-400">loading calendar…</p>
              ) : (
                <RangeCalendar
                  bookings={overrideBookings.data ?? []}
                  value={overrideRange}
                  onChange={setOverrideRange}
                />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTimeFor(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={!overrideRange.from || !overrideRange.to}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                Save override
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
