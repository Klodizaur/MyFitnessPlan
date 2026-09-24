import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, Repeat, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fullscreenElement } from '../lib/fullscreen';
import { useIsMobile } from '../lib/useIsMobile';

/**
 * Loop setup for the player: play the same video N times, with a rest between
 * plays and another before the next video.
 *
 * A labelled pill in the player's top bar that turns accent-coloured and counts
 * "Loop 1 / 3" while a loop runs. It opens a popover over the video on desktop
 * and a bottom sheet on a phone.
 */

export const REST_PRESETS = [0, 30, 60, 90, 120];
export const MAX_LOOPS = 99;
const MIN_LOOPS = 2;

/** m:ss — the countdown never needs hours. */
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
  /** Rest after the LAST pass, before a different video from the plan starts. */
  nextRestSeconds: number;
  onApply: (loops: number, restSeconds: number, nextRestSeconds: number) => void;
  onClear: () => void;
  /** 1-based pass currently playing, for the pill's counter. */
  currentPass: number;
  /** Seconds left in the rest period, or null when not resting. */
  restLeft: number | null;
};

export default function LoopControl({ loops, restSeconds, nextRestSeconds, onApply, onClear, currentPass, restLeft }: Props) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [times, setTimes] = useState(loops || 3);
  const [rest, setRest] = useState(restSeconds);
  const [nextRest, setNextRest] = useState(nextRestSeconds);
  const wrapRef = useRef<HTMLDivElement>(null);
  const isActive = loops > 0;

  // Reopening should show what is currently set, not a stale draft from last time.
  useEffect(() => {
    if (!open) return;
    setTimes(loops || 3);
    setRest(restSeconds);
    setNextRest(nextRestSeconds);
  }, [open, loops, restSeconds, nextRestSeconds]);

  // Dismiss on Escape or a click outside, like the rest of the app's transient panels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('.pv-loop-panel')) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const submit = () => {
    onApply(Math.min(MAX_LOOPS, Math.max(MIN_LOOPS, times)), rest, nextRest);
    setOpen(false);
  };

  const label = isActive ? t('player.loop_pill_active', { current: currentPass, total: loops }) : t('player.loop_pill');
  // Deliberately free of the countdown value, so it is announced once per phase
  // rather than once per second.
  const statusLabel = isActive
    ? restLeft !== null
      ? t('player.loop_status_resting', { current: currentPass, total: loops })
      : t('player.loop_status_playing', { current: currentPass, total: loops })
    : '';

  const stepper = (
    <div className="pv-loop-row">
      <span>{t('player.loop_times_label')}</span>
      <button type="button" onClick={() => setTimes(v => Math.max(MIN_LOOPS, v - 1))} disabled={times <= MIN_LOOPS} aria-label={t('player.loop_fewer')}><Minus size={16} /></button>
      <strong>{times}</strong>
      <button type="button" onClick={() => setTimes(v => Math.min(MAX_LOOPS, v + 1))} disabled={times >= MAX_LOOPS} aria-label={t('player.loop_more')}><Plus size={16} /></button>
    </div>
  );

  const restRow = (text: string, value: number, set: (v: number) => void) => (
    <div className="pv-loop-field">
      <span>{text}</span>
      <div className="pv-seg" role="radiogroup" aria-label={text}>
        {REST_PRESETS.map(sec => (
          <button key={sec} type="button" role="radio" aria-checked={value === sec} className={value === sec ? 'is-on' : ''} onClick={() => set(sec)}>
            {formatRest(sec)}
          </button>
        ))}
      </div>
    </div>
  );

  const panel = (
    <div className={`pv-loop-panel${isMobile ? ' is-sheet' : ''}`} role="dialog" aria-label={t('player.loop_heading')} data-player-ui>
      {isMobile && <div className="pv-loop-grip" />}
      <div className="pv-loop-head">
        <h3>{t('player.loop_heading')}</h3>
        <button type="button" onClick={() => setOpen(false)} aria-label={t('profile.cancel')}><X size={16} /></button>
      </div>
      {stepper}
      {restRow(t('player.loop_rest_label'), rest, setRest)}
      {restRow(t('player.loop_next_rest_label'), nextRest, setNextRest)}
      <p className="pv-loop-hint">{t('player.loop_hint')}</p>
      <button type="button" className="pv-loop-go" onClick={submit}>
        <Repeat size={16} />{isActive ? t('player.loop_update') : t('player.loop_start')}
      </button>
      {isActive && (
        <button type="button" className="pv-loop-off" onClick={() => { onClear(); setOpen(false); }}>{t('player.loop_turn_off')}</button>
      )}
    </div>
  );

  return (
    // data-player-ui opts these controls out of the page's global media
    // shortcuts, so a click here doesn't seek or pause the video.
    <div className="pv-loop" ref={wrapRef} data-player-ui>
      <button
        type="button"
        className={`pv-pill${isActive ? ' is-on' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={isActive ? t('player.loop_edit_aria', { total: loops }) : t('player.loop_set_aria')}
      >
        <Repeat size={16} />
        <span>{label}</span>
      </button>
      <span className="sr-only" role="status">{statusLabel}</span>

      {open && (isMobile
        ? createPortal(
            <>
              <div className="pv-loop-scrim" onClick={() => setOpen(false)} />
              {panel}
            </>,
            // The fullscreen element, when there is one: anything outside it is invisible.
            (fullscreenElement() as HTMLElement | null) || document.body,
          )
        : panel)}
    </div>
  );
}
