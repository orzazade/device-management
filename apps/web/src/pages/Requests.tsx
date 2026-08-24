import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toasts';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import RangeCalendar, { type BookingRange, type DateRange } from '../components/RangeCalendar';
import RequestTable from '../components/RequestTable';
import ReturnModal from '../components/ReturnModal';
import { VForm, VField } from '../components/VForm';
import { minLen, required } from '../lib/validate';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import type { RequestRow } from '../lib/requests';

/** The whole request lifecycle on one page. Sections follow the flow:
 * approve → hand over → out → back. Testers see only the parts that
 * concern them; staff see the lab-wide desk view plus their own. */
export default function Requests() {
  const { user } = useAuth();
  const staffUser = isStaff(user?.role);
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  // Desk modals (staff)
  const [timeFor, setTimeFor] = useState<RequestRow | null>(null);
  const [rejectFor, setRejectFor] = useState<RequestRow | null>(null);
  const [overrideRange, setOverrideRange] = useState<DateRange>({ from: null, to: null });
  const [returnFor, setReturnFor] = useState<RequestRow | null>(null);
  // My-requests modals (everyone)
  const [extendFor, setExtendFor] = useState<RequestRow | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<RequestRow | null>(null);
  const [offerReturn, setOfferReturn] = useState<RequestRow | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const mine = useQuery({
    queryKey: ['requests', 'mine'],
    queryFn: () => api<RequestRow[]>('/requests'),
  });
  const handovers = useQuery({
    queryKey: ['requests', 'pending-handover'],
    queryFn: () => api<RequestRow[]>('/requests/pending-handover'),
  });
  const all = useQuery({
    queryKey: ['requests', 'all-open'],
    queryFn: () => api<RequestRow[]>('/requests?scope=all'),
    enabled: staffUser,
    refetchInterval: 60000,
  });
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ approvalMode: string }>('/settings'),
    enabled: staffUser,
  });
  const overrideBookings = useQuery({
    queryKey: ['device-bookings', timeFor?.device.id, timeFor?.id],
    queryFn: () =>
      api<BookingRange[]>(
        `/devices/${timeFor!.device.id}/bookings?excludeRequestId=${timeFor!.id}`,
      ),
    enabled: !!timeFor,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['requests'] });
    qc.invalidateQueries({ queryKey: ['devices'] });
  };

  const act = useMutation({
    mutationFn: ({ id, verb, note }: { id: string; verb: 'approve' | 'reject'; note?: string }) =>
      api(`/requests/${id}/${verb}`, { method: 'POST', body: note ? { note } : undefined }),
    onSuccess: (_d, v) => {
      invalidate();
      setError(null);
      setRejectFor(null);
      toast(v.verb === 'approve' ? 'Approved — handover pending' : 'Request rejected');
    },
    onError: (e) => setError(e.message),
  });

  const override = useMutation({
    mutationFn: ({ id, fromDate, toDate }: { id: string; fromDate: string; toDate: string }) =>
      api(`/requests/${id}/time`, { method: 'PATCH', body: { fromDate, toDate } }),
    onSuccess: () => {
      invalidate();
      setTimeFor(null);
      setError(null);
      toast('Time range updated — audited');
    },
    onError: (e) => setError(e.message),
  });

  const handover = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/handover`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      setError(null);
      toast('Handover confirmed — device assigned');
    },
    onError: (e) => setError(e.message),
  });

  const cantHandOver = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      toast('Request cancelled — the requester is notified');
    },
    onError: (e) => setError(e.message),
  });

  const extend = useMutation({
    mutationFn: ({ id, fromDate, toDate }: { id: string; fromDate: string; toDate: string }) =>
      api(`/requests/${id}/time`, { method: 'PATCH', body: { fromDate, toDate } }),
    onSuccess: () => {
      invalidate();
      setExtendFor(null);
      setError(null);
      toast('Loan extended');
    },
    onError: (e) => setError(e.message),
  });

  const returnIntent = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/return-intent`, { method: 'POST' }),
    onSuccess: () => {
      setOfferReturn(null);
      toast('Staff notified — bring the device to the desk');
    },
    onError: (e) => setError(e.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/requests/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      toast('Request cancelled');
    },
    onError: (e) => setError(e.message),
  });

  const btn = 'rounded-lg px-3 py-1 text-xs font-semibold disabled:opacity-50';
  const today = new Date().toISOString().slice(0, 10);
  const daysLate = (r: RequestRow) =>
    Math.max(0, Math.round((Date.parse(today) - Date.parse(r.toDate)) / 86400000));

  const pending = all.data?.filter((r) => r.state === 'pending') ?? [];
  const overdue = all.data?.filter((r) => r.state === 'overdue') ?? [];
  const active = all.data?.filter((r) => r.state === 'active') ?? [];
  const handoverIds = new Set(handovers.data?.map((r) => r.id));
  // Approved bookings a staff member cannot confirm (device is with someone
  // else) still deserve visibility on the desk.
  const approvedElsewhere = staffUser
    ? (all.data?.filter((r) => r.state === 'approved' && !handoverIds.has(r.id)) ?? [])
    : [];

  const section = (title: string, hint: string | null, body: ReactNode) => (
    <div className="mb-6">
      <div className="mb-2 flex items-baseline gap-3">
        <h2 className="font-bold">{title}</h2>
        {hint && <span className="text-sm text-neutral-500">{hint}</span>}
      </div>
      {body}
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-bold">Requests</h1>
        <div className="flex-1" />
        <Link
          to="/devices"
          className="rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:brightness-110"
        >
          Find a device
        </Link>
      </div>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}

      {staffUser &&
        section(
          'Waiting for approval',
          settings.data?.approvalMode === 'busy_only'
            ? 'Free devices auto-approve — only busy ones land here.'
            : 'Every request needs approval — change it in Settings.',
          <RequestTable
            rows={pending}
            error={all.isError}
            onRetry={() => all.refetch()}
            empty="Nothing waiting for approval. 🎉"
            actions={(r) => (
              <span className="flex gap-1.5">
                <button
                  onClick={() => act.mutate({ id: r.id, verb: 'approve' })}
                  disabled={act.isPending && act.variables?.id === r.id}
                  className={`${btn} bg-accent text-white`}
                >
                  Approve
                </button>
                <button
                  onClick={() => setRejectFor(r)}
                  disabled={act.isPending && act.variables?.id === r.id}
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
          />,
        )}

      {(handovers.data?.length ?? 0) > 0 &&
        section(
          'Hand these over',
          'Physically hand the device over, then confirm here.',
          <RequestTable
            rows={handovers.data}
            empty=""
            actions={(r) => (
              <span className="flex gap-1.5">
                <button
                  onClick={() => cantHandOver.mutate(r.id)}
                  disabled={cantHandOver.isPending}
                  className={`${btn} border border-neutral-300`}
                >
                  Can’t hand over
                </button>
                <button
                  onClick={() => handover.mutate(r.id)}
                  disabled={handover.isPending}
                  className={`${btn} bg-accent text-white`}
                >
                  Confirm handover
                </button>
              </span>
            )}
          />,
        )}

      {approvedElsewhere.length > 0 &&
        section(
          'Approved, device still with someone',
          'The current holder confirms these handovers — nothing for the desk to do yet.',
          <RequestTable rows={approvedElsewhere} empty="" />,
        )}

      {staffUser &&
        overdue.length > 0 &&
        section(
          'Overdue — chase these',
          null,
          <RequestTable
            rows={overdue}
            empty=""
            actions={(r) => (
              <span className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-700">
                  {daysLate(r)} {daysLate(r) === 1 ? 'day' : 'days'} late
                </span>
                <button
                  onClick={() => setReturnFor(r)}
                  className={`${btn} bg-accent text-white`}
                >
                  Check in
                </button>
              </span>
            )}
          />,
        )}

      {staffUser &&
        section(
          'Out now',
          'Every device currently in someone’s hands, lab-wide.',
          <RequestTable
            rows={active}
            error={all.isError}
            onRetry={() => all.refetch()}
            empty="No device is out right now."
            actions={(r) => (
              <button onClick={() => setReturnFor(r)} className={`${btn} bg-accent text-white`}>
                Check in
              </button>
            )}
          />,
        )}

      <div className="mb-2 flex items-center gap-3">
        <h2 className="font-bold">My requests</h2>
        <div className="flex gap-1.5">
          {(['open', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                filter === t ? 'bg-accent text-white' : 'border border-neutral-300 bg-white'
              }`}
            >
              {t === 'open' ? 'Open' : 'All'}
            </button>
          ))}
        </div>
      </div>
      <RequestTable
        rows={
          filter === 'open'
            ? mine.data?.filter((r) => !['returned', 'rejected', 'cancelled'].includes(r.state))
            : mine.data
        }
        error={mine.isError}
        onRetry={() => mine.refetch()}
        empty={filter === 'open' ? 'Nothing open. Find a device and ask for it.' : 'No requests yet.'}
        actions={(r) =>
          r.state === 'pending' || r.state === 'approved' ? (
            <button
              onClick={() => (r.state === 'approved' ? setConfirmCancel(r) : cancel.mutate(r.id))}
              disabled={cancel.isPending}
              className={`${btn} border border-neutral-300`}
            >
              {r.state === 'approved' ? 'Cancel booking' : 'Cancel'}
            </button>
          ) : r.state === 'active' || r.state === 'overdue' ? (
            <span className="flex gap-1.5">
              <button
                onClick={() => setExtendFor(r)}
                className={`${btn} border border-neutral-300`}
              >
                Extend
              </button>
              <button
                onClick={() => (staffUser ? setReturnFor(r) : setOfferReturn(r))}
                className={`${btn} bg-accent text-white`}
              >
                Return
              </button>
            </span>
          ) : null
        }
      />

      {returnFor && <ReturnModal request={returnFor} onClose={() => setReturnFor(null)} />}
      {offerReturn && (
        <ConfirmModal
          title={`Return ${offerReturn.device.brand} ${offerReturn.device.model}?`}
          body="Bring the device to the lab desk — a manager checks it in there (that's your receipt). This notifies them you're on the way."
          confirmLabel="Notify the desk"
          busy={returnIntent.isPending}
          onConfirm={() => returnIntent.mutate(offerReturn.id)}
          onClose={() => setOfferReturn(null)}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Cancel this booking?"
          body={`Your approved booking for ${confirmCancel.device.brand} ${confirmCancel.device.model} (${confirmCancel.fromDate} – ${confirmCancel.toDate}) is released for others. This can't be undone — you'd have to request again.`}
          confirmLabel="Cancel booking"
          busy={cancel.isPending}
          onConfirm={() => {
            cancel.mutate(confirmCancel.id);
            setConfirmCancel(null);
          }}
          onClose={() => setConfirmCancel(null)}
        />
      )}
      {extendFor && (
        <Modal onClose={() => setExtendFor(null)}>
          <form
            className="w-full max-w-sm rounded-2xl bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const to = String(new FormData(e.currentTarget).get('toDate'));
              if (!to) return;
              extend.mutate({ id: extendFor.id, fromDate: extendFor.fromDate, toDate: to });
            }}
          >
            <h2 className="mb-1 text-lg font-bold">
              Extend {extendFor.device.brand} {extendFor.device.model}
            </h2>
            <p className="mb-3 text-neutral-500">
              Currently due back {extendFor.toDate}. If someone else booked the days you pick,
              the extension is refused with the reason.
            </p>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-semibold text-neutral-500">
                Keep it until
              </span>
              <input
                type="date"
                name="toDate"
                required
                min={new Date().toISOString().slice(0, 10)}
                defaultValue={extendFor.toDate}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2"
              />
            </label>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExtendFor(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={extend.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {extend.isPending ? 'Extending…' : 'Extend loan'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {rejectFor && (
        <Modal onClose={() => setRejectFor(null)}>
          <VForm
            className="w-full max-w-md rounded-2xl bg-white p-6"
            onValidSubmit={(f) =>
              act.mutate({ id: rejectFor.id, verb: 'reject', note: String(f.get('note')) })
            }
          >
            <h2 className="mb-1 text-lg font-bold">
              Reject {rejectFor.device.brand} {rejectFor.device.model}?
            </h2>
            <p className="mb-3 text-neutral-500">
              {rejectFor.requester.name} will see this reason — make it useful.
            </p>
            <div className="mb-3">
              <VField
                name="note"
                label="Reason"
                textarea
                rows={2}
                maxLength={300}
                autoFocus
                placeholder="e.g. Device is reserved for the release test that week"
                rules={[required('Give the requester a reason'), minLen(5)]}
              />
            </div>
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectFor(null)}
                className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
              >
                Cancel
              </button>
              <button
                disabled={act.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {act.isPending ? 'Rejecting…' : 'Reject request'}
              </button>
            </div>
          </VForm>
        </Modal>
      )}

      {timeFor && (
        <Modal onClose={() => setTimeFor(null)}>
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
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
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
                  allowPast
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
                disabled={!overrideRange.from || !overrideRange.to || override.isPending}
                className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              >
                {override.isPending ? 'Saving…' : 'Save override'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
