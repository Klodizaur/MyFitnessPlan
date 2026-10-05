import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import db, { BACKUP_DIR, backupDatabase, PER_PROFILE_SETTINGS } from '../db.js';
import {
  clearProfileCookie, currentProfileId, getProfile, isLocalRequest, listProfiles, ProfileRow,
  requireProfile, setProfileCookie, setProfileSetting,
} from '../profiles.js';
import { copyPlanTo } from '../planCopy.js';
import {
  backupFolder, backupFolderStats, buildProfileBackup, checkProfileBackup, DEFAULT_KEEP, describeBackup, restoreProfileBackup,
  writeProfileBackup,
} from '../profileBackup.js';

/** The six avatars the app ships; the client draws them from /avatars/<id>.svg. */
const AVATARS = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'];

/** What a profile that starts from scratch gets, rather than anyone else's choices. */
const FRESH_SETTINGS: Record<string, string> = {
  workout_pattern: JSON.stringify([1, 1, 1, 1, 1, 0]),
  theme: 'midnight',
  calendar_view: 'list',
  video_directory: '',
  exclude_paths: JSON.stringify([]),
};

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().slice(0, 40);
  return name || null;
}

function cleanAvatar(raw: unknown): string {
  return typeof raw === 'string' && AVATARS.includes(raw) ? raw : AVATARS[0];
}

// --- Uploaded profile pictures ---------------------------------------------
//
// A profile's own photo is stored as `custom:<file>` in `avatar`. The browser
// crops and shrinks it to a small square JPEG before uploading, and anything
// else is refused, so these stay a few tens of KB each. A profile keeps at most
// one: a new upload, switching back to a built-in picture, or deleting the
// profile removes the old file.

const PICTURE_DIR = path.join(process.cwd(), 'data', 'profile-pictures');
const PICTURE_FILE = /^[A-Za-z0-9_-]+\.jpg$/;
const MAX_PICTURE_BYTES = 512 * 1024;

function pictureFile(avatar: string | null | undefined): string | null {
  if (!avatar?.startsWith('custom:')) return null;
  const file = avatar.slice('custom:'.length);
  return PICTURE_FILE.test(file) ? file : null;
}

function removePicture(avatar: string | null | undefined): void {
  const file = pictureFile(avatar);
  if (!file) return;
  try { fs.unlinkSync(path.join(PICTURE_DIR, file)); } catch { /* already gone */ }
}

/**
 * A profile's avatar after an edit: a built-in picture if one was chosen
 * (dropping any uploaded photo), else whatever it already had.
 */
function nextAvatar(currentAvatar: string, raw: unknown): string {
  if (typeof raw === 'string' && AVATARS.includes(raw)) {
    if (raw !== currentAvatar) removePicture(currentAvatar);
    return raw;
  }
  return currentAvatar;
}

/** A PIN is exactly 4 digits; anything else (including null) means "no PIN". */
function cleanPin(raw: unknown): string | null {
  return typeof raw === 'string' && /^\d{4}$/.test(raw) ? raw : null;
}

function publicProfile(p: ProfileRow) {
  return { id: p.id, name: p.name, avatar: p.avatar, hasPin: Boolean(p.pin_hash), setupDone: p.setup_done === 1 };
}

export default async function (fastify: FastifyInstance) {
  /** Everyone, for the picker — no PINs, nothing private. */
  fastify.get('/', async (request, reply) => {
    return reply.send({
      profiles: listProfiles().map(publicProfile),
      currentId: currentProfileId(request),
      // The client offers "Forgot PIN?" only where it can actually work.
      isLocal: isLocalRequest(request),
    });
  });

  /** Become a profile on this device. A wrong PIN just says so; there's no lockout. */
  fastify.post('/:id/select', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { pin } = (request.body ?? {}) as { pin?: string };
    const profile = getProfile(id);
    if (!profile) return reply.code(404).send({ error: 'Profile not found' });
    if (profile.pin_hash && !(typeof pin === 'string' && bcrypt.compareSync(pin, profile.pin_hash))) {
      return reply.code(403).send({ error: 'wrong_pin' });
    }
    setProfileCookie(reply, profile);
    return reply.send({ success: true, profile: publicProfile(profile) });
  });

  /** Forget the profile on this device, so it opens on the picker next time. */
  fastify.post('/sign-out', async (_request, reply) => {
    clearProfileCookie(reply);
    return reply.send({ success: true });
  });

  /**
   * The welcome wizard: name the current profile (on an upgrade, that's all
   * the existing data), pick an avatar and optionally a PIN.
   */
  fastify.post('/setup', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const body = (request.body ?? {}) as { name?: string; avatar?: string; pin?: string };
    const name = cleanName(body.name);
    if (!name) return reply.code(400).send({ error: 'name_required' });
    const pin = cleanPin(body.pin);

    db.prepare(`
      UPDATE profiles SET name = ?, avatar = ?, setup_done = 1,
        pin_hash = COALESCE(?, pin_hash), token_version = token_version + (CASE WHEN ? IS NULL THEN 0 ELSE 1 END)
      WHERE id = ?
    `).run(name, nextAvatar(getProfile(profileId)!.avatar, body.avatar), pin ? bcrypt.hashSync(pin, 10) : null, pin, profileId);

    const profile = getProfile(profileId)!;
    // Keep this device signed in through the PIN change.
    setProfileCookie(reply, profile);
    return reply.send({ success: true, profile: publicProfile(profile) });
  });

  /**
   * A new profile.
   *
   * `mode: 'copy'` starts from another profile's setup: its video folder (same
   * favourites) and settings — not its imported YouTube playlists, which stay
   * theirs. `mode: 'fresh'` starts empty with
   * the app's defaults; the person picks their own folder afterwards. Either
   * way `planIds` copies plans from `sourceId` — as fresh copies, never with
   * anyone's ticks or log, which belong to whoever did the workouts. The source
   * can only be the profile doing the adding.
   */
  fastify.post('/', async (request, reply) => {
    // Anyone can add themselves from "Who's training?" — even on a device that
    // hasn't picked a profile. Copying someone's setup or plans needs to be
    // signed in as someone, though: without that, a new profile starts from
    // scratch, so nobody's PIN-protected plans can be copied out from under them.
    const creator = currentProfileId(request);
    const body = (request.body ?? {}) as {
      name?: string; avatar?: string; pin?: string;
      mode?: 'copy' | 'fresh'; sourceId?: string; planIds?: string[];
    };
    const name = cleanName(body.name);
    if (!name) return reply.code(400).send({ error: 'name_required' });
    const pin = cleanPin(body.pin);
    // And only your own: a PIN keeps your plans yours, so nobody copies them but you.
    const sourceId = creator && body.sourceId === creator ? creator : null;
    const mode = body.mode === 'copy' && sourceId ? 'copy' : 'fresh';
    const planIds = Array.isArray(body.planIds) ? body.planIds.filter(id => typeof id === 'string') : [];

    const id = nanoid(10);
    db.transaction(() => {
      db.prepare('INSERT INTO profiles (id, name, avatar, pin_hash, setup_done) VALUES (?, ?, ?, ?, 1)')
        .run(id, name, cleanAvatar(body.avatar), pin ? bcrypt.hashSync(pin, 10) : null);

      if (mode === 'copy') {
        db.prepare(`
          INSERT INTO profile_settings (profile_id, key, value)
          SELECT ?, key, value FROM profile_settings
          -- Not AI settings: those are personal (an API key is the owner's to spend).
          WHERE profile_id = ? AND substr(key, 1, 3) <> 'ai_'
        `).run(id, sourceId);
        db.prepare(`
          INSERT INTO profile_videos (profile_id, video_id, relative_path, is_favorite, in_library)
          SELECT ?, pv.video_id, pv.relative_path, pv.is_favorite, pv.in_library
          FROM profile_videos pv JOIN videos v ON v.id = pv.video_id
          -- The video folder only. Imported YouTube playlists are the
          -- importer's own; copied plans still bring the YouTube videos they
          -- use (for the plan only — see ensurePlanVideosInLibrary).
          WHERE pv.profile_id = ? AND v.source = 'local'
        `).run(id, sourceId);
      }
      // Fill in whatever the copy didn't bring (or everything, from scratch).
      for (const key of PER_PROFILE_SETTINGS) {
        if (key in FRESH_SETTINGS) {
          db.prepare('INSERT OR IGNORE INTO profile_settings (profile_id, key, value) VALUES (?, ?, ?)')
            .run(id, key, FRESH_SETTINGS[key]);
        }
      }

      if (sourceId) {
        for (const planId of planIds) {
          const owned = db.prepare('SELECT 1 FROM workout_plans WHERE id = ? AND profile_id = ?').get(planId, sourceId);
          if (owned) copyPlanTo(planId, id);
        }
      }
    })();

    return reply.send({ success: true, profile: publicProfile(getProfile(id)!) });
  });

  /** Rename or re-pick the avatar — your own profile only. */
  fastify.patch('/me', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const body = (request.body ?? {}) as { name?: string; avatar?: string };
    const profile = getProfile(profileId)!;
    const name = body.name === undefined ? profile.name : cleanName(body.name);
    if (!name) return reply.code(400).send({ error: 'name_required' });
    const avatar = nextAvatar(profile.avatar, body.avatar);
    db.prepare('UPDATE profiles SET name = ?, avatar = ? WHERE id = ?').run(name, avatar, profileId);
    return reply.send({ success: true, profile: publicProfile(getProfile(profileId)!) });
  });

  /** Upload your own profile photo, replacing (and deleting) any previous one. */
  fastify.post('/me/picture', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    // Anything that goes wrong leaves the profile exactly as it was: the new
    // photo only takes over once it's fully saved, and only then is the old
    // one deleted.
    let buffer: Buffer;
    try {
      const data = await request.file();
      if (!data) return reply.code(400).send({ error: 'no_file' });
      buffer = await data.toBuffer();
    } catch {
      return reply.code(400).send({ error: 'too_large' });
    }
    // A JPEG (as the browser makes it), small enough to be a resized avatar.
    const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!isJpeg) return reply.code(400).send({ error: 'not_an_image' });
    if (buffer.length > MAX_PICTURE_BYTES) return reply.code(400).send({ error: 'too_large' });

    const file = `${profileId}-${nanoid(8)}.jpg`;
    const full = path.join(PICTURE_DIR, file);
    const previous = getProfile(profileId)!.avatar;
    try {
      fs.mkdirSync(PICTURE_DIR, { recursive: true });
      fs.writeFileSync(full, buffer);
      db.prepare('UPDATE profiles SET avatar = ? WHERE id = ?').run(`custom:${file}`, profileId);
    } catch (err) {
      request.log.error(err);
      try { fs.unlinkSync(full); } catch { /* never written */ }
      return reply.code(500).send({ error: 'save_failed' });
    }
    removePicture(previous);
    return reply.send({ success: true, profile: publicProfile(getProfile(profileId)!) });
  });

  /** An uploaded profile photo. Public like the rest of the picker: names and pictures. */
  fastify.get('/pictures/:file', async (request, reply) => {
    const { file } = request.params as { file: string };
    if (!PICTURE_FILE.test(file)) return reply.code(404).send({ error: 'not_found' });
    const full = path.join(PICTURE_DIR, file);
    if (!fs.existsSync(full)) return reply.code(404).send({ error: 'not_found' });
    return reply.type('image/jpeg').header('Cache-Control', 'public, max-age=31536000, immutable').send(fs.createReadStream(full));
  });

  /**
   * Set, change or remove your own PIN (`pin: null` removes it). Other devices
   * are signed out of the profile; this one stays in.
   */
  fastify.put('/me/pin', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const { pin } = (request.body ?? {}) as { pin?: string | null };
    const clean = cleanPin(pin);
    if (pin !== null && !clean) return reply.code(400).send({ error: 'pin_must_be_4_digits' });
    db.prepare('UPDATE profiles SET pin_hash = ?, token_version = token_version + 1 WHERE id = ?')
      .run(clean ? bcrypt.hashSync(clean, 10) : null, profileId);
    const profile = getProfile(profileId)!;
    setProfileCookie(reply, profile);
    return reply.send({ success: true, profile: publicProfile(profile) });
  });

  /**
   * Forgot the PIN: remove it, from the computer running the app only. Nobody
   * can be locked out of their own data — and nobody on another device can
   * strip someone else's PIN.
   */
  fastify.post('/:id/reset-pin', async (request, reply) => {
    if (!isLocalRequest(request)) return reply.code(403).send({ error: 'reset_only_on_host' });
    const { id } = request.params as { id: string };
    if (!getProfile(id)) return reply.code(404).send({ error: 'Profile not found' });
    db.prepare('UPDATE profiles SET pin_hash = NULL, token_version = token_version + 1 WHERE id = ?').run(id);
    const profile = getProfile(id)!;
    setProfileCookie(reply, profile);
    return reply.send({ success: true, profile: publicProfile(profile) });
  });

  /**
   * Delete a profile and everything that is only its own: plans (with their
   * days, ticks and freezes), log, finished plans, settings and library list.
   * Shared videos stay. A backup is saved first, the last profile can't be
   * deleted, and only that profile itself or the computer running the app can
   * do it.
   */
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!getProfile(id)) return reply.code(404).send({ error: 'Profile not found' });
    if (currentProfileId(request) !== id && !isLocalRequest(request)) {
      return reply.code(403).send({ error: 'not_allowed' });
    }
    if (listProfiles().length <= 1) return reply.code(400).send({ error: 'last_profile' });

    backupDatabase(`before-deleting-profile-${id}`);
    removePicture(getProfile(id)!.avatar);
    db.transaction(() => {
      const plans = 'SELECT id FROM workout_plans WHERE profile_id = ?';
      db.prepare(`DELETE FROM history WHERE workout_id IN (SELECT id FROM workouts WHERE plan_id IN (${plans}))`).run(id);
      db.prepare(`DELETE FROM plan_freezes WHERE plan_id IN (${plans})`).run(id);
      db.prepare(`DELETE FROM workouts WHERE plan_id IN (${plans})`).run(id);
      db.prepare('DELETE FROM workout_plans WHERE profile_id = ?').run(id);
      db.prepare('DELETE FROM workout_log WHERE profile_id = ?').run(id);
      db.prepare('DELETE FROM plan_completions WHERE profile_id = ?').run(id);
      db.prepare('DELETE FROM profile_settings WHERE profile_id = ?').run(id);
      db.prepare('DELETE FROM profile_videos WHERE profile_id = ?').run(id);
      db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
    })();

    if (currentProfileId(request) === null) clearProfileCookie(reply);
    return reply.send({ success: true });
  });

  // --- Your own backups ------------------------------------------------------

  const setting = (profileId: string, key: string) =>
    (db.prepare('SELECT value FROM profile_settings WHERE profile_id = ? AND key = ?').get(profileId, key) as
      { value: string | null } | undefined)?.value ?? null;

  /** Your backup schedule, and where backups go. */
  fastify.get('/me/backup', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const everyDays = Number(setting(profileId, 'backup_every_days')) || 0;
    const lastAt = setting(profileId, 'backup_last_at');
    // Overdue: on a schedule, and the last one is well past when the next was due
    // (the folder went away, the drive's unplugged, the app was off a long time).
    const overdue = everyDays > 0 && Boolean(lastAt)
      && Date.now() - Date.parse(lastAt!) > (everyDays + 1) * 24 * 60 * 60 * 1000;
    return reply.send({
      everyDays,
      keep: Number(setting(profileId, 'backup_keep')) || DEFAULT_KEEP,
      ...backupFolderStats(profileId),
      overdue,
      dir: setting(profileId, 'backup_dir') || '',
      folder: backupFolder(profileId),
      defaultFolder: path.join(BACKUP_DIR, 'profiles', profileId),
      lastAt,
      // A folder can only be chosen on the computer running the app.
      canChooseFolder: isLocalRequest(request),
    });
  });

  fastify.put('/me/backup', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const body = (request.body ?? {}) as { everyDays?: number; keep?: number; dir?: string };
    if (body.everyDays !== undefined) {
      const days = Math.max(0, Math.min(365, Math.floor(Number(body.everyDays) || 0)));
      setProfileSetting(profileId, 'backup_every_days', String(days));
    }
    if (body.keep !== undefined) {
      setProfileSetting(profileId, 'backup_keep', String(Math.max(1, Math.min(100, Math.floor(Number(body.keep) || DEFAULT_KEEP)))));
    }
    if (body.dir !== undefined) {
      if (!isLocalRequest(request)) return reply.code(403).send({ error: 'folder_only_on_host' });
      const dir = typeof body.dir === 'string' ? body.dir.trim() : '';
      if (dir) {
        let ok = false;
        try { ok = path.isAbsolute(dir) && fs.statSync(dir).isDirectory(); } catch { ok = false; }
        if (!ok) return reply.code(400).send({ error: 'folder_not_found' });
      }
      setProfileSetting(profileId, 'backup_dir', dir || null);
    }
    return reply.send({ success: true });
  });

  /** Save a backup to your folder now. */
  fastify.post('/me/backup/now', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    try {
      return reply.send({ success: true, file: writeProfileBackup(profileId) });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'backup_failed' });
    }
  });

  /** Your backup as a download — the way to keep one from a phone or the TV. */
  fastify.get('/me/backup/download', async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const day = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Disposition', `attachment; filename="myfitnessplan-profile-${profileId}-${day}.json"`)
      .type('application/json')
      .send(JSON.stringify(buildProfileBackup(profileId)));
  });

  /** What a backup file holds, before anything is restored from it. */
  fastify.post('/backup/inspect', { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    const checked = checkProfileBackup((request.body as { file?: unknown } | null)?.file);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    return reply.send(describeBackup(checked.backup));
  });

  /**
   * Restore a backup into your profile. The client asks first — and asks
   * harder when the backup is someone else's — so here it simply does it.
   */
  fastify.post('/me/backup/restore', { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    const profileId = requireProfile(request, reply);
    if (!profileId) return;
    const checked = checkProfileBackup((request.body as { file?: unknown } | null)?.file);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    try {
      return reply.send({ success: true, ...restoreProfileBackup(profileId, checked.backup) });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'restore_failed' });
    }
  });

  /**
   * Bring a profile back from its backup — on a new computer, or after starting
   * over. It returns under its old ID and name, so its future backups line up.
   * If that profile is already here, restore inside it instead (My profile).
   */
  fastify.post('/restore', { bodyLimit: 50 * 1024 * 1024 }, async (request, reply) => {
    const checked = checkProfileBackup((request.body as { file?: unknown } | null)?.file);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    const backup = checked.backup;
    const existing = getProfile(backup.profileId);
    if (existing) return reply.code(409).send({ error: 'profile_exists', name: existing.name });
    try {
      db.prepare('INSERT INTO profiles (id, name, avatar, setup_done) VALUES (?, ?, ?, 1)')
        .run(backup.profileId, cleanName(backup.profileName) || 'Profile', cleanAvatar(backup.avatar));
      const result = restoreProfileBackup(backup.profileId, backup);
      return reply.send({ success: true, profile: publicProfile(getProfile(backup.profileId)!), ...result });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'restore_failed' });
    }
  });

  /** Your own plans, for the "copy plans" checklist when adding someone. */
  fastify.get('/:id/plans', async (request, reply) => {
    const current = requireProfile(request, reply);
    if (!current) return;
    const { id } = request.params as { id: string };
    if (id !== current) return reply.code(403).send({ error: 'not_allowed' });
    const plans = db.prepare(`
      SELECT p.id, p.name, p.category, (SELECT COUNT(*) FROM workouts w WHERE w.plan_id = p.id) AS workout_count
      FROM workout_plans p WHERE p.profile_id = ? ORDER BY p.uploaded_at DESC
    `).all(id);
    return reply.send({ plans });
  });
}

