import db from './db.js';

const STOPWORDS = new Set([
  'min', 'max', 'sec', 'the', 'and', 'for', 'with', 'bez',
  'part', 'vol', 'day', 'week', 'beactivetv', 'mp4', 'mkv', 'avi', 'mov', 'webm',
  'trening', 'exercise', 'minut', 'minuty', 'i'
]);

const SECTION_WORDS = new Set([
  'rozgrzewka', 'wyciszenie', 'stretching', 'warmup', 'cooldown', 'mobility'
]);

export function extractKeywords(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !STOPWORDS.has(w));
}

export function matchVideo(name: string, videos: { id: string; filename: string }[]): string | null {
  const targetKeys = extractKeywords(name);
  if (!targetKeys.length) return null;

  let bestId: string | null = null;
  let bestScore = -1000;
  let maxMatches = 0;

  for (const v of videos) {
    const videoKeys = extractKeywords(v.filename);
    if (!videoKeys.length) continue;

    let matches = 0;
    for (const k of targetKeys) if (videoKeys.includes(k)) matches++;
    if (matches === 0) continue;

    let penalty = 0;
    for (const k of videoKeys) {
      if (SECTION_WORDS.has(k) && !targetKeys.includes(k)) {
        penalty += 2.0;
      }
    }

    const filteredVideoKeys = videoKeys.filter(k => 
      targetKeys.includes(k) || !/^\d+$/.test(k)
    );
    const precision = matches / filteredVideoKeys.length;
    const score = precision - penalty;
    
    if (matches > maxMatches) {
      maxMatches = matches;
      bestScore = score;
      bestId = v.id;
    } else if (matches === maxMatches && score > bestScore) {
      bestScore = score;
      bestId = v.id;
    }
  }

  return bestId;
}

export function rematchPlanWorkouts(planId: string) {
  const workouts = db.prepare('SELECT id, name, video_ids FROM workouts WHERE plan_id = ?').all(planId) as
    { id: string; name: string; video_ids: string | null }[];

  // Match against local videos only. External videos are bound by explicit ID at
  // import time, never by filename, so letting them into the candidate pool
  // would only create opportunities to mis-bind.
  const videos = db.prepare("SELECT id, filename FROM videos WHERE source = 'local'").all() as { id: string; filename: string }[];

  const externalIds = new Set(
    (db.prepare("SELECT id FROM videos WHERE source <> 'local'").all() as { id: string }[]).map(v => v.id)
  );

  const updateStmt = db.prepare('UPDATE workouts SET video_ids = ? WHERE id = ?');

  db.transaction(() => {
    for (const w of workouts) {
      let currentIds: string[] = [];
      try {
        const parsed = JSON.parse(w.video_ids || '[]');
        if (Array.isArray(parsed)) currentIds = parsed;
      } catch {}

      // A workout holding external videos was built by hand in the plan builder,
      // not matched from a spreadsheet. Rematching keys off the workout *name*
      // (the joined video titles), which would rebind a YouTube title onto some
      // similarly-named local file. Leave these exactly as the user set them.
      if (currentIds.some(id => externalIds.has(id))) continue;

      const videoNames = w.name.split('\n');
      const videoIds: string[] = [];
      for (const vname of videoNames) {
        const vid = matchVideo(vname, videos);
        if (vid && !videoIds.includes(vid)) videoIds.push(vid);
      }
      updateStmt.run(JSON.stringify(videoIds), w.id);
    }
  })();
}

export function rematchAllPlans() {
  const plans = db.prepare('SELECT id FROM workout_plans').all() as { id: string }[];
  for (const plan of plans) {
    rematchPlanWorkouts(plan.id);
  }
}
