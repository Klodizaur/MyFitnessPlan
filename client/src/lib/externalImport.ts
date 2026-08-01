import { useEffect, useRef, useState } from 'react';
import { Video } from '../types/video';

/** What a successful playlist import returns. */
export interface ImportResult {
  playlistTitle: string;
  truncated: boolean;
  importedCount: number;
  totalCount: number;
  videos: Video[];
}

/**
 * Whether playlist import is possible at all.
 *
 * Null while the check is in flight. A failed request counts as unavailable, so
 * a server without the endpoint — or one where the resolver has been removed
 * (see server/src/external/index.ts) — simply never shows the entry points.
 */
export function useImportAvailable(enabled = true): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled || available !== null) return;
    let cancelled = false;
    fetch('/api/external/status')
      .then(r => r.json())
      .then(data => { if (!cancelled) setAvailable(Boolean(data?.available)); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, [enabled, available]);

  return available;
}

/**
 * Re-run `onRefresh` while descriptions are still being fetched in the
 * background, then once more when they finish.
 *
 * Descriptions can't be part of the import response — they need a full
 * extraction per video, minutes for a large playlist — so without this they'd
 * only show up after the user happened to reload the page.
 *
 * @param active Set true after an import to start watching.
 */
export function useDescriptionProgress(active: boolean, onRefresh: () => void): number {
  const [pending, setPending] = useState(0);

  // Kept in a ref so a caller passing an inline function doesn't restart the
  // polling loop on every render.
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/external/descriptions-status');
        const data = await res.json();
        if (cancelled) return;

        const remaining = Number(data?.pending) || 0;
        setPending(remaining);
        refresh.current();

        // Stop once the queue is empty and no worker is still draining it.
        if (remaining === 0 && !data?.running) return;
      } catch {
        return; // Server unreachable; give up rather than spin.
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [active]);

  return pending;
}

/** Slow enough not to hammer the server, quick enough to feel live. */
const POLL_INTERVAL_MS = 4000;
