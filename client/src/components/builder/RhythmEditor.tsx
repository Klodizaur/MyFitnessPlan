import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dumbbell, Minus, Moon, Plus, Trash2 } from 'lucide-react';
import {
  DAYS_PER_WEEK, MAX_CYCLE_DAYS, MAX_RHYTHM_WEEKS, splitWeeks, toWeeklyPattern,
} from '../../lib/builderModel';
import { isUsablePattern } from '../WorkoutPatternPicker';
import '../../styles/builder.css';

interface Props {
  /** false = follow the global pattern from Settings (shown, but locked). */
  custom: boolean;
  onCustom: (value: boolean) => void;
  /** Edit the plan's own rhythm as whole weeks that can each differ. */
  byWeek: boolean;
  onByWeek: (value: boolean) => void;
  pattern: number[];
  onPattern: (next: number[]) => void;
  /** Shown under the editor whatever the mode; the "follows Settings" note is built in. */
  hint?: ReactNode;
}

/**
 * A plan's workout rhythm, as edited in the plan builder and the AI planner —
 * one component, so the two can't drift apart.
 *
 * Two ways to set a plan's own rhythm, stored the same way (one flat 0/1 cycle
 * the schedule repeats from the start date):
 * - a repeating cycle of any length up to four weeks, so a plan isn't stuck
 *   with a seven-day week;
 * - week by week, where each week has its own workout and rest days and the
 *   weeks run in order before repeating.
 */
export default function RhythmEditor({ custom, onCustom, byWeek, onByWeek, pattern, onPattern, hint }: Props) {
  const { t } = useTranslation();
  const weekly = custom && byWeek;
  const workoutDays = pattern.filter(Boolean).length;

  const setCustom = (next: boolean) => {
    onCustom(next);
    if (!next) onByWeek(false);
  };

  // Weeks → cycle keeps the days as they are, up to the cycle's limit; cycle →
  // weeks pads it out to whole weeks.
  const setByWeek = (next: boolean) => {
    if (next === byWeek) return;
    onByWeek(next);
    onPattern(next ? toWeeklyPattern(pattern) : pattern.slice(0, MAX_CYCLE_DAYS));
  };

  const toggle = (index: number) => {
    const next = pattern.map((v, i) => (i === index ? (v ? 0 : 1) : v));
    // A rhythm with no training day could never place a workout.
    if (isUsablePattern(next)) onPattern(next);
  };

  const dayButton = (value: number, index: number, label: number, locked = false, title?: string) => (
    <button
      key={index}
      type="button"
      className={`pb-rhythm-day${value ? ' is-work' : ''}`}
      disabled={!custom || locked}
      title={title}
      onClick={() => toggle(index)}
    >
      <span className="pb-rhythm-n">{label}</span>
      {value ? <Dumbbell size={18} /> : <Moon size={18} />}
    </button>
  );

  return (
    <div>
      <div className="pb-rhythm-head">
        <div className="pb-label pb-label--flush">{t('plans.builder_rhythm')}</div>
        <div className="rx-seg rx-seg--sm">
          <button type="button" className={!custom ? 'is-on' : ''} onClick={() => setCustom(false)}>
            {t('plans.pattern_use_default')}
          </button>
          <button type="button" className={custom ? 'is-on' : ''} onClick={() => setCustom(true)}>
            {t('plans.pattern_set_for_plan')}
          </button>
        </div>
      </div>

      {custom && (
        <div className="rx-seg rx-seg--sm pb-rhythm-mode">
          <button type="button" className={!weekly ? 'is-on' : ''} onClick={() => setByWeek(false)}>
            {t('plans.pattern_mode_cycle')}
          </button>
          <button type="button" className={weekly ? 'is-on' : ''} onClick={() => setByWeek(true)}>
            {t('plans.pattern_mode_weekly')}
          </button>
        </div>
      )}

      {weekly ? (
        <>
          <div className="pb-rhythm-weeks">
            {splitWeeks(pattern).map((week, w) => {
              const count = week.filter(Boolean).length;
              return (
                <div key={w} className="pb-rhythm-week">
                  <div className="pb-rhythm-week-head">
                    <span>{t('plans.builder_week_n', { n: w + 1 })}</span>
                    <span className="pb-rhythm-week-count">{t('plans.pattern_week_summary', { count })}</span>
                    <button
                      type="button"
                      className="pb-rhythm-week-remove"
                      aria-label={t('plans.pattern_remove_week', { n: w + 1 })}
                      title={t('plans.pattern_remove_week', { n: w + 1 })}
                      disabled={pattern.length <= DAYS_PER_WEEK}
                      onClick={() => onPattern(pattern.filter((_, i) => Math.floor(i / DAYS_PER_WEEK) !== w))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="pb-rhythm">
                    {week.map((value, d) => {
                      // Every week keeps at least one workout day, so each
                      // builder week has a day to fill.
                      const lastWorkout = value === 1 && count === 1;
                      return dayButton(value, w * DAYS_PER_WEEK + d, d + 1, lastWorkout,
                        lastWorkout ? t('plans.pattern_week_needs_workout') : undefined);
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pb-cycle">
            <button
              type="button"
              className="pb-add-rhythm-week"
              disabled={pattern.length >= MAX_RHYTHM_WEEKS * DAYS_PER_WEEK}
              onClick={() => onPattern([...pattern, ...pattern.slice(-DAYS_PER_WEEK)])}
            >
              <Plus size={15} />
              {t('plans.pattern_add_week')}
            </button>
          </div>
          <div className="pb-hint">{t('plans.pattern_weekly_hint', { count: pattern.length / DAYS_PER_WEEK })}</div>
        </>
      ) : (
        <>
          <div className={`pb-rhythm${custom ? '' : ' is-locked'}`}>
            {pattern.map((value, index) => dayButton(value, index, index + 1))}
          </div>

          {/* "5 workout days in every [− 7 +] days". */}
          <div className="pb-cycle">
            <span>{t('settings.workout_days_in_every', { count: workoutDays })}</span>
            <div className="pb-stepper">
              <button
                type="button"
                aria-label={t('settings.remove_day')}
                disabled={!custom || pattern.length <= 1 || !isUsablePattern(pattern.slice(0, -1))}
                onClick={() => onPattern(pattern.slice(0, -1))}
              >
                <Minus size={15} />
              </button>
              <span>{pattern.length}</span>
              <button
                type="button"
                aria-label={t('settings.add_day')}
                disabled={!custom || pattern.length >= MAX_CYCLE_DAYS}
                onClick={() => onPattern([...pattern, 1])}
              >
                <Plus size={15} />
              </button>
            </div>
            <span>{t('settings.days_unit')}</span>
          </div>
        </>
      )}

      {!custom && <div className="pb-hint">{t('plans.pattern_follows_settings')}</div>}
      {hint}
    </div>
  );
}
