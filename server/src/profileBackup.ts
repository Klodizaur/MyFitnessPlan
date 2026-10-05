import fs from 'fs';
import path from 'path';
import db, { BACKUP_DIR, backupDatabase } from './db.js';
import { getProfile, listProfiles, setProfileSetting } from './profiles.js';
import { appVersion } from './version.js';

/**
 * One person's backup: everything that's theirs alone — plans (with their
 * days, ticks and freezes), log, finished plans, which videos are in their
 * library (and their favourites), and settings. Never their AI key, and never
 * the video files, which are shared.
 *
 * A backup records the profile's ID as well as its name. Names change, IDs
 * don't, so the ID is how a backup knows whose it is: restoring it into the
 * same profile just works, restoring it into someone else's is possible but
 * asked about first, and on a new computer (or after starting over) "restore
 * as a profile" brings it back under its old ID, so it lines up again.
 */

export const PROFILE_BACKUP_FORMAT = 'myfitnessplan.profile-backup';
export const PROFILE_BACKUP_VERSION = 1;

/** Settings the backup schedule itself uses; kept out of the backed-up settings. */
const SCHEDULE_KEYS = ['backup_every_days', 'backup_dir', 'backup_keep', 'backup_last_at'];

export interface ProfileBackup {
  format: typeof PROFILE_BACKUP_FORMAT;
  version: number;
  profileId: string;
  profileName: string;
  /** A built-in picture's id; an uploaded photo isn't carried (it's a file). */
  avatar: string | null;
  createdAt: string;
  appVersion: string;
  settings: { key: string; value: string | null }[];
  videos: {
    id: string; filename: string; filepath: string; source: string; external_id: string | null;
    relative_path: string; is_favorite: number; in_library: number;
  }[];
  plans: Record<string, unknown>[];
  workouts: Record<string, unknown>[];
  history: Record<string, unknown>[];
  freezes: Record<string, unknown>[];
  log: Record<string, unknown>[];
  completions: Record<string, unknown>[];
}

const planIds = 'SELECT id FROM workout_plans WHERE profile_id = ?';

export function buildProfileBackup(profileId: string): ProfileBackup {
  const profile = getProfile(profileId)!;
  return {
    format: PROFILE_BACKUP_FORMAT,
    version: PROFILE_BACKUP_VERSION,
    profileId,
    profileName: profile.name,
    avatar: profile.avatar.startsWith('custom:') ? null : profile.avatar,
    createdAt: new Date().toISOString(),
    appVersion,
    settings: (db.prepare(`
      SELECT key, value FROM profile_settings
      WHERE profile_id = ? AND substr(key, 1, 3) <> 'ai_' AND key NOT IN (${SCHEDULE_KEYS.map(() => '?').join(', ')})
    `).all(profileId, ...SCHEDULE_KEYS)) as ProfileBackup['settings'],
    videos: db.prepare(`
      SELECT v.id, v.filename, v.filepath, COALESCE(v.source, 'local') AS source, v.external_id,
        pv.relative_path, pv.is_favorite, pv.in_library
      FROM profile_videos pv JOIN videos v ON v.id = pv.video_id WHERE pv.profile_id = ?
    `).all(profileId) as ProfileBackup['videos'],
    plans: db.prepare('SELECT * FROM workout_plans WHERE profile_id = ?').all(profileId) as Record<string, unknown>[],
    workouts: db.prepare(`SELECT * FROM workouts WHERE plan_id IN (${planIds})`).all(profileId) as Record<string, unknown>[],
    history: db.prepare(`SELECT * FROM history WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id IN (${planIds}))`).all(profileId) as Record<string, unknown>[],
    freezes: db.prepare(`SELECT * FROM plan_freezes WHERE plan_id IN (${planIds})`).all(profileId) as Record<string, unknown>[],
    log: db.prepare('SELECT * FROM workout_log WHERE profile_id = ?').all(profileId) as Record<string, unknown>[],
    completions: db.prepare('SELECT * FROM plan_completions WHERE profile_id = ?').all(profileId) as Record<string, unknown>[],
  };
}

export type BackupCheck =
  | { ok: true; backup: ProfileBackup }
  | { ok: false; error: 'not_a_backup' | 'newer_version' };

/** Is this a profile backup this app can read? (Whose it is, is the caller's question.) */
export function checkProfileBackup(data: any): BackupCheck {
  if (!data || typeof data !== 'object' || data.format !== PROFILE_BACKUP_FORMAT) return { ok: false, error: 'not_a_backup' };
  if (typeof data.version !== 'number' || data.version > PROFILE_BACKUP_VERSION) return { ok: false, error: 'newer_version' };
  if (typeof data.profileId !== 'string' || !data.profileId) return { ok: false, error: 'not_a_backup' };
  for (const key of ['settings', 'videos', 'plans', 'workouts', 'history', 'freezes', 'log', 'completions']) {
    if (!Array.isArray(data[key])) return { ok: false, error: 'not_a_backup' };
  }
  return { ok: true, backup: data as ProfileBackup };
}

/** What a backup holds, for the "restore this?" question. */
export function describeBackup(backup: ProfileBackup) {
  return {
    profileId: backup.profileId,
    profileName: backup.profileName,
    createdAt: backup.createdAt,
    plans: backup.plans.length,
    logEntries: backup.log.length,
    profileExistsHere: Boolean(getProfile(backup.profileId)),
  };
}

/** Insert a row with only the columns this table (still) has — so old backups restore into newer apps. */
function insertRow(table: string, row: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const columns = new Set((db.pragma(`table_info('${table}')`) as { name: string }[]).map(c => c.name));
  const data = { ...row, ...overrides };
  const keys = Object.keys(data).filter(k => columns.has(k));
  if (!keys.length) return;
  db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map(k => data[k] as any));
}

/**
 * Put a profile back the way a backup has it: its plans, ticks, freezes, log,
 * finishes, library and settings replace what's there now. A full copy of the
 * whole app is saved first, so even a restore can be undone.
 *
 * Videos are matched to this library by ID, then by file path, then by
 * YouTube ID, then — for a backup from another computer, where paths differ —
 * by filename when exactly one video has it. A library rescanned since the
 * backup gives videos new IDs; those are re-linked rather than lost. Anything
 * still unmatched stays in the plans by its old ID, and re-links by name once
 * this library is scanned.
 */
export function restoreProfileBackup(profileId: string, backup: ProfileBackup): { plans: number; logEntries: number; videos: number } {
  backupDatabase(`before-restoring-profile-${profileId}`);

  const byId = db.prepare('SELECT id FROM videos WHERE id = ?');
  const byPath = db.prepare("SELECT id FROM videos WHERE source = 'local' AND filepath = ?");
  const byExternal = db.prepare('SELECT id FROM videos WHERE source = ? AND external_id = ?');
  const byName = db.prepare("SELECT id FROM videos WHERE source = 'local' AND filename = ? LIMIT 2");
  const uniqueByName = (filename: string) => {
    const rows = byName.all(filename) as { id: string }[];
    return rows.length === 1 ? rows[0] : undefined;
  };
  const videoMap = new Map<string, string>();
  for (const v of backup.videos) {
    const found = (byId.get(v.id) as { id: string } | undefined)
      ?? (v.source === 'local' && v.filepath ? byPath.get(v.filepath) as { id: string } | undefined : undefined)
      ?? (v.source !== 'local' && v.external_id ? byExternal.get(v.source, v.external_id) as { id: string } | undefined : undefined)
      ?? (v.source === 'local' && v.filename ? uniqueByName(v.filename) : undefined);
    if (found) videoMap.set(v.id, found.id);
  }
  const remap = (id: unknown) => (typeof id === 'string' && videoMap.get(id)) || id;
  const remapList = (raw: unknown) => {
    try {
      const ids = JSON.parse(typeof raw === 'string' ? raw : '[]');
      return JSON.stringify(Array.isArray(ids) ? ids.map(remap) : []);
    } catch {
      return '[]';
    }
  };

  let videos = 0;
  db.transaction(() => {
    // Out with what's there now (the same set deleting a profile removes)…
    db.prepare(`DELETE FROM history WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id IN (${planIds}))`).run(profileId);
    db.prepare(`DELETE FROM plan_freezes WHERE plan_id IN (${planIds})`).run(profileId);
    db.prepare(`DELETE FROM workouts WHERE plan_id IN (${planIds})`).run(profileId);
    db.prepare('DELETE FROM workout_plans WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM workout_log WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM plan_completions WHERE profile_id = ?').run(profileId);
    db.prepare('DELETE FROM profile_videos WHERE profile_id = ?').run(profileId);
    db.prepare(`
      DELETE FROM profile_settings WHERE profile_id = ? AND substr(key, 1, 3) <> 'ai_'
        AND key NOT IN (${SCHEDULE_KEYS.map(() => '?').join(', ')})
    `).run(profileId, ...SCHEDULE_KEYS);

    // …and in with the backup.
    for (const s of backup.settings) {
      if (typeof s.key === 'string' && !s.key.startsWith('ai_') && !SCHEDULE_KEYS.includes(s.key)) setProfileSetting(profileId, s.key, s.value);
    }
    for (const v of backup.videos) {
      const id = videoMap.get(v.id);
      if (!id) continue;
      db.prepare(`
        INSERT OR REPLACE INTO profile_videos (profile_id, video_id, relative_path, is_favorite, in_library)
        VALUES (?, ?, ?, ?, ?)
      `).run(profileId, id, v.relative_path || '', v.is_favorite ? 1 : 0, v.in_library === 0 ? 0 : 1);
      videos++;
    }
    for (const row of backup.plans) insertRow('workout_plans', row, { profile_id: profileId });
    for (const row of backup.workouts) insertRow('workouts', row, { video_ids: remapList(row.video_ids) });
    for (const row of backup.history) insertRow('history', row, { video_id: row.video_id == null ? null : remap(row.video_id) });
    for (const row of backup.freezes) insertRow('plan_freezes', row);
    for (const row of backup.log) insertRow('workout_log', row, { profile_id: profileId, video_id: row.video_id == null ? null : remap(row.video_id) });
    for (const row of backup.completions) insertRow('plan_completions', row, { profile_id: profileId });
  })();

  return { plans: backup.plans.length, logEntries: backup.log.length, videos };
}

// --- Scheduled backups ---------------------------------------------------------

export const DEFAULT_KEEP = 10;

/** Where a profile's backups go: its chosen folder, else one inside the app's data. */
export function backupFolder(profileId: string): string {
  const chosen = (db.prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'backup_dir'").get(profileId) as
    { value: string | null } | undefined)?.value;
  return chosen || path.join(BACKUP_DIR, 'profiles', profileId);
}

const FILE_PATTERN = (profileId: string) => new RegExp(`^myfitnessplan-profile-${profileId.replace(/[^A-Za-z0-9_-]/g, '')}-.*\\.json$`);

/** Write a backup file now, prune the oldest beyond the keep count, and return its path. */
export function writeProfileBackup(profileId: string): string {
  const dir = backupFolder(profileId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `myfitnessplan-profile-${profileId}-${stamp}.json`);
  // Written beside its final name and renamed into place, so a half-written
  // file never looks like a backup.
  fs.writeFileSync(`${file}.part`, JSON.stringify(buildProfileBackup(profileId)));
  fs.renameSync(`${file}.part`, file);
  setProfileSetting(profileId, 'backup_last_at', new Date().toISOString());

  const keep = Math.max(1, Number(
    (db.prepare("SELECT value FROM profile_settings WHERE profile_id = ? AND key = 'backup_keep'").get(profileId) as
      { value: string | null } | undefined)?.value
  ) || DEFAULT_KEEP);
  const mine = fs.readdirSync(dir).filter(name => FILE_PATTERN(profileId).test(name)).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - keep))) {
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* already gone */ }
  }
  return file;
}

/** What's in a profile's backup folder now: how many of its backups, and their size. */
export function backupFolderStats(profileId: string): { files: number; totalBytes: number; folderExists: boolean } {
  const dir = backupFolder(profileId);
  try {
    const mine = fs.readdirSync(dir).filter(name => FILE_PATTERN(profileId).test(name));
    const totalBytes = mine.reduce((sum, name) => {
      try { return sum + fs.statSync(path.join(dir, name)).size; } catch { return sum; }
    }, 0);
    return { files: mine.length, totalBytes, folderExists: true };
  } catch {
    // Not made yet (no backup so far) — or gone, like an unplugged drive.
    return { files: 0, totalBytes: 0, folderExists: fs.existsSync(dir) };
  }
}

/** Run any backups that are due. Called on start and then every half hour. */
export function runDueBackups(log: (msg: string) => void = console.log): void {
  for (const profile of listProfiles()) {
    const get = (key: string) => (db.prepare('SELECT value FROM profile_settings WHERE profile_id = ? AND key = ?').get(profile.id, key) as
      { value: string | null } | undefined)?.value ?? null;
    const everyDays = Number(get('backup_every_days')) || 0;
    if (everyDays <= 0) continue;
    const last = Date.parse(get('backup_last_at') || '') || 0;
    if (Date.now() - last < everyDays * 24 * 60 * 60 * 1000) continue;
    try {
      log(`[Backup] ${profile.name || profile.id}: saved ${writeProfileBackup(profile.id)}`);
    } catch (err) {
      // A folder that's gone (an unplugged drive) shouldn't stop anyone else's.
      log(`[Backup] ${profile.name || profile.id}: failed — ${(err as Error).message}`);
    }
  }
}

export function startBackupSchedule(log?: (msg: string) => void): void {
  const tick = () => runDueBackups(log);
  setTimeout(tick, 30_000).unref?.();
  setInterval(tick, 30 * 60 * 1000).unref?.();
}
