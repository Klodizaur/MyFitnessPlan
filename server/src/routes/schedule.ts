import { FastifyInstance } from 'fastify';
import db from '../db.js';

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    // Get pattern and start date
    const settings = db.prepare('SELECT * FROM settings').all() as any[];
    const patternSetting = settings.find(s => s.key === 'workout_pattern')?.value;
    const globalStartDate = settings.find(s => s.key === 'start_date')?.value;
    
    let pattern: number[] = [1, 1, 1, 1, 1, 0]; // Default
    if (patternSetting) {
      try { pattern = JSON.parse(patternSetting); } catch (e) {}
    }

    // Get active plan
    const plan = db.prepare('SELECT id, name, start_date FROM workout_plans WHERE is_active = 1').get() as any;
    if (!plan) {
      return reply.send({ schedule: [] });
    }

    const startDateStr = plan.start_date || globalStartDate || new Date().toISOString().split('T')[0];
    const startDate = new Date(startDateStr);

    const rawWorkouts = db.prepare(`
      SELECT w.id, w.name, w.sequence_order, w.video_ids
      FROM workouts w
      WHERE w.plan_id = ?
      ORDER BY w.sequence_order ASC
    `).all(plan.id) as any[];

    const allVideos = db.prepare('SELECT id, filename, relative_path, thumbnail_path, description, equipment FROM videos').all() as any[];
    const videoMap = new Map(allVideos.map(v => [v.id, {
      filename: v.filename,
      path: v.relative_path,
      thumbnail: v.thumbnail_path,
      description: v.description || '',
      equipment: (() => {
        try {
          const parsed = JSON.parse(v.equipment || '[]');
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
    }]));
    
    // Get history (both workout-level and video-level)
    const history = db.prepare('SELECT workout_id, video_id FROM history').all() as any[];
    const completedWorkouts = new Set(history.filter(h => !h.video_id).map(h => h.workout_id));
    const completedVideos = new Set(history.filter(h => h.video_id).map(h => `${h.workout_id}:${h.video_id}`));

    const workouts = rawWorkouts.map(w => {
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
      const isWorkoutDay = pattern[patternIndex] === 1;
      
      schedule.push({
        date: currentDate.toISOString().split('T')[0],
        isWorkoutDay,
        workout: isWorkoutDay ? workouts[workoutIndex] : null
      });

      if (isWorkoutDay) {
        workoutIndex++;
      }

      currentDate.setDate(currentDate.getDate() + 1);
      patternIndex = (patternIndex + 1) % pattern.length;
    }

    return reply.send({ schedule, pattern, startDate: startDateStr, planName: plan.name });
  });

  fastify.post('/toggle-done', async (request, reply) => {
    const { workoutId, videoId } = request.body as { workoutId: string, videoId?: string };
    
    let existing;
    if (videoId) {
      existing = db.prepare('SELECT id FROM history WHERE workout_id = ? AND video_id = ?').get(workoutId, videoId) as { id: string } | undefined;
    } else {
      existing = db.prepare('SELECT id FROM history WHERE workout_id = ? AND video_id IS NULL').get(workoutId) as { id: string } | undefined;
    }
    
    if (existing) {
      if (videoId) {
        db.prepare('DELETE FROM history WHERE workout_id = ? AND video_id = ?').run(workoutId, videoId);
      } else {
        db.prepare('DELETE FROM history WHERE workout_id = ? AND video_id IS NULL').run(workoutId);
      }
      return reply.send({ success: true, completed: false });
    } else {
      const { nanoid } = await import('nanoid');
      if (videoId) {
        db.prepare('INSERT INTO history (id, workout_id, video_id) VALUES (?, ?, ?)').run(nanoid(), workoutId, videoId);
      } else {
        db.prepare('INSERT INTO history (id, workout_id) VALUES (?, ?)').run(nanoid(), workoutId);
      }
      return reply.send({ success: true, completed: true });
    }
  });
}
