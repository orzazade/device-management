/** Full-screen "heartbeat" — the full Azercell logo breathes in and out
 * while the app gets ready (session check, right after sign-in). */
export default function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ground"
    >
      <img
        src="/azercell-logo.svg"
        alt="Azercell"
        // Element Timing mark — lets perf tools (and tests) see when the splash painted.
        {...{ elementtiming: 'brand-splash' }}
        className="brand-logo heartbeat w-56"
      />
    </div>
  );
}
