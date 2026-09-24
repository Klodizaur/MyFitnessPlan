import { FreezeReason } from '../../lib/freeze';
import { VideoTag } from '../../lib/videoTags';

export interface ScheduleVideo {
  id: string;
  filename: string;
  thumbnail?: string;
  isCompleted?: boolean;
  equipment?: string[];
  trainingType?: string[];
  bodyParts?: string[];
  intensity?: string;
  description?: string;
  /** Probed at scan time, in seconds. Null when the scan never read it. */
  duration?: number | null;
}

export interface ScheduleDay {
  date: string;
  isWorkoutDay: boolean;
  workout: {
    id: string;
    name: string;
    sequence_order: number;
    videos: ScheduleVideo[];
    isCompleted?: boolean;
    videosCompletedCount: number;
    totalVideosCount: number;
  } | null;
  /** Set when this day was frozen; the workout that would've landed here is
   *  deferred to the next open workout day (isWorkoutDay/workout above are
   *  already null in that case), pushing the rest of the schedule back. */
  frozen: FreezeReason | null;
}

/** One active plan's schedule. Two plans can be active at once (main + extra). */
export interface PlanSchedule {
  slot: 'main' | 'extra';
  planId: string;
  planName: string;
  startDate: string;
  backgroundImage: string | null;
  category: string | null;
  schedule: ScheduleDay[];
}

/** A noon-anchored Date, so a bare YYYY-MM-DD never slips a day across timezones. */
export const parseDay = (iso: string) => new Date(`${iso}T12:00:00`);

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Every date from the earliest to the latest day of the given plans. */
export function unionDates(plans: PlanSchedule[]): string[] {
  let first: string | null = null;
  let last: string | null = null;
  for (const plan of plans) {
    if (plan.schedule.length === 0) continue;
    const a = plan.schedule[0].date;
    const b = plan.schedule[plan.schedule.length - 1].date;
    if (!first || a < first) first = a;
    if (!last || b > last) last = b;
  }
  if (!first || !last) return [];
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

const HEADING = /^week\s*\d+\s*-\s*day\s*\d+/i;

/**
 * One title per part of a day's workout, in video order.
 *
 * A multi-video day's workout name is a newline-joined list of each part's own
 * title (sometimes led by a "Week 1 - Day 3" heading, sometimes with a
 * trailing "(20 min)"). When that list lines up with the videos it is used;
 * otherwise each part falls back to its own file name.
 */
export function partTitles(day: ScheduleDay): string[] {
  const videos = day.workout?.videos || [];
  const lines = (day.workout?.name || '')
    .split(/\n+/)
    .map(l => l.trim())
    .filter((line, index) => !(index === 0 && HEADING.test(line)))
    .map(line => line.replace(/\s*\(\d+\s+min\)\s*$/i, '').replace(/\.(mp4|m4v|mkv|mov|avi|webm)$/i, '').trim())
    .filter(Boolean);
  return videos.map((video, i) =>
    (lines.length === videos.length ? lines[i] : '') || video.filename.replace(/\.[^/.]+$/, '')
  );
}

/** Tags for a scheduled video, in the fixed order every card uses. */
export function scheduleVideoTags(
  video: ScheduleVideo,
  labels: {
    intensity: (v: string) => string;
    trainingType: (v: string) => string;
    bodyPart: (v: string) => string;
    equipment: (v: string) => string;
  }
): VideoTag[] {
  const tags: VideoTag[] = [];
  if (video.intensity) tags.push({ key: `int:${video.intensity}`, label: labels.intensity(video.intensity), category: 'intensity' });
  for (const v of new Set(video.trainingType || [])) tags.push({ key: `type:${v}`, label: labels.trainingType(v), category: 'type' });
  for (const v of new Set(video.bodyParts || [])) tags.push({ key: `body:${v}`, label: labels.bodyPart(v), category: 'body' });
  for (const v of new Set(video.equipment || [])) tags.push({ key: `eq:${v}`, label: labels.equipment(v), category: 'gear' });
  return tags;
}

/** What a view needs to know about one plan's workout on one day. */
export interface WorkoutState {
  workout: NonNullable<ScheduleDay['workout']>;
  videos: ScheduleVideo[];
  titles: string[];
  done: boolean;
  /** Index of the part in focus: the first one still to do, or 0 once finished. */
  current: number;
  multi: boolean;
  /** Whole-workout length in minutes, or null unless every part's is known. */
  totalMin: number | null;
  isToday: boolean;
  isPast: boolean;
  daysAway: number;
  /** "3 of 12" — which of the plan's workouts this is. */
  position: number;
  total: number;
}

export function workoutState(plan: PlanSchedule, day: ScheduleDay, today: string): WorkoutState {
  const workout = day.workout!;
  const videos = workout.videos;
  const done = Boolean(workout.isCompleted);
  const firstOpen = videos.findIndex(v => !v.isCompleted);
  const durations = videos.map(v => v.duration || 0);
  const allKnown = videos.length > 0 && durations.every(Boolean);
  return {
    workout,
    videos,
    titles: partTitles(day),
    done,
    current: done || firstOpen < 0 ? 0 : firstOpen,
    multi: videos.length > 1,
    totalMin: allKnown ? Math.round(durations.reduce((a, b) => a + b, 0) / 60) : null,
    isToday: day.date === today,
    isPast: day.date < today,
    daysAway: Math.round((parseDay(day.date).getTime() - parseDay(today).getTime()) / 864e5),
    position: plan.schedule.filter(d => d.isWorkoutDay && d.workout && d.date <= day.date).length,
    total: plan.schedule.filter(d => d.isWorkoutDay).length,
  };
}

/** The next workout day of a plan after `date`, or null. */
export const nextWorkoutAfter = (plan: PlanSchedule, date: string): string | null =>
  plan.schedule.find(d => d.date > date && d.isWorkoutDay)?.date ?? null;
