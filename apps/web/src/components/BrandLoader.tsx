import AzercellMark from './AzercellMark';

/** Full-screen "heartbeat" — the mark breathes in and out while the app
 * gets ready (session check, right after sign-in). */
export default function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ground"
    >
      <AzercellMark className="heartbeat w-24 text-accent" />
    </div>
  );
}
