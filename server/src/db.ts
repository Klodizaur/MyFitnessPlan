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

// Codecs read out of the file, used to decide whether a client can play it as-is
// (see playback.ts). `codec_probed` separates "probed, and the file has no audio
// track" from "never looked", so a NULL codec is not re-probed forever. Filled in
// lazily the first time a video is played, so no re-scan is needed.
const codecInfo = db.pragma("table_info('videos')") as any[];
for (const col of ['video_codec', 'audio_codec']) {
  if (!codecInfo.some((c: any) => c.name === col)) {
    db.exec(`ALTER TABLE videos ADD COLUMN ${col} TEXT`);
  }
}
// Starred videos, gathered into a "Favourites" album in the Library. Rescans
// update rows in place, so the flag survives them.
if (!codecInfo.some((c: any) => c.name === 'is_favorite')) {
  db.exec('ALTER TABLE videos ADD COLUMN is_favorite INTEGER DEFAULT 0');
}
if (!codecInfo.some((c: any) => c.name === 'codec_probed')) {
  db.exec('ALTER TABLE videos ADD COLUMN codec_probed INTEGER DEFAULT 0');
}

// When a local file appeared on this computer (its creation date), for the
// dashboard's "Recently added". `added_at` can't do that job: it's when the scan
// first saw the file, and a first scan stamps the whole library with the same
// minute. Set by the scan; existing rows are filled in from disk just below.
if (!codecInfo.some((c: any) => c.name === 'file_created_at')) {
  db.exec('ALTER TABLE videos ADD COLUMN file_created_at TEXT');
}

/**
 * A file's creation date as ISO text, or null when it can't be read (the file
 * moved, or its drive is unplugged). Filesystems that don't record one report
 * 0, so the last-modified time stands in there.
 */
export function fileCreatedAt(filepath: string): string | null {
  try {
    const stat = fs.statSync(filepath);
    const ms = stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs;
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

// Backfill once per start for files the scan hasn't dated yet. Only stats files,
// so it's quick, and anything unreachable is just left for the next scan.
{
  const undated = db.prepare(
    "SELECT id, filepath FROM videos WHERE file_created_at IS NULL AND (source IS NULL OR source = 'local')"
  ).all() as { id: string; filepath: string }[];
  const setDate = db.prepare('UPDATE videos SET file_created_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of undated) {
      const created = fileCreatedAt(row.filepath);
      if (created) setDate.run(created, row.id);
    }
  })();
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

// Plans the user has starred. They are gathered under a "Favourites" heading at
// the top of the Plans page.
const hasFavorite = planInfo.some(col => col.name === 'is_favorite');
if (!hasFavorite) {
  db.exec('ALTER TABLE workout_plans ADD COLUMN is_favorite INTEGER DEFAULT 0');
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

// How many times the video was played through when it was marked done, for
// entries the user looped in the player. Null/0/1 all mean "played once" and
// render no badge; only a real set (2+) is worth marking in the log.
if (!workoutLogInfo.some((c: any) => c.name === 'loop_count')) {
  db.exec('ALTER TABLE workout_log ADD COLUMN loop_count INTEGER');
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

// One frozen calendar day for a plan: that day's card shows the reason
// instead of its scheduled workout, and the workout itself is deferred to the
// next open workout day — freezing a run of days pushes the rest of the plan
// back by the same span rather than losing what was scheduled on them (see
// buildSchedule in schedule.ts). UNIQUE so freezing an already-frozen day
// updates the reason instead of stacking rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS plan_freezes (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    date TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(plan_id, date)
  );
`);

// --- Profiles ---------------------------------------------------------------
//
// Several people can share one install, each with their own plans, progress,
// log, favourites, settings and library folder. The video files themselves —
// and their tags, descriptions and thumbnails — are shared: a video is the same
// video whoever watches it.
//
// Upgrading an install that predates profiles must not lose anything, so this
// only ever adds: a full copy of the database is saved first, then every
// existing row is labelled as belonging to the first profile. Nothing is moved
// or deleted. Tables that hang off a plan (workouts, history, plan_freezes)
// belong to whoever owns the plan and need no column of their own.

/** Settings each profile keeps for itself; everything else in `settings` is shared. */
export const PER_PROFILE_SETTINGS = [
  'workout_pattern', 'theme', 'calendar_view', 'video_directory', 'exclude_paths', 'start_date',
] as const;

export const BACKUP_DIR = path.join(dataDir, 'backups');

/** A consistent, standalone copy of the whole database (WAL included). */
export function backupDatabase(reason: string): string {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(BACKUP_DIR, `workout-planner-${reason}-${stamp}.db`);
  db.prepare('VACUUM INTO ?').run(backupPath);
  console.log(`[Backup] Saved ${backupPath}`);
  return backupPath;
}

const hasProfilesTable = Boolean(
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profiles'").get()
);
if (!hasProfilesTable) {
  const hasData = Boolean(db.prepare('SELECT 1 FROM videos LIMIT 1').get())
    || Boolean(db.prepare('SELECT 1 FROM workout_plans LIMIT 1').get())
    || Boolean(db.prepare('SELECT 1 FROM workout_log LIMIT 1').get());
  if (hasData) backupDatabase('before-profiles');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT 'avatar-1',
    pin_hash TEXT,
    -- Bumped whenever the PIN changes, which signs every device out of it.
    token_version INTEGER NOT NULL DEFAULT 0,
    -- 0 until the welcome wizard has given the profile a name.
    setup_done INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS profile_settings (
    profile_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY (profile_id, key)
  );

  -- Which videos are in each profile's library. The path is relative to that
  -- profile's own library folder, since two profiles' folders can differ (or
  -- one can sit inside the other); the favourite star is per person too.
  CREATE TABLE IF NOT EXISTS profile_videos (
    profile_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    relative_path TEXT NOT NULL DEFAULT '',
    is_favorite INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, video_id)
  );
  CREATE INDEX IF NOT EXISTS idx_profile_videos_video ON profile_videos(video_id);
`);

// 0 for a video that's only there because one of the profile's plans uses it:
// playable in that plan, but not part of the library they browse.
if (!(db.pragma("table_info('profile_videos')") as any[]).some((c: any) => c.name === 'in_library')) {
  db.exec('ALTER TABLE profile_videos ADD COLUMN in_library INTEGER NOT NULL DEFAULT 1');
}

for (const table of ['workout_plans', 'workout_log', 'plan_completions']) {
  const cols = db.pragma(`table_info('${table}')`) as any[];
  if (!cols.some((c: any) => c.name === 'profile_id')) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN profile_id TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_profile ON ${table}(profile_id)`);
}

/** The first profile: the one an upgraded install's existing data belongs to. */
export const FIRST_PROFILE_ID = 'p1';

db.transaction(() => {
  const anyProfile = db.prepare('SELECT id FROM profiles LIMIT 1').get();
  if (!anyProfile) {
    db.prepare('INSERT INTO profiles (id) VALUES (?)').run(FIRST_PROFILE_ID);
    // Its settings start as whatever the install had.
    const copySetting = db.prepare(
      'INSERT OR IGNORE INTO profile_settings (profile_id, key, value) SELECT ?, key, value FROM settings WHERE key = ?'
    );
    for (const key of PER_PROFILE_SETTINGS) copySetting.run(FIRST_PROFILE_ID, key);
    // And its library is everything already in the app, favourites included.
    db.prepare(`
      INSERT OR IGNORE INTO profile_videos (profile_id, video_id, relative_path, is_favorite)
      SELECT ?, id, COALESCE(relative_path, ''), COALESCE(is_favorite, 0) FROM videos
    `).run(FIRST_PROFILE_ID);
  }

  // Anything still unlabelled — on the upgrade, all of it — belongs to the
  // oldest profile. Idempotent, so it costs nothing on later starts.
  const owner = (db.prepare('SELECT id FROM profiles ORDER BY created_at ASC, rowid ASC LIMIT 1').get() as { id: string }).id;
  for (const table of ['workout_plans', 'workout_log', 'plan_completions']) {
    db.prepare(`UPDATE ${table} SET profile_id = ? WHERE profile_id IS NULL`).run(owner);
  }
})();

/**
 * Make sure every video a plan uses is in its owner's library — a plan copied
 * to someone whose own folder doesn't hold those videos would otherwise open
 * empty. The path comes from whoever already has the video (it's only used to
 * group it into a folder; playback goes by the file itself). Pass a plan id to
 * do just that plan; with none it repairs every plan, which runs on each start.
 */
export function ensurePlanVideosInLibrary(planId?: string): number {
  return db.prepare(`
    INSERT OR IGNORE INTO profile_videos (profile_id, video_id, relative_path, in_library)
    SELECT DISTINCT p.profile_id, v.id,
      COALESCE((SELECT x.relative_path FROM profile_videos x WHERE x.video_id = v.id LIMIT 1), v.relative_path, ''),
      0
    FROM workout_plans p
    JOIN workouts w ON w.plan_id = p.id, json_each(CASE WHEN json_valid(w.video_ids) THEN w.video_ids ELSE '[]' END) j
    JOIN videos v ON v.id = j.value
    WHERE p.profile_id IS NOT NULL ${planId ? 'AND p.id = ?' : ''}
  `).run(...(planId ? [planId] : [])).changes;
}

// AI settings (provider, model, API key…) became per profile: whoever set them
// up before profiles existed keeps them, on the first profile. Copied once,
// marked so it never repeats; the old shared rows are left where they were.
db.transaction(() => {
  if (db.prepare("SELECT 1 FROM settings WHERE key = 'profiles_ai_moved'").get()) return;
  const owner = (db.prepare('SELECT id FROM profiles ORDER BY created_at ASC, rowid ASC LIMIT 1').get() as { id: string }).id;
  db.prepare(`
    INSERT OR IGNORE INTO profile_settings (profile_id, key, value)
    SELECT ?, key, value FROM settings WHERE substr(key, 1, 3) = 'ai_'
  `).run(owner);
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('profiles_ai_moved', '1')").run();
})();

const repaired = ensurePlanVideosInLibrary();
if (repaired) console.log(`[Profiles] Added ${repaired} plan video(s) to their owners' libraries`);

/**
 * Which local videos a profile browses: exactly the ones under its own library
 * folder. Anything else it has (a copied plan's videos from someone else's
 * folder) stays for the plan but out of the Library. Re-derived on each start,
 * so it also tidies profiles from before the flag existed.
 */
export function syncLibraryFlags(profileId?: string): void {
  const profiles = (profileId
    ? [{ id: profileId }]
    : db.prepare('SELECT id FROM profiles').all()) as { id: string }[];
  const dirOf = db.prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'video_directory'");
  const update = db.prepare(`
    UPDATE profile_videos SET in_library = CASE
      WHEN ? <> '' AND (SELECT substr(v.filepath, 1, ?) FROM videos v WHERE v.id = profile_videos.video_id) = ? THEN 1 ELSE 0 END
    WHERE profile_id = ? AND video_id IN (SELECT id FROM videos WHERE source = 'local')
  `);
  db.transaction(() => {
    for (const { id } of profiles) {
      const dir = ((dirOf.get(id) as { value: string | null } | undefined)?.value || '').replace(/[\\/]+$/, '');
      const prefix = dir ? dir + path.sep : '';
      update.run(prefix, prefix.length, prefix, id);
    }
  })();
}
syncLibraryFlags();

export default db;
