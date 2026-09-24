import { MouseEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight, Moon, Play, Snowflake } from 'lucide-react';
import { useMetaLabels } from '../../lib/labels';
import { TagRow } from '../library/LibraryCards';
import { PlanSchedule, ScheduleDay, parseDay, scheduleVideoTags, unionDates, workoutState } from './calendarModel';

interface Props {
  plans: PlanSchedule[];
  today: string;
  onOpen: (videoId: string, workoutId: string) => void;
  onDetails: (date: string) => void;
}

interface Card {
  date: string;
  plan: PlanSchedule;
  day: ScheduleDay;
  kind: 'workout' | 'rest' | 'frozen';
}

/** Weeks as bands, each holding a real card grid: one card per workout. */
export default function GridView({ plans, today, onOpen, onDetails }: Props) {
  const { t, i18n } = useTranslation();
  const [parts, setParts] = useState<Record<string, number>>({});

  const dates = useMemo(() => unionDates(plans), [plans]);
  const lookups = useMemo(() => plans.map(plan => ({ plan, days: new Map(plan.schedule.map(d => [d.date, d])) })), [plans]);
  const weeks = useMemo(() => {
    const out: string[][] = [];
    dates.forEach((date, i) => { (out[Math.floor(i / 7)] ||= []).push(date); });
    return out;
  }, [dates]);

  const fmt = (date: string, options: Intl.DateTimeFormatOptions) => parseDay(date).toLocaleDateString(i18n.language, options);

  /** A day with workouts gets a card each; a day without gets a single rest or frozen card. */
  const cardsFor = (date: string): Card[] => {
    const all: Card[] = [];
    for (const { plan, days } of lookups) {
      const day = days.get(date);
      if (!day) continue;
      all.push({ date, plan, day, kind: day.frozen ? 'frozen' : day.isWorkoutDay && day.workout ? 'workout' : 'rest' });
    }
    if (all.some(c => c.kind === 'workout')) return all.filter(c => c.kind === 'workout');
    return all.filter((c, i, arr) => arr.findIndex(o => o.kind === c.kind) === i);
  };

  return (
    <div className="cal-weeks">
      {weeks.map((week, w) => {
        const cards = week.flatMap(cardsFor);
        const workouts = cards.filter(c => c.kind === 'workout');
        const doneCount = workouts.filter(c => c.day.workout?.isCompleted).length;
        return (
          <section key={w} className={`cal-wk${w % 2 ? ' is-even' : ''}`}>
            <div className="cal-wk-head">
              <span className="cal-wk-label">{t('calendar.week_label', { number: w + 1 })}</span>
              <span className="cal-wk-range">{fmt(week[0], { day: 'numeric', month: 'short' })} – {fmt(week[week.length - 1], { day: 'numeric', month: 'short' })}</span>
              <span className="cal-wk-progress">{t('calendar.week_progress', { done: doneCount, total: workouts.length })}</span>
            </div>
            <div className="cal-gr">
              {cards.map(card => (
                <GridCard
                  key={`${card.date}:${card.plan.planId}:${card.kind}`}
                  card={card}
                  today={today}
                  dateLabel={fmt(card.date, { day: 'numeric', month: 'short' })}
                  dow={fmt(card.date, { weekday: 'short' })}
                  part={parts[`${card.date}:${card.plan.planId}`]}
                  setPart={v => setParts(prev => ({ ...prev, [`${card.date}:${card.plan.planId}`]: v }))}
                  onOpen={onOpen}
                  onDetails={() => onDetails(card.date)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function GridCard({ card, today, dateLabel, dow, part, setPart, onOpen, onDetails }: {
  card: Card; today: string; dateLabel: string; dow: string; part: number | undefined; setPart: (v: number) => void;
  onOpen: (videoId: string, workoutId: string) => void; onDetails: () => void;
}) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const isToday = card.date === today;
  const head = (
    <div className="cal-gc-head">
      <span className={`cal-gc-dow${isToday ? ' is-today' : ''}`}>{(isToday ? t('calendar.today') : dow).toUpperCase()}</span>
      <span className="cal-gc-date">{dateLabel}</span>
    </div>
  );

  if (card.kind !== 'workout') {
    const frozen = card.kind === 'frozen';
    return (
      <div className={`cal-gc is-rest${isToday ? ' is-today' : ''}`} onClick={onDetails}>
        <div className="cal-gc-body">
          {head}
          <div className={`cal-gc-rest${frozen ? ' is-frozen' : ''}`}>
            {frozen ? <Snowflake size={24} /> : <Moon size={24} />}
            {t(frozen ? 'calendar.frozen' : 'calendar.rest_day')}
          </div>
        </div>
      </div>
    );
  }

  const s = workoutState(card.plan, card.day, today);
  const n = s.videos.length;
  const index = Math.min(part ?? s.current, Math.max(n - 1, 0));
  const video = s.videos[index];
  const partDone = Boolean(video?.isCompleted);
  const minutes = s.multi ? null : s.totalMin;
  const tags = video ? scheduleVideoTags(video, labels) : [];
  const step = (delta: number) => (e: MouseEvent) => { e.stopPropagation(); setPart((index + delta + n) % n); };

  const label = s.done
    ? t('calendar.done_plain')
    : partDone
      ? t('calendar.review_part_plain', { index: index + 1 })
      : s.multi ? t('calendar.play_part_plain', { index: index + 1 }) : t('calendar.start_workout_plain');

  return (
    <div className={`cal-gc${isToday ? ' is-today' : ''}`} onClick={onDetails}>
      <div className="cal-gc-media">
        {video?.thumbnail ? <img src={`/thumbnails/${video.thumbnail}`} alt="" loading="lazy" /> : <span className="cal-gc-noimg" />}
        {minutes ? <span className="cal-gc-dur">{minutes} {t('calendar.duration_min')}</span> : null}
        {s.multi && (
          <div className="cal-gc-switch" onClick={e => e.stopPropagation()}>
            <button type="button" aria-label={t('calendar.prev_part')} onClick={step(-1)}><ChevronLeft size={15} /></button>
            <span>{index + 1} / {n}</span>
            <button type="button" aria-label={t('calendar.next_part')} onClick={step(1)}><ChevronRight size={15} /></button>
          </div>
        )}
      </div>
      <div className="cal-gc-body">
        <div className="cal-gc-head">
          <span className={`cal-gc-dow${isToday ? ' is-today' : ''}`}>{(isToday ? t('calendar.today') : dow).toUpperCase()}</span>
          <span className="cal-gc-date">{dateLabel}</span>
          <span className="cal-gc-spacer" />
          <span className={`rx-badge rx-badge--${card.plan.slot}`}>{t(card.plan.slot === 'main' ? 'calendar.plan_main' : 'calendar.plan_extra')}</span>
        </div>
        <div className="cal-gc-title">{s.titles[index] || s.workout.name}</div>
        <TagRow tags={tags} rows={2} />
        <div className="cal-entry-spacer" />
        {video && (
          <button
            type="button"
            className={`cal-gc-btn${s.done ? ' is-done' : isToday ? ' is-today' : ''}`}
            onClick={e => { e.stopPropagation(); onOpen(video.id, s.workout.id); }}
          >
            {s.done ? <Check size={14} /> : <Play size={14} />}
            {label}
          </button>
        )}
      </div>
    </div>
  );
}
