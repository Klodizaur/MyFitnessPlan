import { useEffect, useState } from 'react';

/**
 * The redesign gives every screen two layouts and switches at 768px — the
 * prototypes' `mobile` flag. Plenty of the difference is structural (a bottom
 * tab bar instead of a nav card, a sheet instead of a centred modal, a strip
 * instead of a grid), so screens need it in JS, not only in media queries.
 */
const QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    // Re-read on mount: the value could have changed between first render and
    // the effect (a rotation, or the desktop window being resized).
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
