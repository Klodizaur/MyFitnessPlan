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

/** Longest repeating cycle the plan builder offers. */
export const MAX_CYCLE_DAYS = 28;
/** Most weeks a week-by-week rhythm can have before it repeats. */
export const MAX_RHYTHM_WEEKS = 12;
export const DAYS_PER_WEEK = 7;

/**
 * A week-by-week rhythm is stored exactly like any other: one flat 0/1 cycle
 * that the schedule repeats from the start date. It is just a cycle made of
 * whole weeks, each with at least one workout day, which the builder lays out
 * one week per row. So a stored pattern reads as week-by-week when it has that
 * shape — there is nothing extra to store, and the server needs no change.
 */
export const isWeeklyPattern = (pattern: number[]): boolean =>
  pattern.length > DAYS_PER_WEEK
  && pattern.length % DAYS_PER_WEEK === 0
  && splitWeeks(pattern).every(week => week.includes(1));

/** A flat cycle cut into seven-day weeks (the last one may be short). */
export function splitWeeks(pattern: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < pattern.length; i += DAYS_PER_WEEK) out.push(pattern.slice(i, i + DAYS_PER_WEEK));
  return out;
}

/**
 * Turn any cycle into whole weeks: pad with rest days to a multiple of seven,
 * and give a week with no workout day one, since a builder week needs a slot.
 */
export function toWeeklyPattern(pattern: number[]): number[] {
  const length = Math.min(
    MAX_RHYTHM_WEEKS * DAYS_PER_WEEK,
    Math.max(DAYS_PER_WEEK, Math.ceil(pattern.length / DAYS_PER_WEEK) * DAYS_PER_WEEK),
  );
  const padded = Array.from({ length }, (_, i) => (pattern[i] ? 1 : 0));
  return splitWeeks(padded).flatMap(week => (week.includes(1) ? week : [1, ...week.slice(1)]));
}

/**
 * The rhythm each builder week follows, repeating. A plain cycle is one turn
 * per builder week; a week-by-week rhythm gives builder week `i` its
 * `i % weeks`-th week.
 */
export const builderRhythms = (pattern: number[], byWeek: boolean): number[][] =>
  byWeek ? splitWeeks(pattern) : [pattern];

/** Workout-day slots in builder week `index`, given the rhythms from `builderRhythms`. */
export const slotsForWeek = (rhythms: number[][], index: number): number =>
  workoutSlots(rhythms[index % rhythms.length]);

/**
 * Re-deal the plan's workouts into weeks of `slots` workout days (a number, or
 * one per week index when the weeks differ).
 *
 * The order of the workouts is what a plan *is*; how they group into weeks is
 * only how the rhythm lays them out. So when the rhythm changes, the filled days
 * are taken in order and dealt into the new week size — nothing is lost or
 * reordered, later workouts just move to where the new rhythm puts them. Empty
 * days carry no meaning (they are dropped on save) so they are not carried over;
 * the last week is padded back out to a full week.
 */
export function relayoutWeeks(weeks: BuilderWeek[], slots: number | ((week: number) => number)): BuilderWeek[] {
  const sizeOf = typeof slots === 'number' ? () => slots : slots;
  const filled = weeks.flatMap(week => week.days).filter(day => day.videoIds.length > 0);
  const out: BuilderWeek[] = [];
  let taken = 0;
  do {
    const size = Math.max(1, sizeOf(out.length));
    const week = createWeek(out.length + 1, size);
    filled.slice(taken, taken + size).forEach((day, i) => { week.days[i] = day; });
    taken += size;
    out.push(week);
  } while (taken < filled.length);
  return out;
}

/** How many workouts fall in each preview week, cycling through the rhythm. */
export function groupBySlots(count: number, pattern: number[]): { start: number; size: number }[] {
  const rhythms = builderRhythms(pattern, isWeeklyPattern(pattern));
  const out: { start: number; size: number }[] = [];
  for (let start = 0, w = 0; start < count; w++) {
    const size = slotsForWeek(rhythms, w);
    out.push({ start, size });
    start += size;
  }
  return out;
}

export const createInitialBuilderWeeks = (): BuilderWeek[] => [createWeek(1)];
