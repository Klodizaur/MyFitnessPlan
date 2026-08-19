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
        l.notes,
        v.duration_seconds,
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
      notes: r.notes || '',
      // Runtime of the linked video, when the library has probed it. Manually
      // logged entries have no video and therefore no duration.
      durationSeconds: typeof r.duration_seconds === 'number' ? r.duration_seconds : null,
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

  // Attach (or clear) a free-text note on a logged workout. The note is written to
  // every row of that workout so it is present no matter which part is read back;
  // an empty string clears it.
  fastify.put('/history/notes', async (request, reply) => {
    const { ids, notes } = request.body as { ids?: string[]; notes?: string };

    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(id => typeof id === 'string')) {
      return reply.code(400).send({ error: 'ids must be a non-empty array of strings' });
    }
    if (typeof notes !== 'string') {
      return reply.code(400).send({ error: 'notes must be a string' });
    }
    const value = notes.trim().slice(0, 2000) || null;

    const update = db.prepare('UPDATE workout_log SET notes = ? WHERE id = ?');
    const applyUpdates = db.transaction((entryIds: string[]) => {
      let updated = 0;
      for (const id of entryIds) {
        updated += update.run(value, id).changes;
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

  /**
   * How far through each plan you are, and which ones you've finished.
   *
   * Read from `history` — the same rows that put the ✓ on the calendar — so a
   * plan counts as finished exactly when its calendar says every workout day is
   * done. That ties this to plans that still exist: editing a plan clears its
   * completion history by design, and deleting one takes its history with it,
   * so this is "plans in the app you've finished", not an all-time tally.
   */
  fastify.get('/plan-progress', async (_request, reply) => {
    const plans = db.prepare(
      'SELECT id, name, is_active, category FROM workout_plans ORDER BY uploaded_at DESC'
    ).all() as any[];
    const workouts = db.prepare('SELECT id, plan_id, video_ids FROM workouts').all() as any[];
    const history = db.prepare('SELECT workout_id, video_id FROM history').all() as any[];

    const doneWorkouts = new Set(history.filter(h => !h.video_id).map(h => h.workout_id));
    const doneVideos = new Set(history.filter(h => h.video_id).map(h => `${h.workout_id}:${h.video_id}`));

    // Mirrors the schedule route: a day is done when it has a day-level mark, or
    // when every video on it has been marked.
    const isWorkoutDone = (w: any): boolean => {
      if (doneWorkouts.has(w.id)) return true;
      const ids = parseJsonArray(w.video_ids);
      return ids.length > 0 && ids.every(vid => doneVideos.has(`${w.id}:${vid}`));
    };

    const progress = plans.map(plan => {
      const own = workouts.filter(w => w.plan_id === plan.id);
      const completed = own.filter(isWorkoutDone).length;
      return {
        id: plan.id,
        name: plan.name,
        category: plan.category ?? null,
        slot: plan.is_active === 2 ? 'extra' : plan.is_active === 1 ? 'main' : null,
        totalWorkouts: own.length,
        completedWorkouts: completed,
        isFinished: own.length > 0 && completed === own.length,
      };
    });

    // Plans you've carried to the end, kept whatever happens to the plan
    // afterwards. This is the durable half: `progress` above describes plans
    // that still exist, this describes things you did.
    const finished = db.prepare(`
      SELECT id, plan_id, plan_name, workout_count, started_on, finished_on, days_taken
      FROM plan_completions
      ORDER BY finished_on DESC, finished_at DESC
    `).all() as any[];

    return reply.send({
      plans: progress,
      finished: finished.map(row => ({
        id: row.id,
        planId: row.plan_id,
        planName: row.plan_name,
        workoutCount: row.workout_count,
        startedOn: row.started_on,
        finishedOn: row.finished_on,
        daysTaken: row.days_taken,
      })),
      finishedCount: finished.length,
      inProgress: progress.filter(p => !p.isFinished && p.completedWorkouts > 0).length,
    });
  });

  // Remove a finished-plan record. The only way to erase one, since nothing
  // else does: deleting or editing the plan itself deliberately leaves it.
  fastify.delete('/plan-completions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!id) return reply.code(400).send({ error: 'id is required' });
    const result = db.prepare('DELETE FROM plan_completions WHERE id = ?').run(id);
    return reply.send({ success: true, deleted: result.changes });
  });

  // Remove a logged workout (all its rows), whether it was added by hand or
  // marked done in the player.
  //
  // A workout completed inside a plan is recorded twice: here in `workout_log`,
  // which is the durable record this page shows, and in `history`, which is what
  // puts the ✓ on the calendar. Deleting only the log row would leave the plan
  // still claiming the workout was done, so both go — the same pairing the
  // player's un-mark already does. Manual entries have a `manual-` workout id
  // that never appears in `history`, so that delete is a no-op for them.
  fastify.delete('/history/:workoutId', async (request, reply) => {
    const { workoutId } = request.params as { workoutId: string };
    if (!workoutId) {
      return reply.code(400).send({ error: 'workoutId is required' });
    }

    let deleted = 0;
    let unmarked = 0;
    db.transaction(() => {
      deleted = db.prepare('DELETE FROM workout_log WHERE workout_id = ?').run(workoutId).changes;
      unmarked = db.prepare('DELETE FROM history WHERE workout_id = ?').run(workoutId).changes;
    })();

    return reply.send({ success: true, deleted, unmarked });
  });
}
