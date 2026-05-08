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

export default async function (fastify: FastifyInstance) {
  fastify.post('/set-directory', async (request, reply) => {
    const { directory } = request.body as { directory: string };

    // Normalize: expand ~ and trim whitespace
    let normalizedDir = directory.trim().replace(/^~/, process.env.HOME || '~');
    
    // Auto-prepend / if the user forgot it (e.g. "Users/klodux/..." instead of "/Users/klodux/...")
    if (!normalizedDir.startsWith('/')) {
      normalizedDir = '/' + normalizedDir;
    }

    let isValidDir = false;
    try {
      isValidDir = fs.existsSync(normalizedDir) && fs.statSync(normalizedDir).isDirectory();
    } catch (err) {
      isValidDir = false;
    }

    if (!isValidDir) {
      return reply.code(400).send({ error: `Invalid directory path: "${normalizedDir}" - Please check it exists and is accessible.` });
    }

    // Save to settings
    db.prepare("UPDATE settings SET value = ? WHERE key = 'video_directory'").run(normalizedDir);

    // Get existing videos for stable IDs
    const existingVideos = db.prepare('SELECT id, filepath FROM videos').all() as { id: string; filepath: string }[];
    const existingMap = new Map(existingVideos.map(v => [v.filepath, v.id]));
    
    // Get exclude paths
    const excludeRow = db.prepare("SELECT value FROM settings WHERE key = 'exclude_paths'").get() as { value: string } | undefined;
    const excludePaths = JSON.parse(excludeRow?.value || '[]');

    // Scan directory
    const videoFiles = scanDirectory(normalizedDir, excludePaths);
    const scannedIds = new Set<string>();

    // Process one by one to handle async thumbnail generation
    for (const file of videoFiles) {
      const relativePath = path.relative(normalizedDir, file);
      let id = existingMap.get(file);
      
      if (id) {
        // Update existing (maybe thumbnail is missing)
        const thumbnailPath = await generateThumbnail(file, id);
        db.prepare('UPDATE videos SET filename = ?, relative_path = ?, thumbnail_path = ? WHERE id = ?')
          .run(path.basename(file), relativePath, thumbnailPath, id);
      } else {
        // Insert new video
        id = nanoid();
        const thumbnailPath = await generateThumbnail(file, id);
        db.prepare('INSERT INTO videos (id, filename, filepath, relative_path, thumbnail_path) VALUES (?, ?, ?, ?, ?)')
          .run(id, path.basename(file), file, relativePath, thumbnailPath);
      }
      scannedIds.add(id);
    }

    // Delete videos that no longer exist in filesystem
    const toDelete = existingVideos.filter(v => !scannedIds.has(v.id));
    for (const v of toDelete) {
      db.prepare('DELETE FROM videos WHERE id = ?').run(v.id);
    }

    // Rematch all plans to fix any stale video IDs or paths
    rematchAllPlans();

    return reply.send({ success: true, count: videoFiles.length });
  });

  fastify.get('/videos', async (request, reply) => {
    const videos = db.prepare('SELECT id, filename, relative_path, thumbnail_path FROM videos').all();
    return reply.send(videos);
  });
}
