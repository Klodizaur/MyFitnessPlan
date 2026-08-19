import { FastifyInstance } from 'fastify';
import db from '../db.js';
import { nanoid } from 'nanoid';
import { parse } from 'csv-parse/sync';
import path from 'path';
import fs from 'fs';

const planBackgroundsDir = path.join(process.cwd(), 'data', 'plan-backgrounds');
if (!fs.existsSync(planBackgroundsDir)) {
  fs.mkdirSync(planBackgroundsDir, { recursive: true });
}

const DAY_NAMES = new Set([
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
]);

import { matchVideo, rematchPlanWorkouts, rematchAllPlans } from '../matcher.js';

function isSkip(cell: string): boolean {
  const t = cell.trim();
  if (!t) return true;
  if (/^[-–—\s]+$/.test(t)) return true;
  return false;
}

function isStructural(cell: string): boolean {
  const t = cell.trim().toLowerCase();
  if (!t || isSkip(cell)) return true;
  if (/^(week|day|workout|date|program)\s*\d*$/i.test(t)) return true;
  if (DAY_NAMES.has(t)) return true;
  return false;
}

function isWeekHeader(row: string[]): boolean {
  return /^week\s*\d+/i.test(row[0]?.trim() || '');
}

function isDayHeaderRow(row: string[]): boolean {
  return row.some(c => DAY_NAMES.has(c.trim().toLowerCase()));
}

interface Session { name: string; videoNames: string[]; }

// A plan's category is either a preset key the client translates, or a custom
// label typed by the user. Empty/blank clears it. Capped so a stray paste can't
// blow out the Plans page headings.
function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 60) : null;
}

// Two plans can be active at once, each in its own slot: the main plan and an
// optional extra plan running alongside it. The slot is stored in `is_active`
// (0 = inactive), so every existing "WHERE is_active = 1" still means "the main
// plan". At most one plan occupies a slot at a time.
const ACTIVE_NONE = 0;
const ACTIVE_MAIN = 1;
const ACTIVE_EXTRA = 2;

type Slot = 'main' | 'extra';
const FLAG_BY_SLOT: Record<Slot, number> = { main: ACTIVE_MAIN, extra: ACTIVE_EXTRA };

function parseSlot(raw: unknown): Slot {
  return raw === 'extra' ? 'extra' : 'main';
}

function parseJsonArray(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A plan's own note. Blank clears it; capped so a pasted essay can't blow out
// the plan card it's rendered on.
function normalizeDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 1000) : null;
}

/**
 * A plan's own workout/rest rhythm: an array of 0/1, one entry per day of the
 * repeating cycle. Returned as JSON for storage, or null to fall back to the
 * global pattern in Settings.
 *
 * A pattern of all rest days would generate a schedule that never places a
 * workout — an infinite loop in the schedule builder — so it is rejected here
 * rather than stored.
 */
const MAX_PATTERN_DAYS = 14;

function normalizePattern(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const days = raw.slice(0, MAX_PATTERN_DAYS).map(value => (value ? 1 : 0));
  if (!days.some(day => day === 1)) return null;
  return JSON.stringify(days);
}

function detectFormat(records: string[][]): 'column' | 'row' {
  for (const row of records) {
    if (isWeekHeader(row) && isDayHeaderRow(row)) return 'column';
    if (!isWeekHeader(row) && isDayHeaderRow(row)) return 'column';
  }
  return 'row';
}

function parseColumnFormat(records: string[][]): Session[] {
  const sessions: Session[] = [];
  let i = 0;
  while (i < records.length) {
    const row = records[i];
    if (!isWeekHeader(row)) { i++; continue; }
    let dataCols: number[] = [];
    let dataStartRow: number;
    if (isDayHeaderRow(row)) {
      for (let c = 1; c < row.length; c++) {
        if (DAY_NAMES.has((row[c] || '').trim().toLowerCase())) dataCols.push(c);
      }
      dataStartRow = i + 1;
    } else {
      const nextRow = records[i + 1];
      if (!nextRow || !isDayHeaderRow(nextRow)) { i++; continue; }
      for (let c = 0; c < nextRow.length; c++) {
        if (DAY_NAMES.has((nextRow[c] || '').trim().toLowerCase())) dataCols.push(c);
      }
      dataStartRow = i + 2;
    }
    i = dataStartRow;
    const section: string[][] = [];
    while (i < records.length && !isWeekHeader(records[i])) {
      section.push(records[i]);
      i++;
    }
    for (const col of dataCols) {
      const videoNames: string[] = [];
      for (const sRow of section) {
        const cell = (sRow[col] || '').trim();
        if (!isSkip(cell) && !isStructural(cell)) videoNames.push(cell);
      }
      if (videoNames.length > 0) sessions.push({ name: videoNames.join('\n'), videoNames });
    }
  }
  return sessions;
}

function parseRowFormat(records: string[][]): Session[] {
  const sessions: Session[] = [];
  for (let r = 0; r < records.length; r++) {
    const row = records[r];
    if (!row || row.length === 0) continue;
    if (row.length === 1) {
      const cell = (row[0] || '').trim();
      if (cell && !isSkip(cell) && !isStructural(cell)) sessions.push({ name: cell, videoNames: [cell] });
      continue;
    }
    for (let c = 1; c < row.length; c++) {
      const cell = (row[c] || '').trim();
      if (!cell || isSkip(cell) || isStructural(cell)) continue;
      sessions.push({ name: cell, videoNames: [cell] });
    }
  }
  return sessions;
}

export default async function (fastify: FastifyInstance) {
  fastify.post('/upload', async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const fileContent = await data.toBuffer();
    const isTsv = data.filename.endsWith('.tsv');

    let records: string[][];
    try {
      records = parse(fileContent, {
        delimiter: isTsv ? '\t' : ',',
        skip_empty_lines: false, // preserve rows to keep column alignment
        relax_column_count: true,
        relax_quotes: true,
      });
    } catch (err) {
      return reply.code(400).send({ error: 'Failed to parse file' });
    }

    const format = detectFormat(records);
    const sessions = format === 'column'
      ? parseColumnFormat(records)
      : parseRowFormat(records);

    if (!sessions.length) {
      return reply.code(400).send({ error: 'No valid workouts found in file' });
    }

    const planId = nanoid();
    const planName = data.filename.replace(/\.[^/.]+$/, '');

    const startDate = new Date().toISOString().split('T')[0];
    // An upload takes over the main slot only; a plan in the extra slot stays active.
    db.prepare('UPDATE workout_plans SET is_active = 0 WHERE is_active = ?').run(ACTIVE_MAIN);
    db.prepare('INSERT INTO workout_plans (id, name, is_active, start_date) VALUES (?, ?, ?, ?)').run(planId, planName, ACTIVE_MAIN, startDate);

    const videos = db.prepare('SELECT id, filename FROM videos').all() as { id: string; filename: string }[];

    const insertStmt = db.prepare(
      'INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES (?, ?, ?, ?, ?)'
    );

    db.transaction((ss: Session[]) => {
      ss.forEach((session, index) => {
        const videoIds: string[] = [];
        for (const vname of session.videoNames) {
          const vid = matchVideo(vname, videos);
          if (vid && !videoIds.includes(vid)) videoIds.push(vid);
        }
        insertStmt.run(nanoid(), planId, session.name, index, JSON.stringify(videoIds));
      });
    })(sessions);

    return reply.send({
      success: true,
      planId,
      format,
      workoutCount: sessions.length
    });
  });

  fastify.post('/create', async (request, reply) => {
    const body = request.body as { name?: string; startDate?: string; category?: string; description?: string; workoutPattern?: number[]; days?: Array<{ name: string; videoIds: string[] }> };
    const days = Array.isArray(body.days) ? body.days.filter(day => Array.isArray(day.videoIds) && day.videoIds.length > 0) : [];
    if (!days.length) {
      return reply.code(400).send({ error: 'No workouts provided' });
    }

    const planId = nanoid();
    const planName = body.name?.trim() || `Custom Plan ${new Date().toISOString().split('T')[0]}`;
    const startDate = body.startDate || new Date().toISOString().split('T')[0];
    const category = normalizeCategory(body.category);
    const description = normalizeDescription(body.description);
    const pattern = normalizePattern(body.workoutPattern);

    db.transaction(() => {
      db.prepare(
        'INSERT INTO workout_plans (id, name, is_active, start_date, category, description, workout_pattern) VALUES (?, ?, 0, ?, ?, ?, ?)'
      ).run(planId, planName, startDate, category, description, pattern);
      const insertStmt = db.prepare(
        'INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES (?, ?, ?, ?, ?)'
      );
      days.forEach((day, index) => {
        insertStmt.run(nanoid(), planId, day.name || `Day ${index + 1}`, index, JSON.stringify(day.videoIds));
      });
    })();

    return reply.send({ success: true, planId, workoutCount: days.length });
  });

  fastify.put('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; startDate?: string; category?: string; description?: string; workoutPattern?: number[]; days?: Array<{ name: string; videoIds: string[] }> };
    const days = Array.isArray(body.days) ? body.days.filter(day => Array.isArray(day.videoIds) && day.videoIds.length > 0) : [];
    if (!days.length) {
      return reply.code(400).send({ error: 'No workouts provided' });
    }

    const planName = body.name?.trim() || `Custom Plan ${new Date().toISOString().split('T')[0]}`;
    const startDate = body.startDate || new Date().toISOString().split('T')[0];
    const category = normalizeCategory(body.category);
    const description = normalizeDescription(body.description);
    const pattern = normalizePattern(body.workoutPattern);

    db.transaction(() => {
      // Update plan name, start date, category, description and rhythm
      db.prepare(
        'UPDATE workout_plans SET name = ?, start_date = ?, category = ?, description = ?, workout_pattern = ? WHERE id = ?'
      ).run(planName, startDate, category, description, pattern, id);
      
      // Delete history first (it references workouts via a foreign key).
      // Without this, deleting workouts that have completion marks fails
      // with "FOREIGN KEY constraint failed".
      db.prepare('DELETE FROM history WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)').run(id);

      // Delete existing workouts for this plan
      db.prepare('DELETE FROM workouts WHERE plan_id = ?').run(id);
      
      // Insert new workouts
      const insertStmt = db.prepare(
        'INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES (?, ?, ?, ?, ?)'
      );
      days.forEach((day, index) => {
        insertStmt.run(nanoid(), id, day.name || `Day ${index + 1}`, index, JSON.stringify(day.videoIds));
      });
    })();

    return reply.send({ success: true, planId: id, workoutCount: days.length });
  });

  fastify.get('/active', async (request, reply) => {
    // Main slot first, then the extra plan when one is active.
    const plans = db.prepare(
      'SELECT * FROM workout_plans WHERE is_active IN (?, ?) ORDER BY is_active ASC'
    ).all(ACTIVE_MAIN, ACTIVE_EXTRA) as any[];
    const withWorkouts = plans.map(plan => ({
      slot: plan.is_active === ACTIVE_EXTRA ? 'extra' : 'main',
      plan,
      workouts: db.prepare(
        'SELECT id, name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
      ).all(plan.id),
    }));
    const main = withWorkouts.find(entry => entry.slot === 'main') || null;
    return reply.send({
      activePlans: withWorkouts,
      // Single-plan fields, mirroring the main slot.
      activePlan: main?.plan ?? null,
      workouts: main?.workouts ?? [],
    });
  });

  fastify.get('/', async (request, reply) => {
    // Active plans first (main, then extra), then newest uploads. Each plan is
    // enriched with its workout count and the union of equipment tags across its videos.
    const plans = db.prepare(`
      SELECT * FROM workout_plans
      ORDER BY (CASE is_active WHEN ${ACTIVE_MAIN} THEN 0 WHEN ${ACTIVE_EXTRA} THEN 1 ELSE 2 END), uploaded_at DESC
    `).all() as any[];
    const workouts = db.prepare('SELECT plan_id, video_ids FROM workouts').all() as { plan_id: string; video_ids: string | null }[];
    const videos = db.prepare('SELECT id, equipment, source FROM videos').all() as { id: string; equipment: string | null; source: string | null }[];

    const equipmentByVideo = new Map<string, string[]>();
    for (const v of videos) {
      try {
        const parsed = JSON.parse(v.equipment || '[]');
        equipmentByVideo.set(v.id, Array.isArray(parsed) ? parsed : []);
      } catch {
        equipmentByVideo.set(v.id, []);
      }
    }

    // Videos with no file on disk. A plan containing any of these can't be done
    // offline, which the Plans page warns about on the card.
    const externalVideoIds = new Set(videos.filter(v => (v.source || 'local') !== 'local').map(v => v.id));

    const enriched = plans.map(plan => {
      const planWorkouts = workouts.filter(w => w.plan_id === plan.id);
      const equipmentSet = new Set<string>();
      let hasExternal = false;
      for (const w of planWorkouts) {
        let videoIds: string[] = [];
        try {
          const parsed = JSON.parse(w.video_ids || '[]');
          if (Array.isArray(parsed)) videoIds = parsed;
        } catch {}
        for (const vid of videoIds) {
          for (const eq of equipmentByVideo.get(vid) || []) equipmentSet.add(eq);
          if (externalVideoIds.has(vid)) hasExternal = true;
        }
      }
      return {
        ...plan,
        workout_count: planWorkouts.length,
        equipment: Array.from(equipmentSet),
        has_external: hasExternal,
      };
    });

    return reply.send(enriched);
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id) as any;
    if (!plan) {
      return reply.code(404).send({ error: 'Plan not found' });
    }
    const workouts = db.prepare(
      'SELECT id, name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
    ).all(id) as { id: string; name: string; sequence_order: number; video_ids: string | null }[];

    // Every video the plan uses, resolved once so the plan details view doesn't
    // have to fetch and filter the whole library. Returned two ways: attached to
    // the day that uses it (the details view shows the plan day by day), and as
    // a flat de-duplicated list (the background picker just wants thumbnails).
    const orderedIds: string[] = [];
    const seenIds = new Set<string>();
    const idsByWorkout = new Map<string, string[]>();
    workouts.forEach(workout => {
      const ids = parseJsonArray(workout.video_ids);
      idsByWorkout.set(workout.id, ids);
      for (const vid of ids) {
        if (seenIds.has(vid)) continue;
        seenIds.add(vid);
        orderedIds.push(vid);
      }
    });

    const videoRows = orderedIds.length
      ? db.prepare(
          `SELECT id, filename, relative_path, thumbnail_path, description, equipment, training_type,
                  body_parts, intensity, duration_seconds, source, external_id, external_url
           FROM videos WHERE id IN (${orderedIds.map(() => '?').join(', ')})`
        ).all(...orderedIds) as any[]
      : [];

    const resolved = new Map(
      videoRows.map(row => [
        row.id,
        {
          ...row,
          equipment: parseJsonArray(row.equipment),
          training_type: parseJsonArray(row.training_type),
          body_parts: parseJsonArray(row.body_parts),
        },
      ])
    );

    const videos = orderedIds.filter(vid => resolved.has(vid)).map(vid => resolved.get(vid));

    // Days keep their own order and their repeats: a video used on three days
    // appears on all three, which is what a day-by-day view needs.
    const days = workouts.map(workout => ({
      id: workout.id,
      name: workout.name,
      sequence_order: workout.sequence_order,
      videos: (idsByWorkout.get(workout.id) || [])
        .filter(vid => resolved.has(vid))
        .map(vid => resolved.get(vid)),
    }));

    return reply.send({ plan, workouts, days, videos });
  });

  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    
    db.transaction(() => {
      // Delete history first (it references workouts)
      db.prepare('DELETE FROM history WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)').run(id);
      // Delete workouts
      db.prepare('DELETE FROM workouts WHERE plan_id = ?').run(id);
      // Delete plan
      db.prepare('DELETE FROM workout_plans WHERE id = ?').run(id);
    })();

    return reply.send({ success: true });
  });

  // Activate a plan into one of the two slots. Activating into a slot only
  // evicts whatever was in that slot, so the other active plan is left alone.
  // A plan already active in the other slot moves rather than being duplicated,
  // which the single UPDATE below handles on its own.
  fastify.post('/activate/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { startDate, slot } = request.body as { startDate?: string; slot?: string };

    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ?').get(id);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    const finalStartDate = startDate || new Date().toISOString().split('T')[0];
    const targetSlot = parseSlot(slot);
    const flag = FLAG_BY_SLOT[targetSlot];

    db.transaction(() => {
      db.prepare('UPDATE workout_plans SET is_active = ? WHERE is_active = ?').run(ACTIVE_NONE, flag);
      db.prepare('UPDATE workout_plans SET is_active = ?, start_date = ? WHERE id = ?').run(flag, finalStartDate, id);
    })();

    return reply.send({ success: true, slot: targetSlot });
  });

  // Copy a plan, its days and its look. The copy is never active: duplicating is
  // how you branch a plan you're already running without disturbing the original.
  fastify.post('/:id/duplicate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { name } = request.body as { name?: string } | null || {};

    const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id) as any;
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    const workouts = db.prepare(
      'SELECT name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
    ).all(id) as { name: string; sequence_order: number; video_ids: string | null }[];

    const copyId = nanoid();
    // The client supplies the copy's name so it follows the UI language.
    const copyName = (typeof name === 'string' && name.trim() ? name.trim() : `${plan.name} (copy)`).slice(0, 200);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO workout_plans
          (id, name, is_active, start_date, category, description, background_image, background_blur, workout_pattern)
        VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        copyId,
        copyName,
        plan.start_date,
        plan.category ?? null,
        plan.description ?? null,
        plan.background_image ?? null,
        plan.background_blur ?? 0,
        plan.workout_pattern ?? null
      );

      const insertStmt = db.prepare(
        'INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES (?, ?, ?, ?, ?)'
      );
      for (const workout of workouts) {
        insertStmt.run(nanoid(), copyId, workout.name, workout.sequence_order, workout.video_ids);
      }
    })();

    return reply.send({ success: true, planId: copyId, workoutCount: workouts.length });
  });

  // Take a plan out of whichever slot it occupies, without deleting it.
  fastify.post('/deactivate/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ?').get(id);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    db.prepare('UPDATE workout_plans SET is_active = ? WHERE id = ?').run(ACTIVE_NONE, id);
    return reply.send({ success: true });
  });

  fastify.post('/rematch-active', async (request, reply) => {
    const activePlans = db.prepare(
      'SELECT id FROM workout_plans WHERE is_active IN (?, ?)'
    ).all(ACTIVE_MAIN, ACTIVE_EXTRA) as { id: string }[];
    if (!activePlans.length) return reply.code(404).send({ error: 'No active plan' });

    for (const plan of activePlans) rematchPlanWorkouts(plan.id);
    return reply.send({ success: true, count: activePlans.length });
  });

  // Upload a custom background image for a plan
  fastify.post('/:id/background', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ?').get(id);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    const data = await request.file();
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });

    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(data.filename).toLowerCase();
    if (!allowedExt.includes(ext)) {
      return reply.code(400).send({ error: 'Unsupported image format' });
    }

    const buffer = await data.toBuffer();
    const savedFilename = `${nanoid()}${ext}`;
    fs.writeFileSync(path.join(planBackgroundsDir, savedFilename), buffer);

    const backgroundImage = `/plan-backgrounds/${savedFilename}`;
    db.prepare('UPDATE workout_plans SET background_image = ? WHERE id = ?').run(backgroundImage, id);

    return reply.send({ success: true, backgroundImage });
  });

  // Set a plan's background image to an existing video thumbnail
  fastify.put('/:id/background', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { thumbnailPath } = request.body as { thumbnailPath?: string };
    if (!thumbnailPath) return reply.code(400).send({ error: 'thumbnailPath is required' });

    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ?').get(id);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    const backgroundImage = `/thumbnails/${thumbnailPath}`;
    db.prepare('UPDATE workout_plans SET background_image = ? WHERE id = ?').run(backgroundImage, id);

    return reply.send({ success: true, backgroundImage });
  });

  // Clear a plan's background image
  fastify.delete('/:id/background', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ?').get(id);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    db.prepare('UPDATE workout_plans SET background_image = NULL WHERE id = ?').run(id);
    return reply.send({ success: true });
  });

  // Toggle a slight blur on the plan's background image
  fastify.put('/:id/background-blur', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { blur } = request.body as { blur?: boolean };
    const plan = db.prepare('SELECT id FROM workout_plans WHERE id = ?').get(id);
    if (!plan) return reply.code(404).send({ error: 'Plan not found' });

    const value = blur ? 1 : 0;
    db.prepare('UPDATE workout_plans SET background_blur = ? WHERE id = ?').run(value, id);
    return reply.send({ success: true, backgroundBlur: value });
  });

  fastify.post('/rematch-all', async (request, reply) => {
    const plans = db.prepare('SELECT id FROM workout_plans').all() as { id: string }[];
    for (const plan of plans) {
      rematchPlanWorkouts(plan.id);
    }
    return reply.send({ success: true, count: plans.length });
  });
}
