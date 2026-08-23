import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from './Toasts';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { isStaff, useAuth } from '../lib/auth';
import type { DeviceRow } from '../lib/types';
import RangeCalendar, { type BookingRange, type DateRange } from './RangeCalendar';
import { VForm, VField } from './VForm';
import { minLen, required } from '../lib/validate';

interface UserRow {
  id: string;
  name: string;
  role: string;
}

export default function RequestModal({
  device,
  onClose,
}: {
  device: DeviceRow;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<UserRow[]>('/users'),
    enabled: isStaff(user?.role),
  });
  const bookings = useQuery({
    queryKey: ['device-bookings', device.id],
    queryFn: () => api<BookingRange[]>(`/devices/${device.id}/bookings`),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/requests', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      toast('Request submitted — waiting for approval');
      onClose();
      nav('/requests');
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <VForm
        className="w-full max-w-lg rounded-2xl bg-white p-6"
        onValidSubmit={(f) => {
          if (!range.from || !range.to) {
            setError('Pick a free time range in the calendar');
            return;
          }
          create.mutate({
            deviceId: device.id,
            reason: String(f.get('reason')),
            fromDate: range.from,
            toDate: range.to,
            onBehalfOfId: f.get('onBehalfOfId') || undefined,
          });
        }}
      >
        <h2 className="mb-3 text-lg font-bold">
          Request {device.brand} {device.model}
        </h2>
        {device.holder && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5">
            Held by <b>{device.holder.name}</b> now. If approved, they’ll be asked to hand it
            over.
          </div>
        )}
        <div className="mb-3">
          <VField
            name="reason"
            label="Reason"
            textarea
            rows={3}
            maxLength={500}
            autoFocus
            placeholder="What will you test and why this device?"
            rules={[required('Tell the approver why you need it'), minLen(10)]}
          />
        </div>
        <div className="mb-3">
          <span className="mb-1 block text-xs font-semibold text-neutral-500">
            Time range — taken days are blocked
          </span>
          {bookings.isLoading ? (
            <p className="p-4 text-neutral-400">loading calendar…</p>
          ) : (
            <RangeCalendar bookings={bookings.data ?? []} value={range} onChange={setRange} />
          )}
        </div>
        {isStaff(user?.role) && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-semibold text-neutral-500">
              On behalf of
            </span>
            <select
              name="onBehalfOfId"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            >
              <option value="">Myself</option>
              {users.data
                ?.filter((u) => u.id !== user?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={create.isPending || !range.from || !range.to}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Submit request
          </button>
        </div>
      </VForm>
    </div>
  );
}
