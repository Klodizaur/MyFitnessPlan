import { FastifyInstance } from 'fastify';
import db from '../db.js';

// Active plans occupy one of two slots: the main plan (is_active = 1) and an
// optional second plan (is_active = 2) that runs alongside it. Both are
// scheduled independently from their own start date, over the same
// workout/rest pattern.
type Slot = 'main' | 'extra';
const SLOT_BY_FLAG: Record<number, Slot> = { 1: 'main', 2: 'extra' };

function parseTags(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Whether every workout day in a plan is marked done — order irrelevant, since
 * this asks "are any left?", not "was the last one done?".
 *
 * A day counts by the same rule the schedule uses: it has a day-level mark, or
 * all of its videos are marked.
 */
function isPlanComplete(planId: string): { complete: boolean; workoutCount: number } {
  const workouts = db.prepare('SELECT id, video_ids FROM workouts WHERE plan_id = ?').all(planId) as any[];
  if (workouts.length === 0) return { complete: false, workoutCount: 0 };

  const marks = db.prepare(`
    SELECT workout_id, video_id FROM history
    WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)
  `).all(planId) as any[];
  const dayMarks = new Set(marks.filter(h => !h.video_id).map(h => h.workout_id));
  const videoMarks = new Set(marks.filter(h => h.video_id).map(h => `${h.workout_id}:${h.video_id}`));

  const complete = workouts.every(w => {
    if (dayMarks.has(w.id)) return true;
    const ids = parseTags(w.video_ids);
    return ids.length > 0 && ids.every(vid => videoMarks.has(`${w.id}:${vid}`));
  });
  return { complete, workoutCount: workouts.length };
}

/**
 * Keep the durable record of finished plans in step with the plan's marks.
 *
 * A plan is finished when *every* workout day in it is marked — not when some
 * particular final one is. People skip around, do day 7 before day 5, and come
 * back to fill gaps; whichever mark happens to complete the set is the one that
 * finishes the plan, and its date is the finish date.
 *
 * Un-marking a day afterwards removes the record again, because you haven't
 * finished after all. Only un-marking does that — editing a plan also clears its
 * marks, but that must not erase a plan you genuinely completed, and edits never
 * come through here.
 */
async function syncPlanCompletion(planId: string, completedDate: string): Promise<void> {
  const plan = db.prepare('SELECT id, name, start_date FROM workout_plans WHERE id = ?').get(planId) as any;
  if (!plan) return;

  const { complete, workoutCount } = isPlanComplete(planId);
  const existing = db.prepare(
    'SELECT id FROM plan_completions WHERE plan_id = ? ORDER BY finished_at DESC LIMIT 1'
  ).get(planId) as { id: string } | undefined;

  if (!complete) {
    if (existing) db.prepare('DELETE FROM plan_completions WHERE id = ?').run(existing.id);
    return;
  }
  if (existing) return;

  const daysTaken = plan.start_date
    ? Math.max(1, Math.round((Date.parse(completedDate) - Date.parse(plan.start_date)) / 86400000) + 1)
    : null;

  const { nanoid } = await import('nanoid');
  db.prepare(`
    INSERT INTO plan_completions
      (id, plan_id, plan_name, workout_count, started_on, finished_on, days_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(nanoid(), plan.id, plan.name, workoutCount, plan.start_date ?? null, completedDate, daysTaken);
}

/** The plan a workout belongs to, or '' when the workout is already gone. */
function planIdOf(workoutId: string): string {
  const row = db.prepare('SELECT plan_id FROM workouts WHERE id = ?').get(workoutId) as
    | { plan_id?: string }
    | undefined;
  return row?.plan_id ?? '';
}

/** Local date for this desktop app, where the server clock is the user's clock. */
function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

const FREEZE_REASONS = ['unwell', 'period', 'freeze'] as const;
type FreezeReason = typeof FREEZE_REASONS[number];
function isFreezeReason(v: unknown): v is FreezeReason {
  return typeof v === 'string' && (FREEZE_REASONS as readonly string[]).includes(v);
}

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    // Get pattern and start date
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const patternSetting = settings.find(s => s.key === 'workout_pattern')?.value;
    const globalStartDate = settings.find(s => s.key === 'start_date')?.value;
    
    const FALLBACK_PATTERN = [1, 1, 1, 1, 1, 0];
    let globalPattern: number[] = FALLBACK_PATTERN;
    if (patternSetting) {
      try { globalPattern = JSON.parse(patternSetting); } catch (e) {}
    }

    /**
     * A plan's own rhythm, or the global one when it hasn't set one.
     *
     * Guarded rather than trusted: a pattern with no workout day would spin the
     * schedule loop below forever, so anything unusable falls back.
     */
    const patternFor = (raw: string | null): number[] => {
      let pattern = globalPattern;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) pattern = parsed.map(v => (v ? 1 : 0));
        } catch (e) {}
      }
      return pattern.some(day => day === 1) ? pattern : FALLBACK_PATTERN;
    };

    // Active plans, main slot first.
    const activePlans = db.prepare(
      'SELECT id, name, start_date, is_active, workout_pattern, background_image, category FROM workout_plans WHERE is_active IN (1, 2) ORDER BY is_active ASC'
    ).all() as any[];
    if (!activePlans.length) {
      return reply.send({ schedule: [], schedules: [], pattern: globalPattern });
    }

    const allVideos = db.prepare('SELECT id, filename, relative_path, thumbnail_path, description, equipment, training_type, body_parts, intensity, source, external_id, duration_seconds FROM videos').all() as any[];
    const videoMap = new Map(allVideos.map(v => [v.id, {
      filename: v.filename,
      path: v.relative_path,
      thumbnail: v.thumbnail_path,
      description: v.description || '',
      source: v.source || 'local',
      externalId: v.external_id || null,
      equipment: parseTags(v.equipment),
      // Metadata tags, shown as chips on the calendar's video previews.
      trainingType: parseTags(v.training_type),
      bodyParts: parseTags(v.body_parts),
      intensity: v.intensity || '',
      // Probed at scan time, so present for nearly every local video even
      // when nobody has ever gotten around to tagging or describing it.
      duration: typeof v.duration_seconds === 'number' ? v.duration_seconds : null,
    }]));
    
    // Get history (both workout-level and video-level)
    const history = db.prepare('SELECT workout_id, video_id FROM history').all() as any[];
    const completedWorkouts = new Set(history.filter(h => !h.video_id).map(h => h.workout_id));
    const completedVideos = new Set(history.filter(h => h.video_id).map(h => `${h.workout_id}:${h.video_id}`));

    const workoutsByPlan = db.prepare(`
      SELECT w.id, w.plan_id, w.name, w.sequence_order, w.video_ids
      FROM workouts w
      WHERE w.plan_id IN (${activePlans.map(() => '?').join(', ')})
      ORDER BY w.sequence_order ASC
    `).all(...activePlans.map(p => p.id)) as any[];

    // Frozen days, keyed `${plan_id}|${date}` so buildSchedule can look one up
    // per day without a query per row.
    const freezeRows = db.prepare(`
      SELECT plan_id, date, reason FROM plan_freezes
      WHERE plan_id IN (${activePlans.map(() => '?').join(', ')})
    `).all(...activePlans.map(p => p.id)) as any[];
    const freezeByPlanDate = new Map(freezeRows.map(f => [`${f.plan_id}|${f.date}`, f.reason as string]));

    const buildSchedule = (plan: any) => {
      const startDateStr = plan.start_date || globalStartDate || new Date().toISOString().split('T')[0];
      const startDate = new Date(startDateStr);
      // Each active plan lays out on its own rhythm, so two plans running side
      // by side don't have to share one.
      const pattern = patternFor(plan.workout_pattern);

      const workouts = workoutsByPlan.filter(w => w.plan_id === plan.id).map(w => {
        let videoIds = [];
        try {
          videoIds = JSON.parse(w.video_ids || '[]');
        } catch (e) {}

        const videos = videoIds.map((vid: string) => {
          const videoInfo = videoMap.get(vid);
          return videoInfo ? {
            id: vid,
            filename: videoInfo.filename,
            path: videoInfo.path,
            thumbnail: videoInfo.thumbnail,
            description: videoInfo.description,
            equipment: videoInfo.equipment,
            trainingType: videoInfo.trainingType,
            bodyParts: videoInfo.bodyParts,
            intensity: videoInfo.intensity,
            source: videoInfo.source,
            externalId: videoInfo.externalId,
            duration: videoInfo.duration,
            isCompleted: completedVideos.has(`${w.id}:${vid}`)
          } : null;
        }).filter((v: any) => v !== null);

        // A workout is considered completed if it has a workout-level entry 
        // OR if all its videos are completed
        const allVideosDone = videos.length > 0 && videos.every((v: any) => v.isCompleted);
        const workoutDone = completedWorkouts.has(w.id) || allVideosDone;

        return {
          id: w.id,
          name: w.name,
          sequence_order: w.sequence_order,
          videos,
          isCompleted: workoutDone,
          videosCompletedCount: videos.filter((v: any) => v.isCompleted).length,
          totalVideosCount: videos.length
        };
      });

      // Generate schedule
      const schedule = [];
      let workoutIndex = 0;
      let patternIndex = 0;
      const currentDate = new Date(startDate);

      while (workoutIndex < workouts.length) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const frozenReason = freezeByPlanDate.get(`${plan.id}|${dateStr}`) || null;
        // A frozen workout day doesn't consume its slot in the sequence — the
        // workout that would've landed here waits for the next open workout
        // day instead, so freezing pushes the rest of the plan back rather
        // than burying that day's workout behind the freeze banner for good.
        const isWorkoutDay = pattern[patternIndex] === 1 && !frozenReason;

        schedule.push({
          date: dateStr,
          isWorkoutDay,
          workout: isWorkoutDay ? workouts[workoutIndex] : null,
          frozen: frozenReason,
        });

        if (isWorkoutDay) {
          workoutIndex++;
        }

        currentDate.setDate(currentDate.getDate() + 1);
        patternIndex = (patternIndex + 1) % pattern.length;
      }

      return {
        slot: SLOT_BY_FLAG[plan.is_active as number] || 'main',
        planId: plan.id,
        planName: plan.name,
        startDate: startDateStr,
        // For the plan-switcher tabs when two plans are active, so they can
        // look like the plan rather than a bare text label.
        backgroundImage: plan.background_image || null,
        category: plan.category || null,
        pattern,
        schedule,
      };
    };

    const schedules = activePlans.map(buildSchedule);
    const main = schedules.find(s => s.slot === 'main') || schedules[0];

    return reply.send({
      schedules,
      // Single-plan fields, mirroring the main plan. Callers that only care
      // about the primary schedule (the dashboard) keep reading these.
      pattern: main.pattern,
      schedule: main.schedule,
      startDate: main.startDate,
      planName: main.planName,
    });
  });

  fastify.post('/toggle-done', async (request, reply) => {
    const { workoutId, videoId, loopCount } = request.body as { workoutId: string, videoId?: string, loopCount?: number };
    // Times through the video, when the player was looping it. Only a real set
    // (2+) is recorded; a single play needs no marker in the log.
    const rawLoops = Number(loopCount);
    const loops = Number.isFinite(rawLoops) && rawLoops > 1 ? Math.min(Math.floor(rawLoops), 999) : null;
    
    let existing;
    if (videoId) {
      existing = db.prepare('SELECT id FROM history WHERE workout_id = ? AND video_id = ?').get(workoutId, videoId) as { id: string } | undefined;
    } else {
      existing = db.prepare('SELECT id FROM history WHERE workout_id = ? AND video_id IS NULL').get(workoutId) as { id: string } | undefined;
    }
    
    if (existing) {
      // Un-mark: remove from both the (ephemeral) history and the durable log.
      if (videoId) {
        db.prepare('DELETE FROM history WHERE workout_id = ? AND video_id = ?').run(workoutId, videoId);
        db.prepare('DELETE FROM workout_log WHERE workout_id = ? AND video_id = ?').run(workoutId, videoId);
      } else {
        db.prepare('DELETE FROM history WHERE workout_id = ? AND video_id IS NULL').run(workoutId);
        db.prepare('DELETE FROM workout_log WHERE workout_id = ? AND video_id IS NULL').run(workoutId);
      }
      await syncPlanCompletion(planIdOf(workoutId), todayLocal());
      return reply.send({ success: true, completed: false });
    } else {
      const { nanoid } = await import('nanoid');
      if (videoId) {
        db.prepare('INSERT INTO history (id, workout_id, video_id) VALUES (?, ?, ?)').run(nanoid(), workoutId, videoId);
      } else {
        db.prepare('INSERT INTO history (id, workout_id) VALUES (?, ?)').run(nanoid(), workoutId);
      }

      // Also snapshot a durable workout_log entry. Names are copied in now so the
      // record survives future plan edits/deletes (which wipe `history`).
      const workout = db.prepare('SELECT name, plan_id FROM workouts WHERE id = ?').get(workoutId) as { name?: string, plan_id?: string } | undefined;
      const planName = workout?.plan_id
        ? ((db.prepare('SELECT name FROM workout_plans WHERE id = ?').get(workout.plan_id) as { name?: string } | undefined)?.name ?? null)
        : null;
      let videoFilename: string | null = null;
      let thumbnailPath: string | null = null;
      if (videoId) {
        const v = db.prepare('SELECT filename, thumbnail_path FROM videos WHERE id = ?').get(videoId) as { filename?: string, thumbnail_path?: string } | undefined;
        videoFilename = v?.filename ?? null;
        thumbnailPath = v?.thumbnail_path ?? null;
      }

      // Local date the workout was marked done. This is a local desktop app, so the
      // server clock is the user's clock.
      const now = new Date();
      const completedDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .split('T')[0];

      // Keep at most one log row per (workout_id, video_id), mirroring history.
      if (videoId) {
        db.prepare('DELETE FROM workout_log WHERE workout_id = ? AND video_id = ?').run(workoutId, videoId);
      } else {
        db.prepare('DELETE FROM workout_log WHERE workout_id = ? AND video_id IS NULL').run(workoutId);
      }
      db.prepare(`
        INSERT INTO workout_log
          (id, workout_id, video_id, plan_name, workout_name, video_filename, thumbnail_path, completed_date, loop_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(nanoid(), workoutId, videoId ?? null, planName, workout?.name ?? null, videoFilename, thumbnailPath, completedDate, loops);

      // Did that leave the plan with nothing outstanding?
      if (workout?.plan_id) await syncPlanCompletion(workout.plan_id, completedDate);

      return reply.send({ success: true, completed: true });
    }
  });

  // Today's freeze state per active plan, for the Plans page card — cheap and
  // direct rather than computing each plan's full schedule just to read one day.
  fastify.get('/freeze-status', async (_request, reply) => {
    const rows = db.prepare(`
      SELECT plan_id, reason FROM plan_freezes
      WHERE date = ? AND plan_id IN (SELECT id FROM workout_plans WHERE is_active IN (1, 2))
    `).all(todayLocal()) as { plan_id: string; reason: string }[];
    const byPlan: Record<string, string> = {};
    for (const r of rows) byPlan[r.plan_id] = r.reason;
    return reply.send(byPlan);
  });

  const MAX_FREEZE_DAYS = 60;

  // Freeze a run of consecutive days starting from `startDate` (today, unless
  // the caller is looking at a specific future day and means to freeze
  // forward from there), for an active plan: each day's calendar card shows
  // the reason instead of the scheduled day, and any workout that would've
  // landed on a frozen day is deferred to the next open one, pushing the rest
  // of the plan's dates back by the same span (see buildSchedule). Never
  // starts before today — there's no path to freezing a day already in the
  // past from outside the UI — but can reach forward, so a
  // Friday flare-up can be blocked out through the weekend in one go, or a
  // trip planned for next month can be frozen ahead of time. Each covered day
  // gets its own row, so any of them (including ones still in the future) can
  // be unfrozen independently before it arrives.
  fastify.post('/freeze', async (request, reply) => {
    const { planId, reason, days, startDate } = request.body as {
      planId?: string; reason?: string; days?: number; startDate?: string;
    };
    if (typeof planId !== 'string' || !planId) {
      return reply.code(400).send({ error: 'planId is required' });
    }
    if (!isFreezeReason(reason)) {
      return reply.code(400).send({ error: `reason must be one of: ${FREEZE_REASONS.join(', ')}` });
    }
    const today = todayLocal();
    // A given date must be today or later — a bare format check plus a string
    // comparison is enough since both sides are YYYY-MM-DD.
    const effectiveStart =
      typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate >= today
        ? startDate
        : today;
    const dayCount = Number.isInteger(days) && (days as number) >= 1 ? Math.min(days as number, MAX_FREEZE_DAYS) : 1;
    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ? AND is_active IN (1, 2)').get(planId);
    if (!plan) {
      return reply.code(404).send({ error: 'No active plan with that id' });
    }

    const { nanoid } = await import('nanoid');
    const upsert = db.prepare(`
      INSERT INTO plan_freezes (id, plan_id, date, reason) VALUES (?, ?, ?, ?)
      ON CONFLICT(plan_id, date) DO UPDATE SET reason = excluded.reason
    `);
    const dates: string[] = [];
    // UTC-anchored, not `new Date(effectiveStart + 'T00:00:00')`: that string
    // has no offset, so JS parses it as LOCAL midnight, and toISOString() below
    // would then convert it back to UTC — pushing the date back a day in any
    // positive-offset timezone (BST, CET, ...). Anchoring in UTC from the
    // start means the calendar date never has to survive a local-time round trip.
    const [ty, tm, td] = effectiveStart.split('-').map(Number);
    const cursor = new Date(Date.UTC(ty, tm - 1, td));
    const applyFreeze = db.transaction(() => {
      for (let i = 0; i < dayCount; i++) {
        const dateStr = cursor.toISOString().split('T')[0];
        dates.push(dateStr);
        upsert.run(nanoid(), planId, dateStr, reason);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });
    applyFreeze();

    return reply.send({ success: true, dates, reason });
  });

  // Unfreeze a specific day. Not restricted to today: undoing a past freeze is
  // harmless (it just reveals the workout/rest that was already sitting there).
  // This is the individual day card's own toggle, so it only ever touches the
  // one date it's on.
  fastify.delete('/freeze/:planId/:date', async (request, reply) => {
    const { planId, date } = request.params as { planId: string; date: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.code(400).send({ error: 'date must be a YYYY-MM-DD string' });
    }
    const { changes } = db.prepare('DELETE FROM plan_freezes WHERE plan_id = ? AND date = ?').run(planId, date);
    return reply.send({ success: true, deleted: changes });
  });

  // Unfreeze everything from today onward: pairs with the header's "freeze the
  // next N days" tool, so undoing that is one click rather than N. Past frozen
  // days are left alone — they're history at this point, not something to undo.
  fastify.delete('/freeze/:planId', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const { changes } = db.prepare('DELETE FROM plan_freezes WHERE plan_id = ? AND date >= ?').run(
      planId, todayLocal()
    );
    return reply.send({ success: true, deleted: changes });
  });
}
