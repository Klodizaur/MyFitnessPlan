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

const planInfo = db.pragma("table_info('workout_plans')") as any[];
const hasBackgroundImage = planInfo.some(col => col.name === 'background_image');
if (!hasBackgroundImage) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN background_image TEXT');
}

const hasBackgroundBlur = planInfo.some(col => col.name === 'background_blur');
if (!hasBackgroundBlur) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN background_blur INTEGER DEFAULT 0');
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

db.exec('CREATE INDEX IF NOT EXISTS idx_workout_log_date ON workout_log(completed_date)');

export default db;
