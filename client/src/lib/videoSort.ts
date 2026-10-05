import type { Video } from '../types/video';

/**
 * How a list of videos can be ordered. Shared by the Library, album pages and
 * the plan builder's picker, so they offer the same choices and agree on them.
 *
 * `size`/`small` are longest/shortest for videos (and most/fewest videos for
 * folders); `newest`/`oldest` go by when a video arrived — `added_at`, the same
 * date the dashboard's "Recently added" uses.
 */
export type VideoSort = 'az' | 'za' | 'size' | 'small' | 'newest' | 'oldest';

export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Compare two arrival dates (ISO text, so string order is time order), newest
 * or oldest first. A missing date always sorts last, whichever way round.
 */
export function compareAdded(a: string | null | undefined, b: string | null | undefined, newestFirst: boolean): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return (a < b ? -1 : 1) * (newestFirst ? -1 : 1);
}

/** A sorted copy; ties fall back to the name so the order is stable. */
export function sortVideos(videos: Video[], sort: VideoSort): Video[] {
  const byName = (a: Video, b: Video) => naturalCompare(a.filename, b.filename);
  const sorted = [...videos];
  switch (sort) {
    case 'size':
      return sorted.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
    case 'small':
      return sorted.sort((a, b) => (a.duration_seconds || 0) - (b.duration_seconds || 0));
    case 'newest':
    case 'oldest':
      return sorted.sort((a, b) => compareAdded(a.added_at, b.added_at, sort === 'newest') || byName(a, b));
    case 'za':
      return sorted.sort((a, b) => byName(b, a));
    default:
      return sorted.sort(byName);
  }
}
