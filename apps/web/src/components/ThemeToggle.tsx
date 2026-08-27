import { useEffect, useState } from 'react';

const KEY = 'devicedesk.theme';
type Theme = 'light' | 'dark';

/** Light unless the person explicitly chose dark (index.html applies the same
 * rule before first paint). */
const current = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/** Eclipse switch: the sun slides behind a shadow disc and a moon is left
 * glowing. The choice is remembered on this device. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => current());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const flip = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked — the choice lasts for this page only */
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      onClick={flip}
      data-testid="theme-toggle"
      className={`eclipse ${className}`}
    >
      <span className="corona" />
      <span className="disc" />
      <span className="shadow" />
    </button>
  );
}
