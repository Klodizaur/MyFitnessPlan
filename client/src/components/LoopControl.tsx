import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Loop setup for the player: play the same video N times, with an optional rest
 * between passes.
 *
 * The button lives in the theater header next to "Mark as Done" / "Close", so it
 * is icon-only until a loop is running — once it is, a separate status chip
 * carries the pass counter and the rest countdown rather than growing the
 * button, which keeps the click target from moving under the cursor.
 */

export const REST_PRESETS = [30, 60, 90, 120];
export const MAX_LOOPS = 99;
export const MAX_REST_SECONDS = 3600;

/** mm:ss — the countdown never needs hours (rest is capped at an hour). */
export function formatRest(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

type Props = {
  /** Configured total passes; 0 means looping is off. */
  loops: number;
  restSeconds: number;
  onApply: (loops: number, restSeconds: number) => void;
  onClear: () => void;
  /** 1-based pass currently playing, for the counter chip. */
  currentPass: number;
  /** Seconds left in the rest period, or null when not resting. */
  restLeft: number | null;
};

export default function LoopControl({ loops, restSeconds, onApply, onClear, currentPass, restLeft }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [loopDraft, setLoopDraft] = useState(String(loops || 3));
  const [restDraft, setRestDraft] = useState(String(restSeconds));
  const wrapRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  const isActive = loops > 0;

  // Reopening should show what is currently set, not a stale draft from last time.
  useEffect(() => {
    if (!open) return;
    setLoopDraft(String(loops || 3));
    setRestDraft(String(restSeconds));
    firstFieldRef.current?.focus();
    firstFieldRef.current?.select();
  }, [open, loops, restSeconds]);

  // Dismiss on Escape or a click outside, the way the rest of the app's
  // transient panels behave.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const clampInt = (raw: string, min: number, max: number, fallback: number) => {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(clampInt(loopDraft, 1, MAX_LOOPS, 1), clampInt(restDraft, 0, MAX_REST_SECONDS, 0));
    setOpen(false);
  };

  // Deliberately free of the countdown value, so it is announced once per phase
  // rather than once per second.
  const statusLabel = isActive
    ? restLeft !== null
      ? t('player.loop_status_resting', { current: currentPass, total: loops })
      : t('player.loop_status_playing', { current: currentPass, total: loops })
    : '';

  return (
    // data-player-ui opts these controls out of the page's global media
    // shortcuts, so typing a number here doesn't seek or pause the video.
    <div className="player-loop" ref={wrapRef} data-player-ui>
      <button
        type="button"
        className={`player-loop-btn${isActive ? ' is-active' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={isActive ? t('player.loop_edit_aria', { total: loops }) : t('player.loop_set_aria')}
        title={isActive ? t('player.loop_edit_aria', { total: loops }) : t('player.loop_set_aria')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      </button>

      {isActive && (
        <div className={`player-loop-status${restLeft !== null ? ' is-resting' : ''}`}>
          {/* The countdown is hidden from assistive tech: inside a live region a
              ticking clock would be announced every single second. The spoken
              status below changes only when the pass or the phase does. */}
          <span aria-hidden="true" className="player-loop-count">
            {currentPass}<span className="player-loop-sep">/</span>{loops}
          </span>
          {restLeft !== null && (
            <span aria-hidden="true" className="player-loop-timer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {formatRest(restLeft)}
            </span>
          )}
          <span className="sr-only" role="status">{statusLabel}</span>
        </div>
      )}

      {open && (
        <form className="player-loop-pop" role="dialog" aria-label={t('player.loop_heading')} onSubmit={submit}>
          <h3 className="player-loop-pop-title">{t('player.loop_heading')}</h3>

          <label className="player-loop-field">
            <span>{t('player.loop_times_label')}</span>
            <input
              ref={firstFieldRef}
              type="number"
              min={1}
              max={MAX_LOOPS}
              step={1}
              inputMode="numeric"
              value={loopDraft}
              onChange={e => setLoopDraft(e.target.value)}
            />
          </label>

          <label className="player-loop-field">
            <span>{t('player.loop_rest_label')}</span>
            <input
              type="number"
              min={0}
              max={MAX_REST_SECONDS}
              // Any whole number of seconds is allowed. A coarser step would
              // fail constraint validation for a typed value like 47 and block
              // the submit with no visible reason; the presets cover the
              // common durations instead.
              step={1}
              inputMode="numeric"
              value={restDraft}
              onChange={e => setRestDraft(e.target.value)}
            />
          </label>

          <div className="player-loop-presets">
            {REST_PRESETS.map(sec => (
              <button
                key={sec}
                type="button"
                className={`player-loop-preset${Number(restDraft) === sec ? ' is-on' : ''}`}
                onClick={() => setRestDraft(String(sec))}
              >
                {formatRest(sec)}
              </button>
            ))}
          </div>

          <p className="player-loop-hint">{t('player.loop_hint')}</p>

          <div className="player-loop-pop-actions">
            {isActive && (
              <button
                type="button"
                className="player-loop-pop-btn"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
              >
                {t('player.loop_turn_off')}
              </button>
            )}
            <button type="submit" className="player-loop-pop-btn is-primary">
              {isActive ? t('player.loop_update') : t('player.loop_start')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
