/**
 * Narrow the library down to the videos a plan may actually use, then compact
 * them for the prompt.
 *
 * The model never sees the library. It sees a shortlist that already satisfies
 * every hard constraint and picks from it, which keeps the request small, keeps
 * cost bounded on a large library, and means an id it returns is either real or
 * rejected — there is no third option where a plausible-looking invention slips
 * through.
 */
import db from '../db.js';
import { VIDEO_COLUMNS, formatVideoRow } from '../routes/library.js';

/** How many candidates to send at most, whatever the library size. */
const MAX_CANDIDATES = 200;

export interface CandidateFilter {
  /** Equipment the user owns. Empty means "don't filter on equipment". */
  equipment: string[];
  /** Album keys to draw from. Empty means the whole library. */
  includeAlbums: string[];
  /** Album keys to leave out, applied after `includeAlbums`. */
  excludeAlbums: string[];
  /** Longest single video, in minutes. 0 or absent means no cap. */
  maxMinutes: number;
  /** Soft preferences — used for ranking here, and given to the model. */
  intensity: string;
  trainingTypes: string[];
  bodyParts: string[];
}

/** What the model is shown per video. Deliberately terse: this is per-token. */
export interface Candidate {
  id: string;
  title: string;
  minutes: number | null;
  equipment: string[];
  types: string[];
  parts: string[];
  intensity: string;
  album: string;
}

export interface CandidateSet {
  candidates: Candidate[];
  /** How many passed the hard filters before the cap was applied. */
  matched: number;
  truncated: boolean;
}

/**
 * Which album a video belongs to.
 *
 * Mirrors `albumKeyForVideo` in client/src/lib/paths.ts. Duplicated on purpose:
 * six lines inside the AI module beats a shared import that would outlive the
 * module if the feature is ever removed.
 */
function albumKeyForVideo(video: {
  source: string;
  relative_path: string;
  external_playlist_id: string | null;
}): string {
  if ((video.source || 'local') !== 'local') {
    return `yt:${video.external_playlist_id || 'unknown'}`;
  }
  const parts = (video.relative_path || '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : '.';
}

/** Display-only: the extension is noise in a prompt. */
function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

export function selectCandidates(filter: CandidateFilter): CandidateSet {
  const rows = db.prepare(`SELECT ${VIDEO_COLUMNS} FROM videos`).all() as any[];
  const videos = rows.map(formatVideoRow);

  const owned = new Set(filter.equipment);
  const include = new Set(filter.includeAlbums);
  const exclude = new Set(filter.excludeAlbums);
  const maxSeconds = filter.maxMinutes > 0 ? filter.maxMinutes * 60 : 0;

  const matched = videos.filter(video => {
    const album = albumKeyForVideo(video);
    if (include.size > 0 && !include.has(album)) return false;
    if (exclude.has(album)) return false;

    // Only a hard filter when the user actually told us what they own —
    // otherwise an untagged library would filter down to nothing.
    if (owned.size > 0 && video.equipment.some(item => !owned.has(item))) return false;

    // Unknown duration is kept rather than dropped: most imported videos have
    // one, but a video the scan never probed shouldn't silently disappear.
    if (maxSeconds > 0 && video.duration_seconds && video.duration_seconds > maxSeconds) return false;

    return true;
  });

  // Rank by how well each video matches the soft preferences, so the cap trims
  // the least relevant rather than an arbitrary tail. Ties keep library order.
  const ranked = matched
    .map((video, index) => ({ video, index, score: softScore(video, filter) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, MAX_CANDIDATES);

  return {
    candidates: ranked.map(({ video }) => ({
      id: video.id,
      title: stripExt(video.filename),
      minutes: video.duration_seconds ? Math.round(video.duration_seconds / 60) : null,
      equipment: video.equipment,
      types: video.training_type,
      parts: video.body_parts,
      intensity: video.intensity,
      album: albumKeyForVideo(video),
    })),
    matched: matched.length,
    truncated: matched.length > MAX_CANDIDATES,
  };
}

function softScore(
  video: { training_type: string[]; body_parts: string[]; intensity: string },
  filter: CandidateFilter
): number {
  let score = 0;
  if (filter.intensity && video.intensity === filter.intensity) score += 2;
  for (const type of filter.trainingTypes) if (video.training_type.includes(type)) score += 1;
  for (const part of filter.bodyParts) if (video.body_parts.includes(part)) score += 1;
  // A tagged video is more useful to the model than an untagged one, all else
  // being equal — it can reason about it instead of guessing from the title.
  if (video.training_type.length || video.body_parts.length || video.intensity) score += 0.5;
  return score;
}
