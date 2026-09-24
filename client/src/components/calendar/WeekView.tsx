import { MouseEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, ChevronRight, Info, Moon, Play, Snowflake } from 'lucide-react';
import { useMetaLabels } from '../../lib/labels';
import { useIsMobile } from '../../lib/useIsMobile';
import { TagRow } from '../library/LibraryCards';
import { PlanSchedule, ScheduleDay, WorkoutState, parseDay, scheduleVideoTags, unionDates, workoutState } from './calendarModel';

interface Props {
  plans: PlanSchedule[];
  today: string;
  onOpen: (videoId: string, workoutId: string) => void;
  onDetails: (date: string) => void;
}

interface Item {
  plan: PlanSchedule;
  day: ScheduleDay;
  kind: 'workout' | 'rest' | 'frozen';
}

/**
 * Weeks as bands of seven days: a column per day on desktop, a row per day on a
 * phone. Tapping a workout starts it; the ⓘ opens that day's details.
 */
export default function WeekView({ plans, today, onOpen, onDetails }: Props) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  // Part on screen per plan-day, once the user has stepped away from the default.
  const [parts, setParts] = useState<Record<string, number>>({});

  const dates = useMemo(() => unionDates(plans), [plans]);
  const lookups = useMemo(() => plans.map(plan => ({ plan, days: new Map(plan.schedule.map(d => [d.date, d])) })), [plans]);

  const weeks = useMemo(() => {
    const out: string[][] = [];
    dates.forEach((date, i) => { (out[Math.floor(i / 7)] ||= []).push(date); });
    return out;
  }, [dates]);

  const fmt = (date: string, options: Intl.DateTimeFormatOptions) => parseDay(date).toLocaleDateString(i18n.language, options);

  /** What a day shows: its workouts if it has any, otherwise a single rest or frozen note. */
  const itemsFor = (date: string): Item[] => {
    const all: Item[] = [];
    for (const { plan, days } of lookups) {
      const day = days.get(date);
      if (!day) continue;
      all.push({ plan, day, kind: day.frozen ? 'frozen' : day.isWorkoutDay && day.workout ? 'workout' : 'rest' });
    }
    if (all.some(i => i.kind === 'workout')) return all.filter(i => i.kind !== 'rest');
    return all.filter((item, i, arr) => arr.findIndex(o => o.kind === item.kind) === i);
  };

  return (
    <div className="cal-weeks">
      {weeks.map((week, w) => {
        const cells = week.map(date => ({ date, items: itemsFor(date) }));
        const workouts = cells.flatMap(c => c.items.filter(i => i.kind === 'workout'));
        const doneCount = workouts.filter(i => i.day.workout?.isCompleted).length;

        return (
          <section key={w} className={`cal-wk${w % 2 ? ' is-even' : ''}`}>
            <div className="cal-wk-head">
              <span className="cal-wk-label">{t('calendar.week_label', { number: w + 1 })}</span>
              <span className="cal-wk-range">
                {fmt(week[0], { day: 'numeric', month: 'short' })} – {fmt(week[week.length - 1], { day: 'numeric', month: 'short' })}
              </span>
              <span className="cal-wk-progress">{t('calendar.week_progress', { done: doneCount, total: workouts.length })}</span>
            </div>

            <div className={isMobile ? 'cal-wk-rows' : 'cal-wk-cols'}>
              {cells.map(cell => (
                <DayCell
                  key={cell.date}
                  date={cell.date}
                  items={cell.items}
                  today={today}
                  mobile={isMobile}
                  parts={parts}
                  setPart={(key, value) => setParts(prev => ({ ...prev, [key]: value }))}
                  onOpen={onOpen}
                  onDetails={onDetails}
                />
              ))}
              {/* Keep seven columns in a short final week. */}
              {!isMobile && Array.from({ length: 7 - week.length }).map((_, i) => <div key={`pad${i}`} className="cal-cell is-pad" />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayCell({ date, items, today, mobile, parts, setPart, onOpen, onDetails }: {
  date: string; items: Item[]; today: string; mobile: boolean;
  parts: Record<string, number>; setPart: (key: string, value: number) => void;
  onOpen: (videoId: string, workoutId: string) => void; onDetails: (date: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const isToday = date === today;
  const day = parseDay(date);
  const hasW = items.some(i => i.kind === 'workout');
  const workoutItems = items.filter(i => i.kind === 'workout');
  const allDone = hasW && workoutItems.every(i => i.day.workout?.isCompleted);
  const dow = day.toLocaleDateString(i18n.language, { weekday: 'short' });

  const cls = `cal-cell${hasW ? ' has-w' : ''}${allDone ? ' is-done' : ''}${isToday ? ' is-today' : ''}`;
  // A rest cell has nothing to start, so tapping it opens the day instead.
  const open = () => { if (!hasW) onDetails(date); };

  const body = items.map(item => {
    if (item.kind !== 'workout') {
      const frozen = item.kind === 'frozen';
      return (
        <div key={`${item.plan.planId}:r`} className={`cal-rest${frozen ? ' is-frozen' : ''}`}>
          {frozen ? <Snowflake size={mobile ? 15 : 20} /> : <Moon size={mobile ? 15 : 20} />}
          {t(frozen ? 'calendar.frozen' : 'calendar.rest_day')}
        </div>
      );
    }
    return (
      <WorkoutBlock
        key={item.plan.planId}
        item={item}
        today={today}
        mobile={mobile}
        part={parts[`${date}:${item.plan.planId}`]}
        setPart={v => setPart(`${date}:${item.plan.planId}`, v)}
        onOpen={onOpen}
        onDetails={() => onDetails(date)}
      />
    );
  });

  if (mobile) {
    return (
      <div className={`${cls} cal-row`} onClick={open}>
        <div className="cal-row-date">
          <span className={`cal-row-dow${isToday ? ' is-today' : ''}`}>{dow.toUpperCase()}</span>
          <span className={`cal-row-num${isToday ? ' is-today' : ''}`}>{day.getDate()}</span>
        </div>
        <div className="cal-row-items">{body}</div>
        {hasW && (
          <button type="button" className="cal-info cal-info--row" aria-label={t('calendar.details')} onClick={e => { e.stopPropagation(); onDetails(date); }}>
            <Info size={17} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cls} onClick={open}>
      <div className="cal-cell-head">
        <span className={`cal-cell-dow${isToday ? ' is-today' : ''}`}>{(isToday ? t('calendar.today') : dow).toUpperCase()}</span>
        <span className="cal-cell-num">{day.getDate()}</span>
      </div>
      {body}
    </div>
  );
}

function WorkoutBlock({ item, today, mobile, part, setPart, onOpen, onDetails }: {
  item: Item; today: string; mobile: boolean; part: number | undefined; setPart: (v: number) => void;
  onOpen: (videoId: string, workoutId: string) => void; onDetails: () => void;
}) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const s: WorkoutState = workoutState(item.plan, item.day, today);
  const n = s.videos.length;
  const index = Math.min(part ?? s.current, Math.max(n - 1, 0));
  const video = s.videos[index];
  const done = s.done;

  const step = (delta: number) => (e: MouseEvent) => {
    e.stopPropagation();
    const next = index + delta;
    if (next >= 0 && next < n) setPart(next);
  };

  // A single video shows the whole workout's length; parts show their own.
  const minutes = s.multi
    ? (video?.duration ? Math.round(video.duration / 60) : null)
    : s.totalMin;
  const tags = video ? scheduleVideoTags(video, labels) : [];
  const play = (e: MouseEvent) => {
    e.stopPropagation();
    if (video) onOpen(video.id, s.workout.id);
  };

  const thumb = (
    <div className="cal-thumb" onClick={play}>
      {video?.thumbnail ? <img src={`/thumbnails/${video.thumbnail}`} alt="" loading="lazy" /> : <span className="cal-thumb-empty" />}
      {done && <span className="cal-thumb-done" />}
      {minutes ? <span className="cal-thumb-dur">{minutes} {t('calendar.duration_min')}</span> : null}
      <span className={`cal-thumb-play${done ? ' is-done' : ''}`}>{done ? <Check size={mobile ? 14 : 17} strokeWidth={3} /> : <Play size={mobile ? 13 : 16} />}</span>
      {s.multi && (
        <span className="cal-thumb-segs">
          {s.videos.map((_, i) => <i key={i} className={i === index ? 'is-on' : ''} />)}
        </span>
      )}
      {s.multi && !mobile && (
        <>
          <button type="button" className="cal-thumb-arrow is-prev" style={{ opacity: index > 0 ? 1 : 0.35 }} aria-label={t('calendar.prev_part')} onClick={step(-1)}><ChevronLeft size={14} /></button>
          <button type="button" className="cal-thumb-arrow is-next" style={{ opacity: index < n - 1 ? 1 : 0.35 }} aria-label={t('calendar.next_part')} onClick={step(1)}><ChevronRight size={14} /></button>
        </>
      )}
    </div>
  );

  const title = s.titles[index] || s.workout.name;
  const badge = <span className={`rx-badge rx-badge--${item.plan.slot}`}>{t(item.plan.slot === 'main' ? 'calendar.plan_main' : 'calendar.plan_extra')}</span>;

  if (mobile) {
    return (
      <div className="cal-item cal-item--row">
        {thumb}
        <div className="cal-item-text">
          <div className="cal-item-title">{title}</div>
          <div className="cal-item-meta">{badge}{done && <span className="cal-item-done">{t('calendar.done')}</span>}</div>
          <TagRow tags={tags} rows={1} />
          {s.multi && (
            <div className="cal-partswitch" onClick={e => e.stopPropagation()}>
              <button type="button" style={{ opacity: index > 0 ? 1 : 0.35 }} aria-label={t('calendar.prev_part')} onClick={step(-1)}><ChevronLeft size={15} /></button>
              <span>{t('calendar.part_of', { index: index + 1, total: n })}</span>
              <button type="button" style={{ opacity: index < n - 1 ? 1 : 0.35 }} aria-label={t('calendar.next_part')} onClick={step(1)}><ChevronRight size={15} /></button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="cal-item">
      {thumb}
      <div className="cal-item-title">{title}</div>
      <TagRow tags={tags} rows={2} />
      <div className="cal-item-spacer" />
      <div className="cal-item-foot">
        {badge}
        <span className={`cal-item-meta-text${done ? ' is-done' : ''}`}>{done ? t('calendar.done') : ''}</span>
        <button type="button" className="cal-info" title={t('calendar.details')} aria-label={t('calendar.details')} onClick={e => { e.stopPropagation(); onDetails(); }}>
          <Info size={14} />
        </button>
      </div>
    </div>
  );
}
