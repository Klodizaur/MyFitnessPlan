import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, Clock, Moon, Play, Snowflake, Sun, X } from 'lucide-react';
import { useMetaLabels } from '../../lib/labels';
import { TagRow } from '../library/LibraryCards';
import { PlanSchedule, nextWorkoutAfter, parseDay, scheduleVideoTags, workoutState } from './calendarModel';

interface Props {
  date: string;
  plans: PlanSchedule[];
  today: string;
  onClose: () => void;
  onOpen: (videoId: string, workoutId: string) => void;
  onFreeze: (planId: string, date: string) => void;
  onUnfreeze: (planId: string, date: string) => void;
  busyKey: string | null;
}

/** A day's details: a bottom sheet on a phone, a centred card on desktop. One card per plan. */
export default function DayDetails({ date, plans, today, onClose, onOpen, onFreeze, onUnfreeze, busyKey }: Props) {
  const { t, i18n } = useTranslation();
  const labels = useMetaLabels();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fmt = (d: string, options: Intl.DateTimeFormatOptions) => parseDay(d).toLocaleDateString(i18n.language, options);
  const entries = plans.flatMap(plan => {
    const day = plan.schedule.find(d => d.date === date);
    return day ? [{ plan, day }] : [];
  });

  return createPortal(
    <>
      <div className="cal-backdrop" onClick={onClose} />
      <div className="cal-sheet" role="dialog" aria-modal="true">
        <div className="cal-sheet-grab" />
        <div className="cal-sheet-head">
          <div className="cal-sheet-title">
            <div className="cal-sheet-dow">
              {fmt(date, { weekday: 'long' }).toUpperCase()}{date === today && ` · ${t('calendar.today').toUpperCase()}`}
            </div>
            <div className="cal-sheet-date">{fmt(date, { day: 'numeric', month: 'long' })}</div>
          </div>
          <button type="button" className="cal-sheet-close" onClick={onClose} aria-label={t('library.close')}><X size={18} /></button>
        </div>

        <div className="cal-sheet-body">
          {entries.map(({ plan, day }) => {
            const key = `${plan.planId}:${date}`;
            const badge = (
              <span className={`rx-badge rx-badge--${plan.slot}`}>{t(plan.slot === 'main' ? 'calendar.plan_main' : 'calendar.plan_extra')}</span>
            );

            if (day.frozen || !day.isWorkoutDay || !day.workout) {
              const frozen = Boolean(day.frozen);
              const next = nextWorkoutAfter(plan, date);
              return (
                <div key={key} className="cal-sd-card">
                  <div className="cal-sd-plan">{badge}<span className="cal-sd-plan-name">{plan.planName}</span></div>
                  <div className="cal-sd-rest">
                    <div className={`cal-rest-icon${frozen ? ' is-frozen' : ''}`}>{frozen ? <Snowflake size={20} /> : <Moon size={20} />}</div>
                    <div className="cal-rest-text">
                      <div className="cal-rest-title">{t(frozen ? 'calendar.frozen' : 'calendar.rest_day')}</div>
                      {next && <div className="cal-rest-note">
                        {t(frozen ? 'calendar.workouts_continue' : 'calendar.next_workout', { date: fmt(next, { weekday: 'long', day: 'numeric', month: 'short' }) })}
                      </div>}
                    </div>
                    {frozen && (
                      <button type="button" className="cal-ghost-btn" disabled={busyKey === key} onClick={() => onUnfreeze(plan.planId, date)}>
                        {t('calendar.unfreeze_button')}
                      </button>
                    )}
                  </div>
                </div>
              );
            }

            const s = workoutState(plan, day, today);
            const status = s.done
              ? { label: t('calendar.done'), Icon: Check, tone: 'done' }
              : s.isToday ? { label: t('calendar.today'), Icon: Sun, tone: 'today' }
              : s.isPast ? { label: t('calendar.missed'), Icon: CircleAlert, tone: 'past' }
              : { label: s.daysAway === 1 ? t('calendar.tomorrow') : t('calendar.in_days', { count: s.daysAway }), Icon: Clock, tone: 'future' };
            const tags = s.videos[s.current] ? scheduleVideoTags(s.videos[s.current], labels) : [];
            const video = s.videos[s.current];

            return (
              <div key={key} className="cal-sd-card">
                <div className="cal-sd-plan">
                  {badge}
                  <span className="cal-sd-plan-name">{plan.planName} · {s.position}/{s.total}</span>
                  <span className={`cal-sd-status cal-sd-status--${status.tone}`}><status.Icon size={13} />{status.label}</span>
                </div>
                <div className="cal-sd-parts">
                  {s.videos.map((v, i) => (
                    <div key={v.id + i} className="cal-sd-part">
                      {v.thumbnail ? <img src={`/thumbnails/${v.thumbnail}`} alt="" /> : <span className="cal-sd-part-empty" />}
                      <div className="cal-sd-part-text">
                        {s.multi && <div className="cal-sd-part-n">{t('calendar.part_chip', { index: i + 1 })}</div>}
                        <div className="cal-sd-part-title">{s.titles[i]}</div>
                        {v.duration ? <div className="cal-sd-part-dur">{Math.round(v.duration / 60)} {t('calendar.duration_min')}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
                <TagRow tags={tags} rows={2} />
                {video ? (
                  <div className="cal-entry-actions">
                    <button
                      type="button"
                      className={`cal-play${s.done ? ' is-done' : s.isToday ? ' is-today' : ''}`}
                      onClick={() => onOpen(video.id, s.workout.id)}
                    >
                      {s.done ? <Check size={16} /> : <Play size={16} />}
                      {s.done ? t('calendar.review_workout_plain') : s.multi ? t('calendar.play_part_plain', { index: s.current + 1 }) : t('calendar.start_workout_plain')}
                    </button>
                    {!s.done && date >= today && (
                      <button type="button" className="cal-freeze" onClick={() => onFreeze(plan.planId, date)}>
                        <Snowflake size={16} />{t('plans.freeze')}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="cal-rest-note">{t('calendar.no_video_matched')}</div>
                )}
              </div>
            );
          })}
          {entries.length === 0 && <div className="cal-none">{t('calendar.no_workouts_day')}</div>}
        </div>
      </div>
    </>,
    document.body
  );
}
