/**
 * Corner panel showing a running description clean-up.
 *
 * Mounted once at the app root so a run started on an album page keeps
 * reporting while the user browses elsewhere — the job lives on the server, so
 * navigating away (or reloading) never loses it. Renders nothing at all when
 * there is no job, which is the normal state.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/AiPlan.css';

interface CleanJob {
  id: string;
  label: string;
  total: number;
  done: number;
  failed: number;
  changed: number;
  running: boolean;
  cancelled: boolean;
  error: string | null;
}

/** Brisk enough to feel live, slow enough not to hammer the server. */
const POLL_MS = 1500;

export default function AiCleanupProgress() {
  const { t } = useTranslation();
  const [job, setJob] = useState<CleanJob | null>(null);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch('/api/ai/clean-descriptions/status');
        const data = await res.json();
        if (cancelled) return;
        setJob(data?.job ?? null);
      } catch {
        // Server unreachable; try again on the next tick rather than giving up,
        // since a dev-server restart shouldn't kill the panel permanently.
      }
      timer = setTimeout(poll, POLL_MS);
    };

    poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // A new run should always be visible, even if the last one was minimized.
  useEffect(() => { setMinimized(false); }, [job?.id]);

  if (!job) return null;

  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 100;
  const finished = !job.running;

  /** Clearing the job server-side is what makes the panel stay gone. */
  const dismiss = async () => {
    setJob(null);
    await fetch('/api/ai/clean-descriptions/dismiss', { method: 'POST' }).catch(() => {});
  };

  const cancel = async () => {
    await fetch('/api/ai/clean-descriptions/cancel', { method: 'POST' }).catch(() => {});
  };

  if (minimized) {
    return (
      <button
        type="button"
        className="ai-job-pill"
        onClick={() => setMinimized(false)}
        title={t('ai.cleanup_expand')}
      >
        {finished ? '✓' : `${percent}%`} {t('ai.cleanup_short')}
      </button>
    );
  }

  return (
    <div className="ai-job-panel" role="status" aria-live="polite">
      <div className="ai-job-head">
        <strong className="ai-job-title">{t('ai.cleanup_title')}</strong>
        <div className="ai-job-head-actions">
          <button type="button" onClick={() => setMinimized(true)} title={t('ai.cleanup_minimize')}>–</button>
          {/* Closing mid-run would leave a job with no way back to it, so the
              close button only appears once there is nothing left to watch. */}
          {finished && (
            <button type="button" onClick={dismiss} title={t('ai.cleanup_close')}>✕</button>
          )}
        </div>
      </div>

      {job.label && <p className="ai-job-label">{job.label}</p>}

      <div className="ai-job-bar">
        <div className={`ai-job-bar-fill${finished ? ' done' : ''}`} style={{ width: `${percent}%` }} />
      </div>

      <p className="ai-job-count">
        {job.running
          ? t('ai.cleanup_progress', { done: job.done, total: job.total })
          : job.cancelled
            ? t('ai.cleanup_stopped', { done: job.done, total: job.total })
            : t('ai.cleanup_done', { changed: job.changed, total: job.total })}
      </p>

      {job.failed > 0 && (
        <p className="ai-job-note">{t('ai.cleanup_failed', { count: job.failed })}</p>
      )}
      {job.error && <p className="ai-job-error">{job.error}</p>}

      {job.running && !job.cancelled && (
        <button type="button" className="ai-job-stop" onClick={cancel}>
          {t('ai.cleanup_stop')}
        </button>
      )}
    </div>
  );
}
