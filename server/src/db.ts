import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
const thumbDir = path.join(dataDir, 'thumbnails');
[dataDir, thumbDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const db = new Database(path.join(dataDir, 'workout-planner.db'));
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    thumbnail_path TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS workout_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 0,
    start_date TEXT
  );

  CREATE TABLE IF NOT EXISTS workouts (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sequence_order INTEGER NOT NULL,
    video_ids TEXT, -- JSON array of video IDs
    FOREIGN KEY (plan_id) REFERENCES workout_plans(id)
  );

  CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    workout_id TEXT NOT NULL,
    video_id TEXT,    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (workout_id) REFERENCES workouts(id)
  );

  -- Durable, denormalized log of every completed workout/part.
  -- Intentionally has NO foreign keys so entries survive plan edits/deletes
  -- (unlike \`history\`, which is wiped when a plan is edited or removed).
  -- This is the source of truth for the persistent Profile history calendar.
  CREATE TABLE IF NOT EXISTS workout_log (
    id TEXT PRIMARY KEY,
    workout_id TEXT,
    video_id TEXT,
    plan_name TEXT,
    workout_name TEXT,
    video_filename TEXT,
    thumbnail_path TEXT,
    completed_date TEXT NOT NULL,
    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

/**
 * Durable record of plans carried through to the end.
 *
 * Deliberately mirrors `workout_log`: no foreign keys, and every field the UI
 * needs copied in at the moment it happens. A finished plan is a thing you did,
 * not a property of a plan that still exists — editing a plan wipes its
 * completion marks and deleting it takes them with it, and neither should erase
 * the fact that you once finished it.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS plan_completions (
    id TEXT PRIMARY KEY,
    plan_id TEXT,
    plan_name TEXT NOT NULL,
    workout_count INTEGER NOT NULL DEFAULT 0,
    started_on TEXT,
    finished_on TEXT NOT NULL,
    days_taken INTEGER,
    finished_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default settings if they don't exist
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('workout_pattern', JSON.stringify([1, 1, 1, 1, 1, 0])); // 5 work, 1 rest
insertSetting.run('video_directory', '');
insertSetting.run('exclude_paths', JSON.stringify([]));
insertSetting.run('start_date', new Date().toISOString().split('T')[0]); // YYYY-MM-DD
insertSetting.run('theme', 'midnight');
insertSetting.run('calendar_view', 'list');

// Normalize relative_path separators to `/` so Windows scans match the UI
// (which always splits on `/`). No-op when paths are already POSIX.
db.prepare("UPDATE videos SET relative_path = REPLACE(relative_path, '\\', '/') WHERE relative_path LIKE '%\\%'").run();

// Migrations
const tableInfo = db.pragma("table_info('workout_plans')") as any[];
const hasStartDate = tableInfo.some(col => col.name === 'start_date');
if (!hasStartDate) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN start_date TEXT');
}

const videoInfo = db.pragma("table_info('videos')") as any[];
const hasThumbnailPath = videoInfo.some(col => col.name === 'thumbnail_path');
if (!hasThumbnailPath) {
  db.exec('ALTER TABLE videos ADD COLUMN thumbnail_path TEXT');
}

const historyInfo = db.pragma("table_info('history')") as any[];
const hasVideoId = historyInfo.some(col => col.name === 'video_id');
if (!hasVideoId) {
  db.exec('ALTER TABLE history ADD COLUMN video_id TEXT');
}

const hasDescription = videoInfo.some(col => col.name === 'description');
if (!hasDescription) {
  db.exec('ALTER TABLE videos ADD COLUMN description TEXT');
}

const hasEquipment = videoInfo.some(col => col.name === 'equipment');
if (!hasEquipment) {
  db.exec('ALTER TABLE videos ADD COLUMN equipment TEXT');
}

// New metadata columns: training_type (JSON array), body_parts (JSON array), intensity (string)
const hasTrainingType = videoInfo.some(col => col.name === 'training_type');
if (!hasTrainingType) {
  db.exec("ALTER TABLE videos ADD COLUMN training_type TEXT");
}

const hasBodyParts = videoInfo.some(col => col.name === 'body_parts');
if (!hasBodyParts) {
  db.exec("ALTER TABLE videos ADD COLUMN body_parts TEXT");
}

const hasIntensity = videoInfo.some(col => col.name === 'intensity');
if (!hasIntensity) {
  db.exec("ALTER TABLE videos ADD COLUMN intensity TEXT");
}

// Runtime in whole seconds, read from the video file during a library scan.
// NULL means "not probed yet" (or the probe failed) and is filled in on the
// next scan, so existing libraries pick durations up without a full re-import.
const hasDuration = videoInfo.some(col => col.name === 'duration_seconds');
if (!hasDuration) {
  db.exec('ALTER TABLE videos ADD COLUMN duration_seconds INTEGER');
}

// Where a video comes from. 'local' is a file under the scanned library
// directory; anything else (currently only 'youtube') is an external video that
// has no file on disk and is played through the provider's own embed.
//
// Everything downstream of `workouts.video_ids` resolves IDs against this table,
// so external videos are stored as ordinary rows here rather than living inside
// a plan — the schedule, player, completion log and plan tags all keep working
// unchanged. The two places that must care are the library scan (which deletes
// rows with no file behind them) and the matcher (which rebinds by filename).
const hasSource = videoInfo.some(col => col.name === 'source');
if (!hasSource) {
  db.exec("ALTER TABLE videos ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");
}

// Provider-side identifier (e.g. a YouTube video ID) and the canonical watch
// URL. Both NULL for local videos.
const hasExternalId = videoInfo.some(col => col.name === 'external_id');
if (!hasExternalId) {
  db.exec('ALTER TABLE videos ADD COLUMN external_id TEXT');
}

const hasExternalUrl = videoInfo.some(col => col.name === 'external_url');
if (!hasExternalUrl) {
  db.exec('ALTER TABLE videos ADD COLUMN external_url TEXT');
}

// Each imported playlist becomes its own album in the Library. The provider's
// playlist ID is the stable grouping key; the title is only for display and is
// editable, so renaming an album never re-buckets its videos.
//
// A video belongs to one playlist: importing it again from a different playlist
// moves it, which keeps the album list predictable.
const hasPlaylistId = videoInfo.some(col => col.name === 'external_playlist_id');
if (!hasPlaylistId) {
  db.exec('ALTER TABLE videos ADD COLUMN external_playlist_id TEXT');
}

const hasPlaylistTitle = videoInfo.some(col => col.name === 'external_playlist_title');
if (!hasPlaylistTitle) {
  db.exec('ALTER TABLE videos ADD COLUMN external_playlist_title TEXT');
}

// One row per external video, so re-importing a playlist updates in place
// instead of duplicating. Partial index: local videos have NULL external_id.
db.exec(
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_external ON videos(source, external_id) WHERE external_id IS NOT NULL'
);

const planInfo = db.pragma("table_info('workout_plans')") as any[];
const hasBackgroundImage = planInfo.some(col => col.name === 'background_image');
if (!hasBackgroundImage) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN background_image TEXT');
}

const hasBackgroundBlur = planInfo.some(col => col.name === 'background_blur');
if (!hasBackgroundBlur) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN background_blur INTEGER DEFAULT 0');
}

// Optional grouping label for the Plans page. Holds either a known preset key
// (e.g. 'strength') or a user-typed custom label, which the client renders as-is.
const hasCategory = planInfo.some(col => col.name === 'category');
if (!hasCategory) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN category TEXT');
}

// Free-text note the user writes about a plan — what it's for, how it should
// feel. Shown on the active plan's card and in the plan details view.
const hasPlanDescription = planInfo.some(col => col.name === 'description');
if (!hasPlanDescription) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN description TEXT');
}

// This plan's own workout/rest rhythm, as a JSON array of 0/1 — the same shape
// as the global `workout_pattern` setting, which stays the default for new
// plans. NULL means "follow the global one", so every existing plan keeps
// behaving exactly as it did.
//
// Per-plan rather than global because two plans can now be active at once, and
// a gentle mobility plan alongside a five-day strength plan has no business
// being forced onto the same rhythm.
const hasPlanPattern = planInfo.some(col => col.name === 'workout_pattern');
if (!hasPlanPattern) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN workout_pattern TEXT');
}

// One-time backfill of the durable workout_log from the existing history table.
// This runs at startup (before any request) only when workout_log is empty, so on
// the first launch after this feature ships it seeds the log with past completions.
// Afterwards, the /toggle-done handler keeps workout_log in sync with history.
// `date(completed_at, 'localtime')` converts the UTC timestamp to the local day.
const workoutLogCount = (db.prepare('SELECT COUNT(*) AS c FROM workout_log').get() as { c: number }).c;
if (workoutLogCount === 0) {
  db.exec(`
    INSERT OR IGNORE INTO workout_log
      (id, workout_id, video_id, plan_name, workout_name, video_filename, thumbnail_path, completed_date, completed_at)
    SELECT
      h.id, h.workout_id, h.video_id, p.name, w.name, v.filename, v.thumbnail_path,
      date(h.completed_at, 'localtime'), h.completed_at
    FROM history h
    LEFT JOIN workouts w ON w.id = h.workout_id
    LEFT JOIN workout_plans p ON p.id = w.plan_id
    LEFT JOIN videos v ON v.id = h.video_id;
  `);
}

// Manual (self-logged) entries store their own metadata tags directly on the log
// row, since there is no linked video to join them from. `is_manual` distinguishes
// these from app-completed rows, which keep joining live metadata from `videos`.
const workoutLogInfo = db.pragma("table_info('workout_log')") as any[];
for (const col of ['training_type', 'body_parts', 'intensity', 'equipment']) {
  if (!workoutLogInfo.some((c: any) => c.name === col)) {
    db.exec(`ALTER TABLE workout_log ADD COLUMN ${col} TEXT`);
  }
}
if (!workoutLogInfo.some((c: any) => c.name === 'is_manual')) {
  db.exec('ALTER TABLE workout_log ADD COLUMN is_manual INTEGER DEFAULT 0');
}

// Free-text note the user attaches to a logged workout. Stored on every row of
// the workout so it survives if individual parts are re-marked.
if (!workoutLogInfo.some((c: any) => c.name === 'notes')) {
  db.exec('ALTER TABLE workout_log ADD COLUMN notes TEXT');
}

db.exec('CREATE INDEX IF NOT EXISTS idx_workout_log_date ON workout_log(completed_date)');

// One-time seeding of plan_completions from plans that are already finished.
// Runs only while the table is empty, so a plan finished before this shipped
// still shows up. The finish date comes from the last completion mark on that
// plan; the elapsed days from its start date.
const planCompletionCount = (db.prepare('SELECT COUNT(*) AS c FROM plan_completions').get() as { c: number }).c;
if (planCompletionCount === 0) {
  const seedPlans = db.prepare('SELECT id, name, start_date FROM workout_plans').all() as any[];
  const insertCompletion = db.prepare(`
    INSERT INTO plan_completions
      (id, plan_id, plan_name, workout_count, started_on, finished_on, days_taken, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const plan of seedPlans) {
    const workouts = db.prepare('SELECT id, video_ids FROM workouts WHERE plan_id = ?').all(plan.id) as any[];
    if (workouts.length === 0) continue;

    const done = db.prepare(`
      SELECT workout_id, video_id, completed_at FROM history
      WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id = ?)
    `).all(plan.id) as any[];
    const dayMarks = new Set(done.filter(h => !h.video_id).map(h => h.workout_id));
    const videoMarks = new Set(done.filter(h => h.video_id).map(h => `${h.workout_id}:${h.video_id}`));

    const allDone = workouts.every(w => {
      if (dayMarks.has(w.id)) return true;
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(w.video_ids || '[]');
        if (Array.isArray(parsed)) ids = parsed;
      } catch {}
      return ids.length > 0 && ids.every(vid => videoMarks.has(`${w.id}:${vid}`));
    });
    if (!allDone) continue;

    const last = done.map(h => h.completed_at).filter(Boolean).sort().pop();
    const finishedAt = last || new Date().toISOString();
    const finishedOn = String(finishedAt).slice(0, 10);
    const daysTaken = plan.start_date
      ? Math.max(1, Math.round((Date.parse(finishedOn) - Date.parse(plan.start_date)) / 86400000) + 1)
      : null;

    insertCompletion.run(
      `seed-${plan.id}`, plan.id, plan.name, workouts.length,
      plan.start_date ?? null, finishedOn, daysTaken, finishedAt
    );
  }
}

db.exec('CREATE INDEX IF NOT EXISTS idx_plan_completions_date ON plan_completions(finished_on)');

// The 'snow' theme was removed. Anyone still on it would fall back to the bare
// :root variables, so move them onto the default theme explicitly.
db.prepare("UPDATE settings SET value = 'midnight' WHERE key = 'theme' AND value = 'snow'").run();

export default db;
