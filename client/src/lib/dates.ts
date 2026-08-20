import { useEffect, useState } from 'react';

/**
 * Today's date as `YYYY-MM-DD` in the user's own timezone.
 *
 * `new Date().toISOString()` converts to UTC first, so anywhere east of
 * Greenwich it returns *yesterday* for the first hours after local midnight —
 * long enough that opening the app late at night showed the wrong day. Shifting
 * by the offset before formatting keeps the calendar day the user is actually
 * living in. The server does the same thing for the same reason.
 */
export function localDateString(date: Date = new Date()): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .split('T')[0];
}

/**
 * Today's date, kept current while the app stays open.
 *
 * This is a desktop app people leave running, so "today" computed once at mount
 * is wrong the moment midnight passes — the calendar would keep highlighting
 * yesterday until the page was reloaded. Re-checks on a timer to the next local
 * midnight, and again whenever the window regains focus, which covers a laptop
 * that was asleep when the day turned over.
 */
export function useToday(): string {
  const [today, setToday] = useState(localDateString);

  useEffect(() => {
    let timer: number;

    const schedule = () => {
      setToday(localDateString());
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      // A second past midnight, so the tick can't land on the old day by rounding.
      timer = window.setTimeout(schedule, midnight.getTime() - now.getTime() + 1000);
    };
    schedule();

    const onFocus = () => setToday(localDateString());
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  return today;
}
