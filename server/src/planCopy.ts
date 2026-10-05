import { nanoid } from 'nanoid';
import db, { ensurePlanVideosInLibrary } from './db.js';

/**
 * Copy a plan, its days and its look into a profile (its own, or someone
 * else's when a new profile takes plans across). The copy is never active and
 * starts with no progress: ticks, log and finishes belong to whoever did the
 * workouts, so they never travel with a plan.
 */
export function copyPlanTo(planId: string, profileId: string, name?: string): { planId: string; workoutCount: number } | null {
  const plan = db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(planId) as any;
  if (!plan) return null;

  const workouts = db.prepare(
    'SELECT name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
  ).all(planId) as { name: string; sequence_order: number; video_ids: string | null }[];

  const copyId = nanoid();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO workout_plans
        (id, profile_id, name, is_active, start_date, category, description, background_image, background_blur, workout_pattern)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      copyId,
      profileId,
      (name ?? plan.name).slice(0, 200),
      plan.start_date,
      plan.category ?? null,
      plan.description ?? null,
      plan.background_image ?? null,
      plan.background_blur ?? 0,
      plan.workout_pattern ?? null
    );
    const insert = db.prepare('INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES (?, ?, ?, ?, ?)');
    for (const w of workouts) insert.run(nanoid(), copyId, w.name, w.sequence_order, w.video_ids);
  })();

  // The copy's videos join its new owner's library, so the plan isn't empty
  // for someone whose own folder doesn't have them.
  ensurePlanVideosInLibrary(copyId);

  return { planId: copyId, workoutCount: workouts.length };
}
