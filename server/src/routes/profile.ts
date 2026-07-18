import { FastifyInstance } from 'fastify';
import db from '../db.js';

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default async function (fastify: FastifyInstance) {
  // Persistent workout history for the Profile page.
  // workout_log rows are denormalized snapshots (so names survive plan edits/deletes),
  // while metadata tags (training type, body parts, intensity, equipment) are joined
  // LIVE from the videos table so the activity summary reflects the latest tagging.
  fastify.get('/history', async (_request, reply) => {
    const rows = db.prepare(`
      SELECT
        l.id,
        l.workout_id,
        l.video_id,
        l.plan_name,
        l.workout_name,
        COALESCE(v.filename, l.video_filename) AS video_filename,
        COALESCE(v.thumbnail_path, l.thumbnail_path) AS thumbnail_path,
        l.completed_date,
        l.completed_at,
        l.is_manual,
        CASE WHEN l.is_manual = 1 AND l.video_id IS NULL THEN l.training_type ELSE v.training_type END AS training_type,
        CASE WHEN l.is_manual = 1 AND l.video_id IS NULL THEN l.body_parts    ELSE v.body_parts    END AS body_parts,
        CASE WHEN l.is_manual = 1 AND l.video_id IS NULL THEN l.intensity     ELSE v.intensity     END AS intensity,
        CASE WHEN l.is_manual = 1 AND l.video_id IS NULL THEN l.equipment     ELSE v.equipment     END AS equipment
      FROM workout_log l
      LEFT JOIN videos v ON v.id = l.video_id
      ORDER BY l.completed_date DESC, l.completed_at DESC
    `).all() as any[];

    const entries = rows.map(r => ({
      id: r.id,
      workoutId: r.workout_id,
      videoId: r.video_id,
      planName: r.plan_name,
      workoutName: r.workout_name,
      videoFilename: r.video_filename,
      thumbnail: r.thumbnail_path,
      completedDate: r.completed_date,
      completedAt: r.completed_at,
      isManual: !!r.is_manual,
      trainingType: parseJsonArray(r.training_type),
      bodyParts: parseJsonArray(r.body_parts),
      intensity: r.intensity || null,
      equipment: parseJsonArray(r.equipment),
    }));

    return reply.send({ entries });
  });

  // Change the logged date of one or more completed entries (e.g. the user marked a
  // workout done today but actually did it yesterday). This only moves entries on the
  // history calendar; it does not affect the active plan's completion state (history).
  fastify.put('/history/date', async (request, reply) => {
    const { ids, completedDate } = request.body as { ids?: string[]; completedDate?: string };

    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string')) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of strings' });
    }
    if (typeof completedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
      return reply.code(400).send({ error: 'completedDate must be a YYYY-MM-DD string' });
    }
    // Reject impossible dates (e.g. 2024-02-30) using local components so there is no
    // timezone drift from the incoming string.
    const [y, m, d] = completedDate.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    const isRealDate =
      parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
    if (!isRealDate) {
      return reply.code(400).send({ error: 'completedDate is not a valid calendar date' });
    }

    const update = db.prepare('UPDATE workout_log SET completed_date = ? WHERE id = ?');
    const applyUpdates = db.transaction((entryIds: string[]) => {
      let updated = 0;
      for (const id of entryIds) {
        updated += update.run(completedDate, id).changes;
      }
      return updated;
    });
    const updated = applyUpdates(ids);

    return reply.send({ success: true, updated });
  });

  // Manually log workouts the user did outside the app, for a past-or-today date.
  // Each selected library video becomes its own separate entry (tags read live from
  // the linked video), and a typed name adds one more custom entry that carries the
  // chosen tags. At least one of (name, videos) is required.
  fastify.post('/history', async (request, reply) => {
    const body = (request.body ?? {}) as {
      completedDate?: string;
      workoutName?: string;
      equipment?: unknown;
      trainingType?: unknown;
      bodyParts?: unknown;
      intensity?: unknown;
      videoIds?: unknown;
    };

    const { completedDate } = body;
    if (typeof completedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(completedDate)) {
      return reply.code(400).send({ error: 'completedDate must be a YYYY-MM-DD string' });
    }
    const [y, m, d] = completedDate.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    const isRealDate =
      parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
    if (!isRealDate) {
      return reply.code(400).send({ error: 'completedDate is not a valid calendar date' });
    }
    // Local "today" for this desktop app (server clock == user clock). ISO date
    // strings compare correctly lexicographically, so a plain string check works.
    const now = new Date();
    const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .split('T')[0];
    if (completedDate > todayStr) {
      return reply.code(400).send({ error: 'Cannot log a workout for a future date' });
    }

    const name = typeof body.workoutName === 'string' ? body.workoutName.trim() : '';

    const asStrArray = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string') : [];
    const equipment = asStrArray(body.equipment);
    const trainingType = asStrArray(body.trainingType);
    const bodyParts = asStrArray(body.bodyParts);
    const intensity =
      body.intensity === 'low' || body.intensity === 'medium' || body.intensity === 'high'
        ? body.intensity
        : null;

    // Resolve requested videos to existing rows, preserving order and dropping dupes.
    const seen = new Set<string>();
    const videos: { id: string; filename: string | null; thumbnail_path: string | null }[] = [];
    for (const vid of asStrArray(body.videoIds)) {
      if (seen.has(vid)) continue;
      seen.add(vid);
      const v = db
        .prepare('SELECT id, filename, thumbnail_path FROM videos WHERE id = ?')
        .get(vid) as { id: string; filename?: string; thumbnail_path?: string } | undefined;
      if (v) videos.push({ id: v.id, filename: v.filename ?? null, thumbnail_path: v.thumbnail_path ?? null });
    }

    if (!name && videos.length === 0) {
      return reply.code(400).send({ error: 'Provide a workout name or select at least one video' });
    }

    const { nanoid } = await import('nanoid');
    // Drop the file extension so a video "Full Body HIIT.mp4" logs as "Full Body HIIT".
    const stripExt = (f: string) => f.replace(/\.[^/.]+$/, '');

    const insert = db.prepare(`
      INSERT INTO workout_log
        (id, workout_id, video_id, plan_name, workout_name, video_filename, thumbnail_path,
         completed_date, is_manual, training_type, body_parts, intensity, equipment)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
    `);

    const workoutIds: string[] = [];
    const create = db.transaction(() => {
      // Each library video is logged as its own entry with a unique workout_id, so
      // they show up separately on the calendar instead of grouping together. Tag
      // columns stay null here — /history reads them live from the linked video.
      for (const v of videos) {
        const wid = `manual-${nanoid()}`;
        workoutIds.push(wid);
        insert.run(nanoid(), wid, v.id, null,
          v.filename ? stripExt(v.filename) : (name || null),
          v.filename, v.thumbnail_path, completedDate,
          null, null, null, null);
      }
      // A typed name adds one more separate custom entry carrying the chosen tags.
      if (name) {
        const wid = `manual-${nanoid()}`;
        workoutIds.push(wid);
        insert.run(nanoid(), wid, null, null, name, null, null, completedDate,
          JSON.stringify(trainingType), JSON.stringify(bodyParts), intensity, JSON.stringify(equipment));
      }
    });
    create();

    return reply.send({ success: true, workoutIds });
  });

  // Remove a manually-added workout (all its rows). Guarded to is_manual = 1 so
  // app-completion history can never be deleted through this endpoint.
  fastify.delete('/history/:workoutId', async (request, reply) => {
    const { workoutId } = request.params as { workoutId: string };
    if (!workoutId) {
      return reply.code(400).send({ error: 'workoutId is required' });
    }
    const result = db
      .prepare('DELETE FROM workout_log WHERE workout_id = ? AND is_manual = 1')
      .run(workoutId);
    return reply.send({ success: true, deleted: result.changes });
  });
}
