import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import os from 'os';
import db from './db.js';
import libraryRoutes from './routes/library.js';
import planRoutes from './routes/plan.js';
import scheduleRoutes from './routes/schedule.js';
import profileRoutes from './routes/profile.js';
import externalRoutes from './routes/external.js';
import aiRoutes from './routes/ai.js';
import profilesRoutes from './routes/profiles.js';
import { startBackupSchedule } from './profileBackup.js';
import {
  currentProfileId, getProfileSetting, isLocalRequest, isProfileSetting, PROFILE_VIDEOS, requireProfile, setProfileSetting,
} from './profiles.js';
import { appVersion } from './version.js';
import { clientProfile, copyPlan, decidePlayback, mediaForVideo, probeMedia } from './playback.js';
import { hlsPlaylist, hlsSegment, progressiveMp4, SEGMENT_SECONDS, segmentCount } from './transcode.js';
import type { FfmpegProcess } from './transcode.js';

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

/** A profile's library root, or null when it has not picked one. */
function videoDirectory(profileId: string | null): string | null {
  return profileId ? getProfileSetting(profileId, 'video_directory') || null : null;
}

/**
 * Resolve a `/videos/...` URL to a file inside the library, or null if it points
 * anywhere else. Dropping `..` segments and then re-checking the resolved path
 * against the root means a crafted URL cannot walk out of the library — which
 * matters now that the server can be reachable from other devices on the network.
 */
function resolveLibraryFile(relativePath: string, profileId: string | null): string | null {
  const videoDir = videoDirectory(profileId);
  if (!videoDir) return null;
  const segments = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..');
  const root = path.resolve(videoDir);
  const full = path.resolve(root, ...segments);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

// Dynamic video route
fastify.get('/videos/*', async (request, reply) => {
  // Paths are relative to the requesting profile's own library folder.
  const profileId = currentProfileId(request);
  // Accept either `/` or `\` in the URL; resolve with the OS path module.
  const relativePath = decodeURIComponent((request.params as any)['*']);

  // Looked up in the profile's library and served from the file itself, so a
  // video that came with a copied plan plays even if it isn't under this
  // person's own folder (or they haven't picked one yet). Anything not in the
  // library falls back to their folder.
  const known = profileId
    ? db.prepare(`
        SELECT v.filepath FROM profile_videos pv JOIN videos v ON v.id = pv.video_id
        WHERE pv.profile_id = ? AND pv.relative_path = ? AND v.source = 'local'
      `).get(profileId, relativePath.replace(/\\/g, '/')) as { filepath: string } | undefined
    : undefined;
  if (!known && !videoDirectory(profileId)) {
    return reply.code(404).send({ error: 'Video directory not configured' });
  }
  const fullPath = known?.filepath && fs.existsSync(known.filepath)
    ? known.filepath
    : resolveLibraryFile(relativePath, profileId);

  if (!fullPath || !fs.existsSync(fullPath)) {
    fastify.log.error(`File not found: ${fullPath ?? `outside the library (${relativePath})`}`);
    return reply.code(404).send({ error: 'Video file not found' });
  }

  // `?transcode=1` is the Chromium fallback: a fragmented MP4 that starts playing
  // before it is finished. Only reached when /api/playback asked for it.
  const query = request.query as { transcode?: string; start?: string };
  if (query.transcode === '1') {
    const row = db
      .prepare('SELECT video_id AS id FROM profile_videos WHERE profile_id = ? AND relative_path = ?')
      .get(profileId, relativePath.replace(/\\/g, '/')) as { id: string } | undefined;
    const info = row
      ? await mediaForVideo(row.id, fullPath)
      : await probeMedia(fullPath);
    const profile = clientProfile(request.headers['user-agent']);
    const decision = decidePlayback(fullPath, info, profile);
    const copy = copyPlan(info, 'stream', profile);
    const start = Math.max(0, Number.parseFloat(query.start || '0') || 0);
    fastify.log.info(
      `transcode ${path.basename(fullPath)} from ${start}s (${decision.reason}; ` +
      `video ${copy.video ? 'copied' : 'encoded'}, audio ${copy.audio ? 'copied' : 'encoded'})`
    );
    return pipeFfmpeg(request, reply, progressiveMp4(fullPath, start, copy, info.audioCodec !== null), 'video/mp4');
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

// --- Transcoded playback (fallback only) -------------------------------------
// Everything above serves files untouched. What follows exists for the files a
// given client cannot decode at all — an MKV on an iPad, an AC-3 track in Safari
// — and is only ever reached because /api/playback said so.

interface VideoRow {
  id: string;
  relative_path: string;
  source: string;
}

/**
 * The library file behind a video id, or null for external or missing videos —
 * or a video that isn't in the requesting profile's library.
 */
function fileForVideoId(videoId: string, profileId: string | null): { row: VideoRow; filePath: string } | null {
  if (!profileId) return null;
  const row = db
    .prepare(`SELECT id, relative_path, source, filepath FROM ${PROFILE_VIDEOS} AS videos WHERE id = ?`)
    .get(profileId, videoId) as (VideoRow & { filepath: string }) | undefined;
  if (!row || (row.source || 'local') !== 'local') return null;
  // The file itself, wherever it lives — see /videos/* above.
  const filePath = row.filepath && fs.existsSync(row.filepath)
    ? row.filepath
    : resolveLibraryFile(row.relative_path || '', profileId);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { row, filePath };
}

/**
 * Pipe an ffmpeg process into the reply, and make sure it dies with the request.
 * A player that seeks, or a phone that locks its screen, abandons the response
 * mid-encode; without this the ffmpeg behind it would keep running forever.
 */
function pipeFfmpeg(
  request: FastifyRequest,
  reply: FastifyReply,
  child: FfmpegProcess,
  contentType: string
) {
  const stop = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
  request.raw.on('close', stop);
  child.stderr.on('data', (d: Buffer) => fastify.log.warn(`[ffmpeg] ${d.toString().trim()}`));
  child.on('error', err => {
    fastify.log.error({ err }, 'ffmpeg failed to start (is it on PATH?)');
    reply.raw.destroy();
  });
  // A non-zero exit means the client got a truncated (or empty) body and will
  // report an unplayable video; the reason is only ever visible here.
  child.on('exit', code => {
    if (code) fastify.log.error(`ffmpeg exited with code ${code}`);
  });
  reply.header('Content-Type', contentType).header('Cache-Control', 'no-store');
  return reply.send(child.stdout);
}

/**
 * What this client should do with this video, and the URL to do it with.
 *
 * The client asks before it plays anything, so the answer can depend on the
 * device asking: the same file is a direct play in the desktop window and a
 * transcode on an iPhone, or the other way round.
 */
fastify.get('/api/playback/:videoId', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const found = fileForVideoId(videoId, currentProfileId(request));
  if (!found) return reply.code(404).send({ error: 'Video file not found' });

  const profile = clientProfile(request.headers['user-agent']);
  const info = await mediaForVideo(videoId, found.filePath);
  const decision = decidePlayback(found.filePath, info, profile);

  const streamPath = `/videos/${(found.row.relative_path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')}`;

  // Without a runtime there is no VOD playlist to write, so an Apple client
  // falls back to the progressive stream rather than to nothing at all.
  const mode =
    decision.mode === 'hls' && !info.durationSeconds ? 'stream' : decision.mode;

  const url =
    mode === 'direct'
      ? streamPath
      : mode === 'hls'
        ? `/videos/hls/${encodeURIComponent(videoId)}/index.m3u8`
        : `${streamPath}?transcode=1`;

  fastify.log.info(
    `playback ${found.row.relative_path} -> ${mode} (${decision.reason}; ` +
    `${decision.container} ${decision.videoCodec}/${decision.audioCodec}; client=${profile.kind})`
  );

  return reply.send({
    mode,
    url,
    reason: decision.reason,
    container: decision.container.replace('.', ''),
    videoCodec: decision.videoCodec,
    audioCodec: decision.audioCodec,
    durationSeconds: info.durationSeconds,
    client: profile.kind,
  });
});

/** The HLS playlist. Written from the runtime; no segment exists yet. */
fastify.get('/videos/hls/:videoId/index.m3u8', async (request, reply) => {
  const { videoId } = request.params as { videoId: string };
  const found = fileForVideoId(videoId, currentProfileId(request));
  if (!found) return reply.code(404).send({ error: 'Video file not found' });

  const info = await mediaForVideo(videoId, found.filePath);
  if (!info.durationSeconds) {
    return reply.code(409).send({ error: 'Runtime unknown; cannot build a playlist' });
  }

  const playlist = hlsPlaylist(info.durationSeconds, i => `segment-${i}.ts`);
  return reply
    .header('Content-Type', 'application/vnd.apple.mpegurl')
    .header('Cache-Control', 'no-store')
    .send(playlist);
});

/** One segment, encoded on demand. Any index, in any order — that is the seeking. */
fastify.get('/videos/hls/:videoId/segment-:index.ts', async (request, reply) => {
  const { videoId, index } = request.params as { videoId: string; index: string };
  const found = fileForVideoId(videoId, currentProfileId(request));
  if (!found) return reply.code(404).send({ error: 'Video file not found' });

  const info = await mediaForVideo(videoId, found.filePath);
  const i = Number.parseInt(index, 10);
  if (!Number.isInteger(i) || i < 0 || (info.durationSeconds && i >= segmentCount(info.durationSeconds))) {
    return reply.code(404).send({ error: 'No such segment' });
  }

  // The copy plan is fixed by the output being HLS, not by who is asking: a
  // segment must be self-contained whatever fetched it.
  const copy = copyPlan(info, 'hls', clientProfile(request.headers['user-agent']));
  fastify.log.info(`hls segment ${i} (${i * SEGMENT_SECONDS}s) of ${found.row.relative_path}`);
  return pipeFfmpeg(request, reply, hlsSegment(found.filePath, i, copy, info.audioCodec !== null), 'video/mp2t');
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
fastify.register(profilesRoutes, { prefix: '/api/profiles' });

// Exposed so the UI shows the running version automatically.
/**
 * The computer's name, as the TV app lists it when it finds this server on the
 * home network ("Klaudias MacBook Air" rather than just an address).
 */
const computerName = os.hostname().replace(/\.local$/i, '').replace(/[-_]+/g, ' ').trim();

fastify.get('/api/version', async (_request, reply) => reply.send({ version: appVersion, name: computerName }));

/**
 * Back up the whole app — everyone's data — into a new dated folder inside
 * `dir`: the database plus the thumbnails, plan backgrounds and profile photos
 * beside it. That's the layout the desktop app's "Import Database…" reads, so
 * this is its other half. Called from the desktop tray; the computer running
 * the app only.
 */
fastify.post('/api/backup/full', async (request, reply) => {
  if (!isLocalRequest(request)) return reply.code(403).send({ error: 'only_on_host' });
  const { dir } = (request.body ?? {}) as { dir?: string };
  let ok = false;
  try { ok = typeof dir === 'string' && path.isAbsolute(dir) && fs.statSync(dir).isDirectory(); } catch { ok = false; }
  if (!ok) return reply.code(400).send({ error: 'folder_not_found' });

  // Local time, so the folder name matches the clock on the wall.
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}-${two(now.getMinutes())}`;
  const target = path.join(dir!, `MyFitnessPlan backup ${stamp}`);
  try {
    fs.mkdirSync(target, { recursive: true });
    db.prepare('VACUUM INTO ?').run(path.join(target, 'workout-planner.db'));
    const dataDir = path.join(process.cwd(), 'data');
    for (const sub of ['thumbnails', 'plan-backgrounds', 'profile-pictures']) {
      const from = path.join(dataDir, sub);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(target, sub), { recursive: true, dereference: true });
    }
  } catch (err) {
    request.log.error(err);
    return reply.code(500).send({ error: 'backup_failed' });
  }
  return reply.send({ success: true, folder: target });
});

// Generic settings route
// Generic settings: the shared ones, with the profile's own values on top
// (rhythm, theme, calendar view, library folder, exclusions).
fastify.get('/api/settings', async (request, reply) => {
  const profileId = requireProfile(request, reply);
  if (!profileId) return;
  const settings = db.prepare('SELECT * FROM settings').all();
  const parse = (key: string, value: string | null) =>
    (key === 'workout_pattern' || key === 'exclude_paths') ? JSON.parse(value || '[]') : value;
  const settingsObj = settings.reduce((acc: any, curr: any) => {
    // `ai_*` rows hold the optional AI integration's config, including an API
    // key. They are served by /api/ai/settings, which never returns the key —
    // this endpoint must not leak it through the generic dump. Same for the
    // secret profile cookies are signed with.
    if (curr.key.startsWith('ai_') || curr.key === 'profile_secret') return acc;
    acc[curr.key] = parse(curr.key, isProfileSetting(curr.key) ? getProfileSetting(profileId, curr.key) : curr.value);
    return acc;
  }, {});
  return reply.send(settingsObj);
});

fastify.post('/api/settings', async (request, reply) => {
  const profileId = requireProfile(request, reply);
  if (!profileId) return;
  const body = request.body as any;

  if (body.workout_pattern !== undefined) {
    setProfileSetting(profileId, 'workout_pattern', JSON.stringify(body.workout_pattern));
  }
  if (body.start_date !== undefined) {
    setProfileSetting(profileId, 'start_date', body.start_date);
  }
  if (body.exclude_paths !== undefined) {
    setProfileSetting(profileId, 'exclude_paths', JSON.stringify(body.exclude_paths));
  }
  if (body.theme !== undefined) {
    setProfileSetting(profileId, 'theme', body.theme);
  }
  if (body.calendar_view !== undefined) {
    setProfileSetting(profileId, 'calendar_view', body.calendar_view);
  }
  return reply.send({ success: true });
});


const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const start = async () => {
  try {
    await fastify.listen({ port, host });
    // Each profile's automatic backups, on their own schedules.
    startBackupSchedule(msg => fastify.log.info(msg));
    console.log(`Server running on http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
