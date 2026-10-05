import { FastifyInstance } from 'fastify';
import db, { fileCreatedAt } from '../db.js';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { exec } from 'child_process';
import { promisify } from 'util';
import { rematchAllPlans } from '../matcher.js';
import { getProfileSetting, PROFILE_VIDEOS, requireProfile, setProfileSetting } from '../profiles.js';

const execPromise = promisify(exec);
const THUMB_DIR = path.join(process.cwd(), 'data', 'thumbnails');

// Supported video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];

export const VALID_EQUIPMENT = [
  'dumbbells',
  'mat',
  'gym_ball',
  'resistance_bands',
  'pilates_ball',
  'pilates_bar',
  'kettlebell',
  'barbell',
  'step',
  'bench',
  // Bodyweight-only. A tag rather than the absence of one, so "needs nothing"
  // is something a video can actually say.
  'no_equipment',
] as const;

export const VALID_TRAINING_TYPES = ['HIIT', 'Cardio', 'Strength', 'Mobility', 'Yoga', 'Pilates', 'Functional Strength Training', 'Warmup', 'Cooldown', 'Stretching', 'Standing', 'No Jumping', 'Period-Friendly'] as const;
export const VALID_BODY_PARTS = ['full_body', 'upper_body', 'lower_body', 'core', 'back', 'legs', 'arms', 'shoulders', 'glutes', 'chest'] as const;
export const VALID_INTENSITIES = ['low', 'medium', 'high'] as const;

function parseEquipment(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string =>
      typeof item === 'string' && VALID_EQUIPMENT.includes(item as typeof VALID_EQUIPMENT[number])
    );
  } catch {
    return [];
  }
}

function parseBodyParts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && VALID_BODY_PARTS.includes(item as typeof VALID_BODY_PARTS[number]));
  } catch {
    return [];
  }
}

// training_type used to be stored as a bare string (e.g. "HIIT"). It is now a
// multi-select stored as a JSON array like body_parts/equipment. This parser
// tolerates both: JSON arrays (new), and legacy bare strings (old rows that
// were never re-saved).
function parseTrainingTypes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const whitelist = (item: unknown): item is string =>
    typeof item === 'string' && (VALID_TRAINING_TYPES as readonly string[]).includes(item);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(whitelist);
    // Non-array JSON (e.g. a JSON-encoded string) -> treat as a single value
    return whitelist(parsed) ? [parsed] : [];
  } catch {
    // Legacy bare string that isn't valid JSON, e.g. HIIT
    return whitelist(raw) ? [raw] : [];
  }
}

/** Columns every endpoint needs to build a client-shaped video object. */
/** Columns every endpoint needs to build a client-shaped video object (from PROFILE_VIDEOS). */
export const VIDEO_COLUMNS =
  'id, filename, relative_path, thumbnail_path, description, equipment, training_type, body_parts, intensity, duration_seconds, source, external_id, external_url, external_playlist_id, external_playlist_title, is_favorite, added_at, file_created_at, in_library';

export function formatVideoRow(row: {
  id: string;
  filename: string;
  relative_path: string;
  thumbnail_path?: string | null;
  description?: string | null;
  equipment?: string | null;
  training_type?: string | null;
  body_parts?: string | null;
  intensity?: string | null;
  duration_seconds?: number | null;
  source?: string | null;
  external_id?: string | null;
  external_url?: string | null;
  external_playlist_id?: string | null;
  external_playlist_title?: string | null;
  is_favorite?: number | null;
  added_at?: string | null;
  file_created_at?: string | null;
  in_library?: number | null;
}) {
  return {
    id: row.id,
    filename: row.filename,
    duration_seconds: row.duration_seconds ?? null,
    // Always expose POSIX separators so Mac/Windows clients share one code path.
    relative_path: (row.relative_path || '').replace(/\\/g, '/'),
    thumbnail_path: row.thumbnail_path,
    description: row.description || '',
    equipment: parseEquipment(row.equipment),
    training_type: parseTrainingTypes(row.training_type),
    body_parts: parseBodyParts(row.body_parts),
    intensity: row.intensity || '',
    // Older rows predate the column; they are all local files.
    source: row.source || 'local',
    external_id: row.external_id || null,
    external_url: row.external_url || null,
    external_playlist_id: row.external_playlist_id || null,
    external_playlist_title: row.external_playlist_title || null,
    is_favorite: row.is_favorite === 1,
    // When the video arrived: a local file's creation date, else when it was
    // added to the app (imports, or a file whose date couldn't be read).
    // `added_at` is SQLite's UTC "YYYY-MM-DD HH:MM:SS"; both go out as ISO.
    added_at: row.file_created_at || (row.added_at ? `${row.added_at.replace(' ', 'T')}Z` : null),
    // False for a video that's only here for one of your plans: the plan can
    // play it, but the Library doesn't list it.
    in_library: row.in_library !== 0,
  };
}

/**
 * Which library video a workout-log entry is about.
 *
 * A log entry names its video by ID, but a library rebuilt from scratch gives
 * every video a new ID, which would orphan everything done before it. So an
 * entry whose ID no longer exists is matched by filename instead — only when
 * exactly one video has that name, so a guess never lands on the wrong one.
 */
export function logVideoResolver(videos: { id: string; filename: string }[]) {
  const ids = new Set(videos.map(v => v.id));
  const byName = new Map<string, string | null>();
  for (const v of videos) byName.set(v.filename, byName.has(v.filename) ? null : v.id);
  return (videoId: string | null, filename: string | null): string | null =>
    videoId && ids.has(videoId) ? videoId : (filename && byName.get(filename)) || null;
}

/**
 * How many times each video has been completed, from the durable workout log
 * (see `logVideoResolver`). A video looped several times in one go counts once
 * per round.
 */
function completionCounts(profileId: string, videos: { id: string; filename: string }[]): Map<string, number> {
  const resolve = logVideoResolver(videos);

  const rows = db.prepare(
    'SELECT video_id, video_filename, loop_count FROM workout_log WHERE profile_id = ? AND (video_id IS NOT NULL OR video_filename IS NOT NULL)'
  ).all(profileId) as { video_id: string | null; video_filename: string | null; loop_count: number | null }[];

  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = resolve(row.video_id, row.video_filename);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + Math.max(1, row.loop_count || 1));
  }
  return counts;
}

/**
 * Result of walking the library folder.
 *
 * `unreadable` is the part that matters. A directory the scan could not read is
 * not the same thing as a directory with no videos in it, and the difference is
 * the whole library: the caller deletes every local video it did not find, so a
 * silently swallowed read error reads as "the user deleted everything" and
 * takes their tags and descriptions with it. Anything that goes wrong is
 * reported here so the caller can decline to reconcile against a partial view.
 */
interface ScanResult {
  files: string[];
  unreadable: string[];
}

function scanDirectory(
  dir: string,
  excludePaths: string[],
  result: ScanResult = { files: [], unreadable: [] }
): ScanResult {
  const normalizedDir = path.resolve(dir);

  // Check if current directory is in exclude list
  if (excludePaths.some(ex => {
    const normalizedEx = path.resolve(ex.trim().replace(/^~/, process.env.HOME || '~'));
    return normalizedDir === normalizedEx || normalizedDir.startsWith(normalizedEx + path.sep);
  })) {
    console.log(`[Library] Excluding directory: ${normalizedDir}`);
    return result;
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    console.error(`[Library] Could not read directory ${dir}:`, err);
    result.unreadable.push(dir);
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = fs.statSync(fullPath).isDirectory();
    } catch (err) {
      // An entry we can't stat might be a folder full of videos, so treat it as
      // an incomplete read rather than skipping past it.
      console.error(`[Library] Could not read ${fullPath}:`, err);
      result.unreadable.push(fullPath);
      continue;
    }

    if (isDirectory) {
      scanDirectory(fullPath, excludePaths, result);
    } else if (VIDEO_EXTENSIONS.includes(path.extname(fullPath).toLowerCase())) {
      result.files.push(fullPath);
    }
  }

  return result;
}

// Reads a video's runtime in seconds. Uses `ffmpeg -i` rather than ffprobe
// because only ffmpeg is bundled with the packaged desktop app. ffmpeg exits
// non-zero when given no output file, but still prints "Duration: HH:MM:SS.ss"
// to stderr, which is what we parse. Returns null when it can't be determined.
async function probeDuration(videoPath: string): Promise<number | null> {
  let output = '';
  try {
    const { stderr } = await execPromise(`ffmpeg -i "${videoPath}"`);
    output = stderr;
  } catch (err: any) {
    output = err?.stderr || '';
  }

  const match = output.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;

  const [, hours, minutes, seconds] = match;
  const total = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
  return Number.isFinite(total) && total > 0 ? Math.round(total) : null;
}

async function generateThumbnail(videoPath: string, thumbId: string) {
  const thumbPath = path.join(THUMB_DIR, `${thumbId}.jpg`);
  if (fs.existsSync(thumbPath)) return `${thumbId}.jpg`;
  
  try {
    // Generate thumbnail at 30 second mark (to avoid black frames/warnings)
    await execPromise(`ffmpeg -i "${videoPath}" -ss 00:00:30.000 -vframes 1 -vf "scale=320:-1" "${thumbPath}" -y`);
    return `${thumbId}.jpg`;
  } catch (err) {
    console.error(`Error generating thumbnail for ${videoPath}:`, err);
    return null;
  }
}

// Progress of the in-flight library scan, polled by the Settings page while the
// (potentially long) /set-directory request is still running. Single-user local
// app, so one module-level slot is enough.
const scanProgress = {
  active: false,
  phase: 'idle' as 'idle' | 'discovering' | 'processing' | 'done',
  processed: 0,
  total: 0,
  currentFile: '' as string,
};

function resetScanProgress() {
  scanProgress.active = false;
  scanProgress.phase = 'idle';
  scanProgress.processed = 0;
  scanProgress.total = 0;
  scanProgress.currentFile = '';
}

export default async function (fastify: FastifyInstance) {
  fastify.get('/scan-progress', async (_request, reply) => {
    return reply.send(scanProgress);
  });

  fastify.post('/set-directory', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const { directory } = request.body as { directory: string };

    // Normalize: trim whitespace and expand ~ on Unix-like systems
    let normalizedDir = directory.trim();

    if (normalizedDir.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '~';
      normalizedDir = normalizedDir.replace(/^~/, home);
    }

    // On Unix-like systems, allow "Users/..." or "home/..." by prepending /
    if (process.platform !== 'win32' && !path.isAbsolute(normalizedDir)) {
      normalizedDir = '/' + normalizedDir;
    }

// Normalize the path for the current operating system
normalizedDir = path.resolve(normalizedDir);

    let isValidDir = false;
    try {
      isValidDir = fs.existsSync(normalizedDir) && fs.statSync(normalizedDir).isDirectory();
    } catch (err) {
      isValidDir = false;
    }

    if (!isValidDir) {
      return reply.code(400).send({ error: `Invalid directory path: "${normalizedDir}" - Please check it exists and is accessible.` });
    }

    // Report progress from here on; the client polls /scan-progress meanwhile.
    resetScanProgress();
    scanProgress.active = true;
    scanProgress.phase = 'discovering';

    try {
    // The folder is this profile's own; someone else's is untouched.
    setProfileSetting(profileId, 'video_directory', normalizedDir);

    // Every local video already known, whoever's library it's in, so a file two
    // profiles share keeps one row (and its tags). Scoped to local videos:
    // external (YouTube) rows have no file on disk and must never be touched by
    // a scan.
    const existingVideos = db.prepare(
      "SELECT id, filepath, duration_seconds FROM videos WHERE source = 'local'"
    ).all() as { id: string; filepath: string; duration_seconds: number | null }[];
    const existingMap = new Map(existingVideos.map(v => [v.filepath, v.id]));
    const existingDurations = new Map(existingVideos.map(v => [v.filepath, v.duration_seconds]));
    // What this profile's library held before the scan.
    const libraryBefore = db.prepare(`
      SELECT pv.video_id AS id FROM profile_videos pv JOIN videos v ON v.id = pv.video_id
      WHERE pv.profile_id = ? AND v.source = 'local'
    `).all(profileId) as { id: string }[];

    // Get exclude paths
    const excludePaths = JSON.parse(getProfileSetting(profileId, 'exclude_paths') || '[]');

    // Scan directory
    const { files: videoFiles, unreadable } = scanDirectory(normalizedDir, excludePaths);
    const scannedIds = new Set<string>();

    scanProgress.phase = 'processing';
    scanProgress.total = videoFiles.length;

    // Process one by one to handle async thumbnail generation
    for (const file of videoFiles) {
      scanProgress.currentFile = path.basename(file);
      // Store with `/` so library/dashboard/player grouping works on every OS.
      const relativePath = path.relative(normalizedDir, file).split(path.sep).join('/');
      let id = existingMap.get(file);
      
      if (id) {
        // Update existing (maybe thumbnail is missing). Only probe the duration
        // when it isn't known yet, so repeat scans stay fast.
        const thumbnailPath = await generateThumbnail(file, id);
        const knownDuration = existingDurations.get(file) ?? null;
        const duration = knownDuration ?? await probeDuration(file);
        db.prepare('UPDATE videos SET filename = ?, thumbnail_path = ?, duration_seconds = ?, file_created_at = COALESCE(file_created_at, ?) WHERE id = ?')
          .run(path.basename(file), thumbnailPath, duration, fileCreatedAt(file), id);
      } else {
        // Insert new video
        id = nanoid();
        const thumbnailPath = await generateThumbnail(file, id);
        const duration = await probeDuration(file);
        db.prepare('INSERT INTO videos (id, filename, filepath, relative_path, thumbnail_path, duration_seconds, file_created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, path.basename(file), file, relativePath, thumbnailPath, duration, fileCreatedAt(file));
      }
      // In this profile's library, at its path from this profile's folder. The
      // favourite star survives a rescan.
      db.prepare(`
        INSERT INTO profile_videos (profile_id, video_id, relative_path, in_library) VALUES (?, ?, ?, 1)
        ON CONFLICT(profile_id, video_id) DO UPDATE SET relative_path = excluded.relative_path, in_library = 1
      `).run(profileId, id, relativePath);
      scannedIds.add(id);
      scanProgress.processed++;
    }

    // Remove videos whose files are gone — but only when the scan actually saw
    // the whole folder. A video row carries tags and a description the user
    // typed by hand and cannot get back, while a stale row is a cosmetic
    // nuisance, so anything less than a complete, trustworthy read of the
    // filesystem means adding and updating only.
    //
    // Two ways the view can be untrustworthy: a directory that couldn't be
    // read (permissions, an unplugged drive, a folder renamed mid-scan), or a
    // find of nothing at all where the library previously had videos — which
    // in practice is never a user deleting their entire collection between
    // scans, and always something wrong with the path.
    //
    // With profiles, "gone" has two meanings, kept strictly apart:
    //   - not in this profile's folder any more → it leaves THIS profile's
    //     library only. Someone else may still have it in theirs.
    //   - its file sat inside the scanned folder and no longer exists on disk
    //     → the video is gone for everyone, so its row goes. Checked file by
    //     file, so a scan of one person's folder can never delete videos that
    //     live in someone else's.
    const emptiedEverything = videoFiles.length === 0 && libraryBefore.length > 0;
    const canReconcile = unreadable.length === 0 && !emptiedEverything;

    let removed = 0;
    if (canReconcile) {
      // Videos this profile's own plans use stay, wherever they live — a plan
      // copied from someone else shouldn't empty out the moment its new owner
      // picks a folder of their own.
      const usedByPlans = new Set(
        (db.prepare(`
          SELECT DISTINCT j.value AS id FROM workout_plans p
          JOIN workouts w ON w.plan_id = p.id, json_each(CASE WHEN json_valid(w.video_ids) THEN w.video_ids ELSE '[]' END) j
          WHERE p.profile_id = ?
        `).all(profileId) as { id: string }[]).map(r => r.id)
      );
      const leaving = libraryBefore.filter(v => !scannedIds.has(v.id) && !usedByPlans.has(v.id));
      // Those plan videos stay for the plans, but they're no longer part of the
      // library this person browses.
      const keepForPlans = db.prepare('UPDATE profile_videos SET in_library = 0 WHERE profile_id = ? AND video_id = ?');
      for (const v of libraryBefore) {
        if (!scannedIds.has(v.id) && usedByPlans.has(v.id)) keepForPlans.run(profileId, v.id);
      }
      const dropMembership = db.prepare('DELETE FROM profile_videos WHERE profile_id = ? AND video_id = ?');
      for (const v of leaving) dropMembership.run(profileId, v.id);
      removed = leaving.length;

      const insideFolder = (file: string) => file === normalizedDir || file.startsWith(normalizedDir + path.sep);
      const deletedFiles = existingVideos.filter(v =>
        !scannedIds.has(v.id) && insideFolder(v.filepath) && !fs.existsSync(v.filepath));
      for (const v of deletedFiles) {
        db.prepare('DELETE FROM profile_videos WHERE video_id = ?').run(v.id);
        db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
      }
    } else {
      console.warn(
        `[Library] Skipped removing missing videos: ` +
        `${unreadable.length} unreadable path(s), found ${videoFiles.length} file(s), ` +
        `${libraryBefore.length} already in the library.`
      );
    }

    // Rematch this profile's plans to fix any stale video IDs or paths
    rematchAllPlans(profileId);

    scanProgress.phase = 'done';
    return reply.send({
      success: true,
      count: videoFiles.length,
      removed,
      // The client warns rather than reporting a clean scan, so a folder that
      // has silently become unreadable is visible instead of looking empty.
      skippedCleanup: !canReconcile,
      unreadableCount: unreadable.length,
      unreadableSample: unreadable.slice(0, 3),
    });
    } finally {
      // The client reads the final counts from the response, so the shared slot
      // is released either way — including when the scan throws partway through.
      scanProgress.active = false;
      scanProgress.currentFile = '';
    }
  });

  fastify.get('/videos', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const videos = db.prepare(`SELECT ${VIDEO_COLUMNS} FROM ${PROFILE_VIDEOS} AS videos`).all(profileId) as any[];
    const counts = completionCounts(profileId, videos);
    return reply.send(videos.map(row => ({ ...formatVideoRow(row), completed_count: counts.get(row.id) || 0 })));
  });

  // Star or un-star a video.
  fastify.put('/videos/:id/favorite', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const { id } = request.params as { id: string };
    const { favorite } = request.body as { favorite?: boolean };

    // The star is per person.
    const value = favorite ? 1 : 0;
    const { changes } = db.prepare('UPDATE profile_videos SET is_favorite = ? WHERE profile_id = ? AND video_id = ?')
      .run(value, profileId, id);
    if (!changes) return reply.code(404).send({ error: 'Video not found' });
    return reply.send({ success: true, isFavorite: value === 1 });
  });

  fastify.patch('/videos/:id', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const { id } = request.params as { id: string };
    const body = request.body as { description?: string; equipment?: string[]; training_type?: string[]; body_parts?: string[]; intensity?: string };

    // Tags and descriptions are shared (a video is the same video for everyone),
    // but only someone with the video in their library can edit them.
    const existing = db.prepare('SELECT 1 FROM profile_videos WHERE profile_id = ? AND video_id = ?').get(profileId, id);
    if (!existing) {
      return reply.code(404).send({ error: 'Video not found' });
    }

    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const equipment = Array.isArray(body.equipment)
      ? body.equipment.filter((item): item is string =>
          typeof item === 'string' && VALID_EQUIPMENT.includes(item as typeof VALID_EQUIPMENT[number])
        )
      : [];

    const training_type = Array.isArray(body.training_type)
      ? body.training_type.filter((item): item is string => typeof item === 'string' && (VALID_TRAINING_TYPES as readonly string[]).includes(item))
      : [];

    const body_parts = Array.isArray(body.body_parts)
      ? body.body_parts.filter((item): item is string => typeof item === 'string' && (VALID_BODY_PARTS as readonly string[]).includes(item))
      : [];

    const intensity = typeof body.intensity === 'string' && (VALID_INTENSITIES as readonly string[]).includes(body.intensity) ? body.intensity : '';

    db.prepare('UPDATE videos SET description = ?, equipment = ?, training_type = ?, body_parts = ?, intensity = ? WHERE id = ?')
      .run(description, JSON.stringify(equipment), JSON.stringify(training_type), JSON.stringify(body_parts), intensity, id);

    const updated = db.prepare(`SELECT ${VIDEO_COLUMNS} FROM ${PROFILE_VIDEOS} AS videos WHERE id = ?`).get(profileId, id) as any;

    return reply.send(formatVideoRow(updated));
  });
}
