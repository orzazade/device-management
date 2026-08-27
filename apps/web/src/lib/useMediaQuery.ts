import { useEffect, useState } from 'react';

/** True when the media query matches; re-evaluates on resize/rotation. */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof matchMedia === 'function' ? matchMedia(query).matches : true);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
