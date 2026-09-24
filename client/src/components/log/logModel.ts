import { Video } from '../../types/video';
import { VideoTag } from '../../lib/videoTags';

export type LogEntry = {
  id: string;
  workoutId: string | null;
  videoId: string | null;
  planName: string | null;
  workoutName: string | null;
  videoFilename: string | null;
  thumbnail: string | null;
  completedDate: string;
  completedAt: string;
  isManual: boolean;
  notes: string;
  /** Times through the video, when it was looped in the player; null otherwise. */
  loopCount: number | null;
  durationSeconds: number | null;
  trainingType: string[];
  bodyParts: string[];
  intensity: string | null;
  equipment: string[];
};

/** A plan carried to the end. Kept even after the plan is edited or deleted. */
export interface FinishedPlan {
  id: string;
  planId: string | null;
  planName: string;
  workoutCount: number;
  startedOn: string | null;
  finishedOn: string;
  daysTaken: number | null;
}

/** How far through each plan the user is, from the plan's own completion marks. */
export interface PlanProgress {
  id: string;
  name: string;
  slot: 'main' | 'extra' | null;
  totalWorkouts: number;
  completedWorkouts: number;
  isFinished: boolean;
}

/** One logged workout: the entries marked done together, sharing a date, note and plan. */
export interface LogGroup {
  key: string;
  planName: string | null;
  isManual: boolean;
  entries: LogEntry[];
  notes: string;
  /** Names for entries with no linked video (manually logged workouts). */
  nameLines: string[];
}

export const pad = (n: number) => String(n).padStart(2, '0');
export const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Workout names can be multi-line TSV blobs like "Week 1 - Day 1\nFull Body (30 min)".
// Trim the "Week X - Day Y" prefix and "(NN min)" suffixes and return each video
// title as its own line, so multi-video days are never rendered as one merged clump.
export function workoutNameLines(name: string | null): string[] {
  if (!name) return [];
  return name
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((line, i) => !(i === 0 && /^week\s*\d+\s*-\s*day\s*\d+/i.test(line)))
    .map(line => line.replace(/\s*\(\d+\s*min\)\s*/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function cleanWorkoutName(name: string | null): string {
  if (!name) return '';
  const lines = workoutNameLines(name);
  return lines.length ? lines.join(' - ') : name;
}

// Drop the file extension so "Full Body HIIT.mp4" displays as "Full Body HIIT".
export const stripExt = (filename: string) => filename.replace(/\.[^/.]+$/, '');

// "18h 45m", or "45m" under an hour. Rounded down to whole minutes.
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** Group a day's entries into the workouts they were logged as. */
export function groupEntries(dayEntries: LogEntry[]): LogGroup[] {
  const groups = new Map<string, LogGroup>();
  for (const e of dayEntries) {
    const key = e.workoutId || e.workoutName || e.id;
    const g = groups.get(key) || { key, planName: e.planName, isManual: false, entries: [], notes: '', nameLines: [] };
    g.isManual = g.isManual || e.isManual;
    g.entries.push(e);
    groups.set(key, g);
  }
  // `workout_name` on a plan day is a blob listing EVERY video scheduled that day,
  // so it must never be used as a title when the entries carry their own videos —
  // only the videos actually marked done are shown. Name lines are kept solely for
  // entries with no linked video (manually logged workouts).
  return Array.from(groups.values()).map(g => ({
    ...g,
    nameLines: g.entries.every(e => e.videoFilename) ? [] : workoutNameLines(g.entries[0].workoutName),
    // The note is mirrored across the workout's rows; take the first one set.
    notes: g.entries.find(e => e.notes)?.notes || '',
  }));
}

/** An entry's tags, in the fixed order every card uses. */
export function entryTags(
  e: LogEntry,
  labels: { intensity: (v: string) => string; trainingType: (v: string) => string; bodyPart: (v: string) => string; equipment: (v: string) => string }
): VideoTag[] {
  const tags: VideoTag[] = [];
  if (e.intensity) tags.push({ key: `int:${e.intensity}`, label: labels.intensity(e.intensity), category: 'intensity' });
  for (const v of e.trainingType || []) tags.push({ key: `type:${v}`, label: labels.trainingType(v), category: 'type' });
  for (const v of e.bodyParts || []) tags.push({ key: `body:${v}`, label: labels.bodyPart(v), category: 'body' });
  for (const v of e.equipment || []) tags.push({ key: `eq:${v}`, label: labels.equipment(v), category: 'gear' });
  return tags;
}

/** The library keyed by id, plus by filename where that's unambiguous.
 *  A rescan can give a video a new id, leaving older log entries pointing at
 *  one that no longer exists; the filename still finds it. */
export function videoLookup(videos: Video[]): Map<string, Video> {
  const map = new Map<string, Video>(videos.map(v => [v.id, v]));
  const seen = new Map<string, number>();
  for (const v of videos) seen.set(v.filename, (seen.get(v.filename) ?? 0) + 1);
  for (const v of videos) if (seen.get(v.filename) === 1) map.set(`name:${v.filename}`, v);
  return map;
}

export function findLoggedVideo(lookup: Map<string, Video>, entry: { videoId?: string | null; videoFilename?: string | null }): Video | undefined {
  return (entry.videoId ? lookup.get(entry.videoId) : undefined) ?? (entry.videoFilename ? lookup.get(`name:${entry.videoFilename}`) : undefined);
}
