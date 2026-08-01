import { FastifyInstance } from 'fastify';
import db from '../db.js';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { exec } from 'child_process';
import { promisify } from 'util';
import { rematchAllPlans } from '../matcher.js';

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

function formatVideoRow(row: {
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
  };
}

function scanDirectory(dir: string, excludePaths: string[], fileList: string[] = []): string[] {
  try {
    const normalizedDir = path.resolve(dir);
    
    // Check if current directory is in exclude list
    if (excludePaths.some(ex => {
      const normalizedEx = path.resolve(ex.trim().replace(/^~/, process.env.HOME || '~'));
      return normalizedDir === normalizedEx || normalizedDir.startsWith(normalizedEx + path.sep);
    })) {
      console.log(`[Library] Excluding directory: ${normalizedDir}`);
      return fileList;
    }

    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scanDirectory(fullPath, excludePaths, fileList);
      } else {
        if (VIDEO_EXTENSIONS.includes(path.extname(fullPath).toLowerCase())) {
          fileList.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dir}:`, err);
  }
  return fileList;
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
    // Save to settings
    db.prepare("UPDATE settings SET value = ? WHERE key = 'video_directory'").run(normalizedDir);

    // Get existing videos for stable IDs
    const existingVideos = db.prepare('SELECT id, filepath, duration_seconds FROM videos').all() as { id: string; filepath: string; duration_seconds: number | null }[];
    const existingMap = new Map(existingVideos.map(v => [v.filepath, v.id]));
    const existingDurations = new Map(existingVideos.map(v => [v.filepath, v.duration_seconds]));
    
    // Get exclude paths
    const excludeRow = db.prepare("SELECT value FROM settings WHERE key = 'exclude_paths'").get() as { value: string } | undefined;
    const excludePaths = JSON.parse(excludeRow?.value || '[]');

    // Scan directory
    const videoFiles = scanDirectory(normalizedDir, excludePaths);
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
        db.prepare('UPDATE videos SET filename = ?, relative_path = ?, thumbnail_path = ?, duration_seconds = ? WHERE id = ?')
          .run(path.basename(file), relativePath, thumbnailPath, duration, id);
      } else {
        // Insert new video
        id = nanoid();
        const thumbnailPath = await generateThumbnail(file, id);
        const duration = await probeDuration(file);
        db.prepare('INSERT INTO videos (id, filename, filepath, relative_path, thumbnail_path, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)')
          .run(id, path.basename(file), file, relativePath, thumbnailPath, duration);
      }
      scannedIds.add(id);
      scanProgress.processed++;
    }

    // Delete videos that no longer exist in filesystem
    const toDelete = existingVideos.filter(v => !scannedIds.has(v.id));
    for (const v of toDelete) {
      db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
    }

    // Rematch all plans to fix any stale video IDs or paths
    rematchAllPlans();

    scanProgress.phase = 'done';
    return reply.send({ success: true, count: videoFiles.length });
    } finally {
      // The client reads the final counts from the response, so the shared slot
      // is released either way — including when the scan throws partway through.
      scanProgress.active = false;
      scanProgress.currentFile = '';
    }
  });

  fastify.get('/videos', async (request, reply) => {
    const videos = db.prepare(
      'SELECT id, filename, relative_path, thumbnail_path, description, equipment, training_type, body_parts, intensity, duration_seconds FROM videos'
    ).all() as any[];
    return reply.send(videos.map(formatVideoRow));
  });

  fastify.patch('/videos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { description?: string; equipment?: string[]; training_type?: string[]; body_parts?: string[]; intensity?: string };

    const existing = db.prepare('SELECT id FROM videos WHERE id = ?').get(id);
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

    const updated = db.prepare(
      'SELECT id, filename, relative_path, thumbnail_path, description, equipment, training_type, body_parts, intensity, duration_seconds FROM videos WHERE id = ?'
    ).get(id) as any;

    return reply.send(formatVideoRow(updated));
  });
}
