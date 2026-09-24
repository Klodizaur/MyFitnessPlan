import { ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight, CircleAlert, Clock, Moon, Play, Snowflake, Sun } from 'lucide-react';
import { useMetaLabels } from '../../lib/labels';
import { useIsMobile } from '../../lib/useIsMobile';
import { TagRow } from '../library/LibraryCards';
import {
  PlanSchedule, ScheduleDay, nextWorkoutAfter, parseDay, scheduleVideoTags, unionDates, workoutState,
} from './calendarModel';

interface Props {
  plans: PlanSchedule[];
  selectedDate: string;
  onSelect: (date: string) => void;
  today: string;
  onOpen: (videoId: string, workoutId: string) => void;
  onFreeze: (planId: string, date: string) => void;
  onUnfreeze: (planId: string, date: string) => void;
  /** `${planId}:${date}` of the day being unfrozen, so only its button disables. */
  busyKey: string | null;
}

const planTag = (slot: 'main' | 'extra') => (slot === 'main' ? 'main' : 'extra');

/**
 * The tape: a strip of day pills grouped into week bands, and beneath it the
 * open day — one card per plan that has something on it.
 */
export default function TapeView({ plans, selectedDate, onSelect, today, onOpen, onFreeze, onUnfreeze, busyKey }: Props) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  const dates = useMemo(() => unionDates(plans), [plans]);
  const byPlan = useMemo(
    () => plans.map(plan => ({ plan, days: new Map(plan.schedule.map(d => [d.date, d])) })),
    [plans]
  );

  // Grouped into 7-day blocks counted from the first day shown — the plan's own
  // start date, not the calendar week — so "Week 1" is the plan's first week.
  const weeks = useMemo(() => {
    const out: string[][] = [];
    dates.forEach((date, i) => {
      const w = Math.floor(i / 7);
      (out[w] ||= []).push(date);
    });
    return out;
  }, [dates]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    // Only when the day changes — not on every render, which would fight the
    // user's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const scrollBy = (dir: 1 | -1) => scrollerRef.current?.scrollBy({ left: dir * 420, behavior: 'smooth' });

  const fmt = (date: string, options: Intl.DateTimeFormatOptions) =>
    parseDay(date).toLocaleDateString(i18n.language, options);

  const dayMarks = (date: string, selected: boolean) => {
    const marks: ReactElement[] = [];
    for (const { plan, days } of byPlan) {
      const day = days.get(date);
      if (!day) continue;
      if (day.frozen) {
        marks.push(<Snowflake key={plan.planId} size={12} className={`cal-mark cal-mark--frozen${selected ? ' is-sel' : ''}`} />);
      } else if (day.isWorkoutDay) {
        marks.push(day.workout?.isCompleted
          ? <Check key={plan.planId} size={12} strokeWidth={3} className={`cal-mark cal-mark--done${selected ? ' is-sel' : ''}`} />
          : <span key={plan.planId} className={`cal-dot cal-dot--${planTag(plan.slot)}`} />);
      }
    }
    return marks;
  };

  return (
    <div className="cal-tape">
      <div className="cal-strip rx-card">
        <div className="cal-strip-head">
          <div className="cal-strip-month">{fmt(selectedDate, { month: 'long', year: 'numeric' })}</div>
          <button type="button" className="cal-mini-btn" onClick={() => onSelect(today)}>{t('calendar.today')}</button>
          {!isMobile && (
            <>
              <button type="button" className="cal-mini-icon" aria-label={t('calendar.scroll_back')} onClick={() => scrollBy(-1)}>
                <ChevronLeft size={17} />
              </button>
              <button type="button" className="cal-mini-icon" aria-label={t('calendar.scroll_forward')} onClick={() => scrollBy(1)}>
                <ChevronRight size={17} />
              </button>
            </>
          )}
        </div>

        <div className="cal-scroller" ref={scrollerRef} role="tablist" aria-label={t('calendar.day')}>
          {weeks.map((week, w) => (
            <div key={w} className={`cal-week${w % 2 ? ' is-even' : ''}`}>
              <div className="cal-week-label">{t('calendar.week_label', { number: w + 1 })}</div>
              <div className="cal-week-days">
                {week.map(date => {
                  const selected = date === selectedDate;
                  return (
                    <button
                      key={date}
                      ref={selected ? selectedRef : undefined}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`cal-pill${selected ? ' is-sel' : ''}${date === today ? ' is-today' : ''}${date < today ? ' is-past' : ''}`}
                      onClick={() => onSelect(date)}
                      title={fmt(date, { weekday: 'long', month: 'short', day: 'numeric' })}
                    >
                      <span className="cal-pill-dow">{fmt(date, { weekday: 'narrow' })}</span>
                      <span className="cal-pill-num">{parseDay(date).getDate()}</span>
                      <span className="cal-pill-marks">{dayMarks(date, selected)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cal-sel">
        <span className="cal-sel-dow">
          {fmt(selectedDate, { weekday: 'long' }).toUpperCase()}
          {selectedDate === today && ` · ${t('calendar.today').toUpperCase()}`}
        </span>
        <span className="cal-sel-date">{fmt(selectedDate, { day: 'numeric', month: 'long' })}</span>
      </div>

      <div className="cal-entries">
        {byPlan.map(({ plan, days }) => {
          const day = days.get(selectedDate);
          if (!day) return null;
          const key = `${plan.planId}:${selectedDate}`;

          if (day.frozen || !day.isWorkoutDay) {
            const next = nextWorkoutAfter(plan, selectedDate);
            return (
              <RestEntry
                key={key}
                plan={plan}
                frozen={Boolean(day.frozen)}
                note={next
                  ? t(day.frozen ? 'calendar.workouts_continue' : 'calendar.next_workout', {
                      date: fmt(next, { weekday: 'long', day: 'numeric', month: 'short' }),
                    })
                  : ''}
                busy={busyKey === key}
                onUnfreeze={() => onUnfreeze(plan.planId, selectedDate)}
              />
            );
          }

          return (
            <WorkoutEntry
              key={key}
              plan={plan}
              day={day}
              today={today}
              onOpen={onOpen}
              onFreeze={() => onFreeze(plan.planId, selectedDate)}
            />
          );
        })}

        {byPlan.every(({ days }) => !days.has(selectedDate)) && (
          <div className="cal-none">{t('calendar.no_workouts_day')}</div>
        )}
      </div>
    </div>
  );
}

function PlanLine({ plan, suffix }: { plan: PlanSchedule; suffix?: string }) {
  const { t } = useTranslation();
  return (
    <div className="cal-planline">
      <span className={`rx-badge rx-badge--${planTag(plan.slot)}`}>{t(plan.slot === 'main' ? 'calendar.plan_main' : 'calendar.plan_extra')}</span>
      <span className="cal-planline-name">{plan.planName}{suffix ? ` · ${suffix}` : ''}</span>
    </div>
  );
}

function RestEntry({ plan, frozen, note, busy, onUnfreeze }: {
  plan: PlanSchedule; frozen: boolean; note: string; busy: boolean; onUnfreeze: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="cal-entry cal-entry--rest rx-card">
      <div className={`cal-rest-icon${frozen ? ' is-frozen' : ''}`}>{frozen ? <Snowflake size={22} /> : <Moon size={22} />}</div>
      <div className="cal-rest-text">
        <PlanLine plan={plan} />
        <div className="cal-rest-title">{t(frozen ? 'calendar.frozen' : 'calendar.rest_day')}</div>
        {note && <div className="cal-rest-note">{note}</div>}
      </div>
      {frozen && (
        <button type="button" className="cal-ghost-btn" disabled={busy} onClick={onUnfreeze}>
          {t('calendar.unfreeze_button')}
        </button>
      )}
    </div>
  );
}

function WorkoutEntry({ plan, day, today, onOpen, onFreeze }: {
  plan: PlanSchedule; day: ScheduleDay; today: string;
  onOpen: (videoId: string, workoutId: string) => void; onFreeze: () => void;
}) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const s = workoutState(plan, day, today);
  const { workout, videos, titles, done, multi, isToday, isPast, daysAway } = s;

  // Opens on the first part still to do; the arrows browse the rest. The title,
  // tags, length and button all follow the part on screen.
  const [part, setPart] = useState(s.current);
  const index = Math.min(part, Math.max(videos.length - 1, 0));
  const video = videos[index];
  const step = (delta: number) => setPart((index + delta + videos.length) % videos.length);

  const partMin = video?.duration ? Math.round(video.duration / 60) : null;
  const shownMin = multi ? partMin : s.totalMin;
  const durLabel = shownMin ? `${shownMin} ${t('calendar.duration_min')}` : '';

  const status = done
    ? { label: t('calendar.done'), Icon: Check, tone: 'done' }
    : isToday
      ? { label: t('calendar.today'), Icon: Sun, tone: 'today' }
      : isPast
        ? { label: t('calendar.missed'), Icon: CircleAlert, tone: 'past' }
        : { label: daysAway === 1 ? t('calendar.tomorrow') : t('calendar.in_days', { count: daysAway }), Icon: Clock, tone: 'future' };

  const tags = video ? scheduleVideoTags(video, labels) : [];
  const partDone = Boolean(video?.isCompleted);
  const buttonLabel = partDone
    ? (multi ? t('calendar.review_part_plain', { index: index + 1 }) : t('calendar.review_workout_plain'))
    : multi
      ? t('calendar.play_part_plain', { index: index + 1 })
      : t('calendar.start_workout_plain');

  return (
    <div className="cal-entry rx-card">
      <div className="cal-entry-media">
        {video?.thumbnail
          ? <img src={`/thumbnails/${video.thumbnail}`} alt="" />
          : <div className="cal-entry-noimg">{t('calendar.no_preview')}</div>}
        <span className={`cal-status cal-status--${status.tone}`}>
          <status.Icon size={13} />
          {status.label}
        </span>
        {durLabel && <span className="cal-entry-dur">{durLabel}</span>}

        {multi && (
          // One control, not three scattered pieces: the arrows flank the label.
          <div className="cal-entry-switch">
            <button type="button" aria-label={t('calendar.prev_part')} onClick={() => step(-1)}>
              <ChevronLeft size={16} />
            </button>
            <span>{t('calendar.part_of', { index: index + 1, total: videos.length })}</span>
            <button type="button" aria-label={t('calendar.next_part')} onClick={() => step(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      <div className="cal-entry-body">
        <PlanLine plan={plan} suffix={`${s.position}/${s.total}`} />
        <div className="cal-entry-title">{titles[index] || workout.name}</div>

        <TagRow tags={tags} rows={2} />

        <div className="cal-entry-spacer" />
        {video ? (
          <div className="cal-entry-actions">
            <button
              type="button"
              className={`cal-play${partDone ? ' is-done' : isToday ? ' is-today' : ''}`}
              onClick={() => onOpen(video.id, workout.id)}
            >
              {partDone ? <Check size={16} /> : <Play size={16} />}
              {buttonLabel}
            </button>
            {!done && day.date >= today && (
              <button type="button" className="cal-freeze" onClick={onFreeze}>
                <Snowflake size={16} />
                {t('plans.freeze')}
              </button>
            )}
          </div>
        ) : (
          <div className="cal-rest-note">{t('calendar.no_video_matched')}</div>
        )}
      </div>
    </div>
  );
}
