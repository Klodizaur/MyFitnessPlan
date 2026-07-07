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
    db.prepare('UPDATE workout_plans SET is_active = 0').run();
    db.prepare('INSERT INTO workout_plans (id, name, is_active, start_date) VALUES (?, ?, 1, ?)').run(planId, planName, startDate);

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
    const body = request.body as { name?: string; startDate?: string; days?: Array<{ name: string; videoIds: string[] }> };
    const days = Array.isArray(body.days) ? body.days.filter(day => Array.isArray(day.videoIds) && day.videoIds.length > 0) : [];
    if (!days.length) {
      return reply.code(400).send({ error: 'No workouts provided' });
    }

    const planId = nanoid();
    const planName = body.name?.trim() || `Custom Plan ${new Date().toISOString().split('T')[0]}`;
    const startDate = body.startDate || new Date().toISOString().split('T')[0];

    db.transaction(() => {
      db.prepare('INSERT INTO workout_plans (id, name, is_active, start_date) VALUES (?, ?, 0, ?)').run(planId, planName, startDate);
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
    const body = request.body as { name?: string; startDate?: string; days?: Array<{ name: string; videoIds: string[] }> };
    const days = Array.isArray(body.days) ? body.days.filter(day => Array.isArray(day.videoIds) && day.videoIds.length > 0) : [];
    if (!days.length) {
      return reply.code(400).send({ error: 'No workouts provided' });
    }

    const planName = body.name?.trim() || `Custom Plan ${new Date().toISOString().split('T')[0]}`;
    const startDate = body.startDate || new Date().toISOString().split('T')[0];

    db.transaction(() => {
      // Update plan name and start date
      db.prepare('UPDATE workout_plans SET name = ?, start_date = ? WHERE id = ?').run(planName, startDate, id);
      
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
    const plan = db.prepare('SELECT * FROM workout_plans WHERE is_active = 1').get() as any;
    if (!plan) return reply.send({ activePlan: null });
    const workouts = db.prepare(
      'SELECT id, name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
    ).all(plan.id);
    return reply.send({ activePlan: plan, workouts });
  });

  fastify.get('/', async (request, reply) => {
    const plans = db.prepare('SELECT * FROM workout_plans ORDER BY uploaded_at DESC').all();
    return reply.send(plans);
  });

  fastify.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id) as any;
    if (!plan) {
      return reply.code(404).send({ error: 'Plan not found' });
    }
    const workouts = db.prepare(
      'SELECT id, name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
    ).all(id);
    return reply.send({ plan, workouts });
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

  fastify.post('/activate/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { startDate } = request.body as { startDate?: string };
    
    const finalStartDate = startDate || new Date().toISOString().split('T')[0];

    db.transaction(() => {
      db.prepare('UPDATE workout_plans SET is_active = 0').run();
      db.prepare('UPDATE workout_plans SET is_active = 1, start_date = ? WHERE id = ?').run(finalStartDate, id);
    })();

    return reply.send({ success: true });
  });

  fastify.post('/rematch-active', async (request, reply) => {
    const plan = db.prepare('SELECT id FROM workout_plans WHERE is_active = 1').get() as { id: string } | undefined;
    if (!plan) return reply.code(404).send({ error: 'No active plan' });
    
    rematchPlanWorkouts(plan.id);
    return reply.send({ success: true });
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

  fastify.post('/rematch-all', async (request, reply) => {
    const plans = db.prepare('SELECT id FROM workout_plans').all() as { id: string }[];
    for (const plan of plans) {
      rematchPlanWorkouts(plan.id);
    }
    return reply.send({ success: true, count: plans.length });
  });
}
