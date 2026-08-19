import { useTranslation } from 'react-i18next';

/**
 * A plan's workout/rest rhythm: a repeating cycle of days, each either a
 * training day or a rest day.
 *
 * The cycle is not a calendar week — it repeats from the plan's start date, so
 * a four-day cycle drifts across weekdays on purpose. What it decides is the
 * spacing between the plan's workouts, which are otherwise just an ordered list.
 *
 * Compact by design: this lives inside the plan builder and the AI modal, where
 * the full-size editor on the Settings page would swamp the form around it.
 */

export const DEFAULT_PATTERN = [1, 1, 1, 1, 1, 0];
const MAX_PATTERN_DAYS = 14;

/** A pattern with no training day would schedule nothing at all. */
export function isUsablePattern(pattern: number[]): boolean {
  return pattern.length > 0 && pattern.some(day => day === 1);
}

interface Props {
  pattern: number[];
  onChange: (pattern: number[]) => void;
  /**
   * Read-only display. Used to show the default rhythm a plan will inherit —
   * visible, so you can see what you're accepting, but not editable until you
   * choose to override it.
   */
  disabled?: boolean;
}

export default function WorkoutPatternPicker({ pattern, onChange, disabled }: Props) {
  const { t } = useTranslation();

  const toggleDay = (index: number) => {
    if (disabled) return;
    const next = pattern.map((day, i) => (i === index ? (day === 1 ? 0 : 1) : day));
    // Refuse to empty the pattern out rather than storing one that can never
    // place a workout.
    if (!isUsablePattern(next)) return;
    onChange(next);
  };

  const workoutDays = pattern.filter(day => day === 1).length;

  return (
    <div className={`pattern-picker${disabled ? ' readonly' : ''}`}>
      <div className="pattern-picker-days">
        {pattern.map((day, index) => (
          <button
            type="button"
            key={index}
            className={`pattern-day${day === 1 ? ' workout' : ''}`}
            onClick={() => toggleDay(index)}
            disabled={disabled}
            title={day === 1 ? t('settings.workout') : t('settings.rest')}
            aria-pressed={day === 1}
          >
            <span className="pattern-day-n">{index + 1}</span>
            <span className="pattern-day-icon" aria-hidden="true">{day === 1 ? '💪' : '🧘'}</span>
          </button>
        ))}

        {!disabled && (
          <>
            <button
              type="button"
              className="pattern-day pattern-day-add"
              onClick={() => onChange([...pattern, 1])}
              disabled={pattern.length >= MAX_PATTERN_DAYS}
              title={t('settings.add_day')}
            >
              +
            </button>
            <button
              type="button"
              className="pattern-day pattern-day-add"
              onClick={() => onChange(pattern.slice(0, -1))}
              disabled={pattern.length <= 1 || !isUsablePattern(pattern.slice(0, -1))}
              title={t('settings.remove_day')}
            >
              −
            </button>
          </>
        )}
      </div>

      <p className="pattern-picker-summary">
        {t('plans.pattern_summary', { workouts: workoutDays, total: pattern.length })}
      </p>
    </div>
  );
}
