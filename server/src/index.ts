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

// Dynamic video route
fastify.get('/videos/*', async (request, reply) => {
  const stmt = db.prepare("SELECT value FROM settings WHERE key = 'video_directory'");
  const row = stmt.get() as { value: string } | undefined;
  const videoDir = row?.value;
  
  if (!videoDir) {
    return reply.code(404).send({ error: 'Video directory not configured' });
  }

  const relativePath = decodeURIComponent((request.params as any)['*']);
  const fullPath = path.join(videoDir, relativePath);

  if (!fs.existsSync(fullPath)) {
    fastify.log.error(`File not found: ${fullPath}`);
    return reply.code(404).send({ error: 'Video file not found' });
  }

  return reply.sendFile(relativePath, videoDir);
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
