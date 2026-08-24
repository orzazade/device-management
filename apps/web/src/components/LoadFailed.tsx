/** Inline error state for a failed data fetch. "Failed to look" must never
 * render like "found nothing" — every list view uses this on isError. */
export default function LoadFailed({
  what = 'data',
  onRetry,
}: {
  what?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
      <span>
        <b>Couldn’t load {what}.</b> What you see may be incomplete — this is a
        loading error, not an empty list.
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100"
      >
        Retry
      </button>
    </div>
  );
}
