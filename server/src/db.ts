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
`);

// Insert default settings if they don't exist
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
insertSetting.run('workout_pattern', JSON.stringify([1, 1, 1, 1, 1, 0])); // 5 work, 1 rest
insertSetting.run('video_directory', '');
insertSetting.run('exclude_paths', JSON.stringify([]));
insertSetting.run('start_date', new Date().toISOString().split('T')[0]); // YYYY-MM-DD
insertSetting.run('theme', 'midnight');
insertSetting.run('calendar_view', 'list');// Migrations
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
export default db;
