import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { minLen, password, required } from '../lib/validate';
import { useToast } from './Toasts';
import { VField, VForm } from './VForm';

/** Self-service password change. `forced` = user logged in with the
 * factory-default password; the modal then has no way out but changing it. */
export default function ChangePasswordModal({
  forced = false,
  onClose,
}: {
  forced?: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api('/auth/change-password', { method: 'POST', body }),
    onSuccess: () => {
      toast('Password changed');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-5"
      onClick={(e) => !forced && e.target === e.currentTarget && onClose()}
    >
      <VForm
        className="w-full max-w-sm rounded-2xl bg-white p-6"
        onValidSubmit={(f) => {
          const next = String(f.get('newPassword'));
          if (next !== String(f.get('confirm'))) {
            setError('The two new passwords do not match');
            return;
          }
          setError(null);
          change.mutate({ currentPassword: String(f.get('currentPassword')), newPassword: next });
        }}
      >
        <h2 className="mb-1 text-lg font-bold">Change password</h2>
        {forced && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            You signed in with the default password. Set your own before continuing.
          </p>
        )}
        <div className="mb-3">
          <VField
            name="currentPassword"
            label="Current password"
            type="password"
            autoFocus
            rules={[required('Enter your current password')]}
          />
        </div>
        <div className="mb-3">
          <VField
            name="newPassword"
            label="New password"
            type="password"
            rules={[required('Pick a new password'), minLen(8), password()]}
          />
        </div>
        <div className="mb-4">
          <VField
            name="confirm"
            label="New password, again"
            type="password"
            rules={[required('Type it once more')]}
          />
        </div>
        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          {!forced && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
            >
              Cancel
            </button>
          )}
          <button
            disabled={change.isPending}
            className="rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            {change.isPending ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </VForm>
    </div>
  );
}
