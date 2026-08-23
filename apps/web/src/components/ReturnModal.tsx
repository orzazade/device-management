import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from './Toasts';
import { useState } from 'react';
import { api } from '../lib/api';
import type { RequestRow } from '../lib/requests';

export default function ReturnModal({
  request,
  onClose,
}: {
  request: RequestRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [damaged, setDamaged] = useState(false);
  const accessories = request.device.accessories ?? [];
  const [present, setPresent] = useState<Record<string, boolean>>(
    Object.fromEntries(accessories.map((a) => [a, true])),
  );

  const ret = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/requests/${request.id}/return`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      toast(damaged ? 'Returned — sent to repairs' : 'Returned — device is available again');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="w-full max-w-md rounded-2xl bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          ret.mutate({
            missingAccessories: accessories.filter((a) => !present[a]),
            damaged,
            damageNote: damaged ? String(f.get('damageNote') || '') : undefined,
          });
        }}
      >
        <h2 className="mb-1 text-lg font-bold">
          Return {request.device.brand} {request.device.model}
        </h2>
        <p className="mb-4 text-neutral-500">
          Check every accessory against the list before accepting.
        </p>
        {accessories.length ? (
          accessories.map((a) => (
            <label
              key={a}
              className="flex items-center gap-2.5 border-b border-neutral-100 py-2"
            >
              <input
                type="checkbox"
                checked={present[a]}
                onChange={(e) => setPresent({ ...present, [a]: e.target.checked })}
              />
              {a}
            </label>
          ))
        ) : (
          <p className="mb-2 text-neutral-400">No accessories registered.</p>
        )}
        <label className="flex items-center gap-2.5 border-b border-neutral-100 py-2">
          <input
            type="checkbox"
            checked={damaged}
            onChange={(e) => setDamaged(e.target.checked)}
          />
          Device has new damage
        </label>
        {damaged && (
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-neutral-500">
              What happened?
            </span>
            <textarea
              name="damageNote"
              rows={2}
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </label>
        )}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            disabled={ret.isPending}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            Accept return
          </button>
        </div>
      </form>
    </div>
  );
}
