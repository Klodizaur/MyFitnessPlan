/**
 * Pop-up showing a running description clean-up.
 *
 * Mounted once at the app root so a run started on an album page keeps
 * reporting while the user browses elsewhere — the job lives on the server, so
 * navigating away (or reloading) never loses it. Renders nothing at all when
 * there is no job, which is the normal state.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, Minus, Sparkles, X } from 'lucide-react';
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
  const failedRun = finished && (Boolean(job.error) || (job.total > 0 && job.changed === 0 && job.failed > 0));

  /** Clearing the job server-side is what makes the pop-up stay gone. */
  const dismiss = async () => {
    setJob(null);
    await fetch('/api/ai/clean-descriptions/dismiss', { method: 'POST' }).catch(() => {});
  };

  const cancel = async () => {
    await fetch('/api/ai/clean-descriptions/cancel', { method: 'POST' }).catch(() => {});
  };

  if (minimized) {
    return createPortal(
      <button type="button" className="job-pill" onClick={() => setMinimized(false)} title={t('ai.cleanup_expand')}>
        {failedRun ? <CircleAlert size={15} /> : finished ? <Check size={15} /> : <Sparkles size={15} />}
        {finished ? t('ai.cleanup_short') : `${percent}% ${t('ai.cleanup_short')}`}
      </button>,
      document.body
    );
  }

  return createPortal(
    <div className={`job${failedRun ? ' is-error' : ''}`} role="status" aria-live="polite">
      <div className="job-head">
        <span className="job-icon">{failedRun ? <CircleAlert size={18} /> : finished ? <Check size={18} /> : <Sparkles size={18} />}</span>
        <div className="job-title">
          <strong>{t('ai.cleanup_title')}</strong>
          {job.label && <span>{job.label}</span>}
        </div>
        <button type="button" className="job-btn" onClick={() => setMinimized(true)} title={t('ai.cleanup_minimize')} aria-label={t('ai.cleanup_minimize')}>
          <Minus size={16} />
        </button>
        {/* Closing mid-run would leave a job with no way back to it, so the
            close button only appears once there is nothing left to watch. */}
        {finished && (
          <button type="button" className="job-btn" onClick={dismiss} title={t('ai.cleanup_close')} aria-label={t('ai.cleanup_close')}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="job-bar"><span className={finished ? 'is-done' : ''} style={{ width: `${percent}%` }} /></div>

      <div className="job-count">
        {job.running
          ? t('ai.cleanup_progress', { done: job.done, total: job.total })
          : job.cancelled
            ? t('ai.cleanup_stopped', { done: job.done, total: job.total })
            : t('ai.cleanup_done', { changed: job.changed, total: job.total })}
        {job.failed > 0 && ` · ${t('ai.cleanup_failed', { count: job.failed })}`}
      </div>
      {job.error && <div className="job-error">{job.error}</div>}

      {job.running && !job.cancelled && (
        <button type="button" className="job-stop" onClick={cancel}>{t('ai.cleanup_stop')}</button>
      )}
    </div>,
    document.body
  );
}
