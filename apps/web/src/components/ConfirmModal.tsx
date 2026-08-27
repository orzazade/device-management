import Modal from './Modal';

export default function ConfirmModal({
  title,
  body,
  confirmLabel = 'Yes, delete',
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Nothing typed in here — backdrop click may close it.
  return (
    <Modal onClose={onClose} closeOnBackdrop z="z-[60]">
      <div className="w-full max-w-sm self-center rounded-2xl bg-white p-6">
        <h2 className="mb-2 text-lg font-bold">{title}</h2>
        <p className="mb-5 text-neutral-600">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            data-testid="confirm-cancel"
            className="rounded-lg border border-neutral-300 px-4 py-2 font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            data-testid="confirm-button"
            className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
