/**
 * The shape the workout builder holds while a plan is being assembled.
 *
 * Lives here rather than inside the Plans page so anything that wants to hand
 * the builder a starting point — editing an existing plan, or the AI draft —
 * speaks the same type instead of a copy that drifts.
 *
 * The `name` fields are internal English placeholders: the UI derives its
 * headings from the week/day position so they follow the interface language,
 * and day names are replaced by the video titles on save.
 */

export interface BuilderDay {
  name: string;
  videoIds: string[];
  /**
   * The saved workout this day was loaded from, when editing an existing plan.
   * Sent back on save so the server can update that day in place instead of
   * rebuilding it — which is what keeps its completion ticks. It travels with
   * the day, not the slot, so removing a week or moving things around still
   * pairs each day with its own progress. Absent on days added in the builder.
   */
  workoutId?: string;
}

export interface BuilderWeek {
  name: string;
  days: BuilderDay[];
}

/**
 * A week of empty workout-day slots.
 *
 * A builder "week" is one turn of the plan's workout rhythm, and holds only its
 * workout days — the rest days are drawn between them from the rhythm, never
 * stored. So the slot count follows the rhythm (five workouts in a seven-day
 * cycle is five slots); it defaults to seven for callers that don't have one.
 */
export const createWeek = (weekNumber: number, slots = 7): BuilderWeek => ({
  name: `Week ${weekNumber}`,
  days: Array.from({ length: slots }, (_, i) => ({
    name: `Day ${i + 1}`,
    videoIds: [] as string[],
  })),
});

/** Workout days in one turn of a rhythm; a rhythm with none is treated as one. */
export const workoutSlots = (pattern: number[]): number =>
  Math.max(1, pattern.filter(day => day === 1).length);

/**
 * Re-deal the plan's workouts into weeks of `slots` workout days.
 *
 * The order of the workouts is what a plan *is*; how they group into weeks is
 * only how the rhythm lays them out. So when the rhythm changes, the filled days
 * are taken in order and dealt into the new week size — nothing is lost or
 * reordered, later workouts just move to where the new rhythm puts them. Empty
 * days carry no meaning (they are dropped on save) so they are not carried over;
 * the last week is padded back out to a full week.
 */
export function relayoutWeeks(weeks: BuilderWeek[], slots: number): BuilderWeek[] {
  const filled = weeks.flatMap(week => week.days).filter(day => day.videoIds.length > 0);
  const count = Math.max(1, Math.ceil(filled.length / slots));
  return Array.from({ length: count }, (_, w) => {
    const week = createWeek(w + 1, slots);
    filled.slice(w * slots, (w + 1) * slots).forEach((day, i) => { week.days[i] = day; });
    return week;
  });
}

export const createInitialBuilderWeeks = (): BuilderWeek[] => [createWeek(1)];
