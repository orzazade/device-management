/** The Azercell "a" mark as an inline SVG so it takes `currentColor` —
 * white on the sidebar tile, brand purple in the loader, readable in dark. */
export default function AzercellMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 97.4 73.3" className={className} aria-hidden="true" fill="currentColor">
      <path d="M67 46.7s-1.5 15.5-1.9 18.2h5.2s.6-4.2 2-16.1c.3-2.2.6-6.5.6-6.5z" opacity=".7" />
      <path d="M52.7 7c6.6-1.4 11.7 1.3 13.8 14.6.6 3.9.9 8.5.9 12.9 2-1.6 3.9-3.1 5.7-4.6v-.2c-.2-5.3-.8-10.4-1.9-15.2C69 4.3 62.5 0 55.8 0c-.9 0-1.8.1-2.8.3z" opacity=".85" />
      <path d="M55.9 0c-7.7 0-21.8 6.6-36 22.1C3.8 39.5 0 53.2 0 60.4c0 7.2 4.8 12.9 13.4 12.9 8.6 0 22.6-5.5 43.3-19.4C77.4 40 97.4 22.6 97.4 22.6l-4.3-9.9c-4.4 3.6-24 22.4-50.1 39.2C18 68 10 65.4 8.9 63.3 8 61.6 6.1 55.4 16.3 39s26-28 34-31.1c2-.8 3.8-1.2 5.5-1.3l.1-6.6z" />
    </svg>
  );
}
