/** Full-screen "heartbeat" — the full Azercell logo breathes in and out
 * while the app gets ready (session check, right after sign-in). */
export default function BrandLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ground"
    >
      <span className="brand-logo heartbeat block w-56">
        <img
          src="/azercell-logo.svg"
          alt="Azercell"
          // Element Timing mark — lets perf tools (and tests) see when the splash painted.
          {...{ elementtiming: 'brand-splash' }}
          className="logo-light w-full"
        />
        <img src="/azercell-logo-dark.svg" alt="" aria-hidden="true" className="logo-dark w-full" />
      </span>
    </div>
  );
}
