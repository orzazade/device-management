/** Official Azercell logo with "Device Manager" set exactly under the
 * wordmark (the right 64% of the logo). One component, used on the login
 * card and in the sidebar, so the two never drift apart. */
export default function BrandLockup({
  logoClass = 'h-12',
  textClass = 'text-[14px]',
  className = '',
}: {
  logoClass?: string;
  textClass?: string;
  className?: string;
}) {
  return (
    // Logo keeps its official colour (#5c2d91); the line under it uses that
    // same purple and shares the wrapper's dark-mode lift, so they always match.
    <div className={`brand-logo inline-flex flex-col items-end text-[#5c2d91] ${className}`}>
      <img src="/azercell-logo.svg" alt="Azercell" className={`logo-light ${logoClass}`} />
      <img src="/azercell-logo-dark.svg" alt="" aria-hidden="true" className={`logo-dark ${logoClass}`} />
      <span
        className={`mt-0.5 w-[64%] whitespace-nowrap text-right font-medium leading-none tracking-tight ${textClass}`}
      >
        Device Manager
      </span>
    </div>
  );
}
