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
}

export interface BuilderWeek {
  name: string;
  days: BuilderDay[];
}

/** A week of seven empty day slots. */
export const createWeek = (weekNumber: number): BuilderWeek => ({
  name: `Week ${weekNumber}`,
  days: Array.from({ length: 7 }, (_, i) => ({
    name: `Day ${i + 1}`,
    videoIds: [] as string[],
  })),
});

export const createInitialBuilderWeeks = (): BuilderWeek[] => [createWeek(1)];
