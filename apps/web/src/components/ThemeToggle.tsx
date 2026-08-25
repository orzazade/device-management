import { useEffect, useState } from 'react';

const KEY = 'devicedesk.theme';
type Theme = 'light' | 'dark';

const systemTheme = (): Theme =>
  matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const current = (): Theme =>
  (document.documentElement.dataset.theme as Theme | undefined) ?? systemTheme();

/** Eclipse switch: the sun slides behind a shadow disc and a moon is left
 * glowing. Until first use it follows the phone/PC setting; a click makes
 * the choice explicit and remembers it. */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(() => current());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    // No explicit choice yet → keep tracking the system setting.
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const follow = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem(KEY);
      } catch {
        /* storage blocked — nothing to read */
      }
      if (!saved) setTheme(mq.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', follow);
    return () => mq.removeEventListener('change', follow);
  }, []);

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
      className={`eclipse ${className}`}
    >
      <span className="corona" />
      <span className="disc" />
      <span className="shadow" />
    </button>
  );
}
