import { useEffect, useState } from 'react';

/**
 * Whether the optional AI integration is configured.
 *
 * Mirrors `useImportAvailable`: null while the check is in flight, and a failed
 * request counts as unavailable — so a server without the endpoint (or one
 * where server/src/ai/ has been removed) simply never shows the entry points.
 *
 * @param enabled Defer the check until the caller actually needs the answer.
 */
export function useAiAvailable(enabled = true): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(data => { if (!cancelled) setAvailable(Boolean(data?.available)); })
      .catch(() => { if (!cancelled) setAvailable(false); });
    return () => { cancelled = true; };
  }, [enabled]);

  return available;
}
