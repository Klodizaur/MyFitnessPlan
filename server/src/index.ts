import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db.js';
import libraryRoutes from './routes/library.js';
import planRoutes from './routes/plan.js';
import scheduleRoutes from './routes/schedule.js';
import profileRoutes from './routes/profile.js';
import externalRoutes from './routes/external.js';
import aiRoutes from './routes/ai.js';

const fastify = Fastify({ logger: true });

// Register plugins
fastify.register(cors, { origin: true }); // Allow all for local app
fastify.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB for CSVs
  }
});

// Register static for the decorator only
fastify.register(fastifyStatic, {
  root: process.cwd(), 
  prefix: '/static-placeholder/', // We won't use this directly
  decorateReply: true
});

// In the packaged desktop app, serve the built client from the SAME origin as the
// API, so the frontend's relative URLs work on whatever port we happen to bind to.
// Enabled only when MYFITNESSPLAN_CLIENT_DIR is set (the desktop wrapper sets it).
// It is unset during `npm run dev`, so dev behaviour is unchanged.
const clientDist = process.env.MYFITNESSPLAN_CLIENT_DIR;
if (clientDist && fs.existsSync(clientDist)) {
  fastify.register(fastifyStatic, {
    root: clientDist,
    prefix: '/',
    index: false,
    decorateReply: false,
  });
  const indexHtmlPath = path.join(clientDist, 'index.html');
  // Serve the SPA shell at the root (static with index:false 403s on a directory).
  fastify.get('/', (_request, reply) => reply.type('text/html').send(fs.readFileSync(indexHtmlPath)));
  // SPA fallback: serve index.html for client-side (BrowserRouter) routes.
  fastify.setNotFoundHandler((request, reply) => {
    const url = request.raw.url || '';
    if (
      request.method === 'GET' &&
      !url.startsWith('/api') &&
      !url.startsWith('/videos') &&
      !url.startsWith('/thumbnails') &&
      !url.startsWith('/plan-backgrounds')
    ) {
      return reply.type('text/html').send(fs.readFileSync(indexHtmlPath));
    }
    reply.callNotFound();
  });
}

// How much of a video to send when the player asks for "the rest of the file".
// Chromium streams happily in steps; sending hundreds of MB in one reply stalls
// playback of large files until the entire body has been received.
const MAX_STREAM_CHUNK = 4 * 1024 * 1024; // 4 MB

// Content-Type from the extension. The route previously labelled everything
// video/mp4, which misdescribes .webm/.mkv/.mov files to the player.
const VIDEO_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

function videoContentType(filePath: string): string {
  return VIDEO_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// A read stream that gives up cleanly. Without this a mid-transfer read error
// (a disconnected drive, a file replaced under us) leaves the request hanging
// open, which the player shows as a video that never loads.
function streamFile(filePath: string, options?: { start: number; end: number }) {
  const stream = fs.createReadStream(filePath, options);
  stream.on('error', err => {
    fastify.log.error({ err, filePath }, 'video stream failed');
    stream.destroy();
  });
  return stream;
}

// Dynamic video route
fastify.get('/videos/*', async (request, reply) => {
  const stmt = db.prepare("SELECT value FROM settings WHERE key = 'video_directory'");
  const row = stmt.get() as { value: string } | undefined;
  const videoDir = row?.value;
  
  if (!videoDir) {
    return reply.code(404).send({ error: 'Video directory not configured' });
  }

  // Accept either `/` or `\` in the URL; resolve with the OS path module.
  const relativePath = decodeURIComponent((request.params as any)['*']).replace(/\\/g, '/');
  const fullPath = path.join(videoDir, ...relativePath.split('/').filter(Boolean));

  if (!fs.existsSync(fullPath)) {
    fastify.log.error(`File not found: ${fullPath}`);
    return reply.code(404).send({ error: 'Video file not found' });
  }

  const stat = fs.statSync(fullPath);
  const fileSize = stat.size;
  const range = request.headers.range;
  const contentType = videoContentType(fullPath);

  if (!range) {
    reply
      .header('Content-Type', contentType)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', fileSize);

    return reply.send(streamFile(fullPath));
  }

  // Only "bytes=" ranges are meaningful here; anything else falls back to the
  // whole file rather than being mis-parsed into NaN offsets.
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) {
    reply
      .header('Content-Type', contentType)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', fileSize);
    return reply.send(streamFile(fullPath));
  }

  const [, rawStart, rawEnd] = match;

  // A suffix range ("bytes=-500") asks for the final N bytes. Players use this to
  // grab an MP4's trailing `moov` atom, so it has to work.
  let start: number;
  let end: number;
  const clientGaveEnd = rawEnd !== '';
  if (rawStart === '') {
    const suffixLength = Math.min(parseInt(rawEnd, 10), fileSize);
    start = fileSize - suffixLength;
    end = fileSize - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = clientGaveEnd ? parseInt(rawEnd, 10) : fileSize - 1;
  }

  // Unsatisfiable range: answer 416 with the real size instead of a broken stream.
  if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
    return reply
      .code(416)
      .header('Content-Range', `bytes */${fileSize}`)
      .send();
  }
  end = Math.min(Number.isFinite(end) ? end : fileSize - 1, fileSize - 1);
  if (end < start) end = fileSize - 1;

  // The important part. An open-ended range ("bytes=X-") means "the rest of the
  // file", and answering it literally produced ~795MB in a single reply. A player
  // cannot start until enough of that body has arrived, so a large video stalls.
  // Every reply is now capped: HTTP explicitly allows returning less than asked
  // for, as long as Content-Range describes what was actually sent, and players
  // simply request the next span. No single response can stall playback again.
  end = Math.min(start + MAX_STREAM_CHUNK - 1, end);

  const chunkSize = end - start + 1;

  // Logged so a failing machine produces evidence: compare what the player asked
  // for against what was served. Visible in the desktop app's log.
  fastify.log.info(
    `video range ${path.basename(fullPath)} req="${range}" -> ${start}-${end}/${fileSize} (${chunkSize}B)`
  );

  reply
    .code(206)
    .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
    .header('Accept-Ranges', 'bytes')
    .header('Content-Length', chunkSize)
    .header('Content-Type', contentType);

  return reply.send(streamFile(fullPath, { start, end }));
});

// Serve thumbnails
fastify.get('/thumbnails/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  const thumbPath = path.join(process.cwd(), 'data', 'thumbnails', filename);

  if (!fs.existsSync(thumbPath)) {
    return reply.code(404).send({ error: 'Thumbnail not found' });
  }

  return reply.sendFile(filename, path.join(process.cwd(), 'data', 'thumbnails'));
});

// Serve custom plan background images
const planBackgroundsDir = path.join(process.cwd(), 'data', 'plan-backgrounds');
if (!fs.existsSync(planBackgroundsDir)) {
  fs.mkdirSync(planBackgroundsDir, { recursive: true });
}
fastify.get('/plan-backgrounds/:filename', async (request, reply) => {
  const { filename } = request.params as { filename: string };
  const imgPath = path.join(planBackgroundsDir, filename);

  if (!fs.existsSync(imgPath)) {
    return reply.code(404).send({ error: 'Image not found' });
  }

  return reply.sendFile(filename, planBackgroundsDir);
});

// Register routes
fastify.register(libraryRoutes, { prefix: '/api/library' });
fastify.register(planRoutes, { prefix: '/api/plan' });
fastify.register(scheduleRoutes, { prefix: '/api/schedule' });
fastify.register(profileRoutes, { prefix: '/api/profile' });
fastify.register(externalRoutes, { prefix: '/api/external' });
fastify.register(aiRoutes, { prefix: '/api/ai' });

// App version. The packaged desktop app injects MYFITNESSPLAN_VERSION; otherwise
// we fall back to this package's version. Exposed so the UI shows it automatically.
const appVersion = (() => {
  if (process.env.MYFITNESSPLAN_VERSION) return process.env.MYFITNESSPLAN_VERSION;
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
fastify.get('/api/version', async (_request, reply) => reply.send({ version: appVersion }));

// Generic settings route
fastify.get('/api/settings', async (request, reply) => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsObj = settings.reduce((acc: any, curr: any) => {
    // `ai_*` rows hold the optional AI integration's config, including an API
    // key. They are served by /api/ai/settings, which never returns the key —
    // this endpoint must not leak it through the generic dump.
    if (curr.key.startsWith('ai_')) return acc;
    acc[curr.key] = (curr.key === 'workout_pattern' || curr.key === 'exclude_paths')
      ? JSON.parse(curr.value)
      : curr.value;
    return acc;
  }, {});
  return reply.send(settingsObj);
});

fastify.post('/api/settings', async (request, reply) => {
  const body = request.body as any;
  const updateStmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  
  if (body.workout_pattern !== undefined) {
    updateStmt.run(JSON.stringify(body.workout_pattern), 'workout_pattern');
  }
  if (body.start_date !== undefined) {
    updateStmt.run(body.start_date, 'start_date');
  }
  if (body.exclude_paths !== undefined) {
    updateStmt.run(JSON.stringify(body.exclude_paths), 'exclude_paths');
  }
  if (body.theme !== undefined) {
    updateStmt.run(body.theme, 'theme');
  if (body.calendar_view !== undefined) {
    updateStmt.run(body.calendar_view, 'calendar_view');
  }  }
  return reply.send({ success: true });
});


const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const start = async () => {
  try {
    await fastify.listen({ port, host });
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
