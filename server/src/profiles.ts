import crypto from 'crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import db, { PER_PROFILE_SETTINGS } from './db.js';

/**
 * Who a request is from.
 *
 * Each device remembers its profile in a signed cookie, so a phone can stay
 * "you" while the TV is someone else, with no logins. The signature covers the
 * profile's token version, which changes with its PIN: setting or changing a
 * PIN signs every other device out of that profile.
 *
 * An install with a single profile and no PIN needs no cookie at all — every
 * request is that profile. That keeps a one-person setup (and any device that
 * has never picked a profile) working exactly as before profiles existed.
 */

export interface ProfileRow {
  id: string;
  name: string;
  avatar: string;
  pin_hash: string | null;
  token_version: number;
  setup_done: number;
  created_at: string;
}

const COOKIE = 'mfp_profile';
const TEN_YEARS = 10 * 365 * 24 * 60 * 60;

/** Server secret the cookies are signed with, made once and kept in settings. */
function secret(): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'profile_secret'").get() as { value: string } | undefined;
  if (row?.value) return row.value;
  const value = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('profile_secret', ?)").run(value);
  return value;
}

function sign(id: string, version: number): string {
  return crypto.createHmac('sha256', secret()).update(`${id}.${version}`).digest('base64url');
}

function readCookie(request: FastifyRequest): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setProfileCookie(reply: FastifyReply, profile: ProfileRow): void {
  const value = `${profile.id}.${profile.token_version}.${sign(profile.id, profile.token_version)}`;
  reply.header('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${TEN_YEARS}; HttpOnly; SameSite=Lax`);
}

export function clearProfileCookie(reply: FastifyReply): void {
  reply.header('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export function getProfile(id: string): ProfileRow | undefined {
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
}

export function listProfiles(): ProfileRow[] {
  return db.prepare('SELECT * FROM profiles ORDER BY created_at ASC, rowid ASC').all() as ProfileRow[];
}

/** The profile this request belongs to, or null when the device has to pick one. */
export function currentProfileId(request: FastifyRequest): string | null {
  const raw = readCookie(request);
  if (raw) {
    const [id, version, signature] = raw.split('.');
    const profile = id ? getProfile(id) : undefined;
    if (profile && String(profile.token_version) === version && signature) {
      const expected = Buffer.from(sign(profile.id, profile.token_version));
      const given = Buffer.from(signature);
      if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return profile.id;
    }
  }
  const all = listProfiles();
  if (all.length === 1 && !all[0].pin_hash) return all[0].id;
  return null;
}

/**
 * The request's profile, or a 401 the client answers by showing the profile
 * picker. Handlers return straight away when this gives null.
 */
export function requireProfile(request: FastifyRequest, reply: FastifyReply): string | null {
  const id = currentProfileId(request);
  if (!id) {
    reply.code(401).header('X-Profile-Required', '1').send({ error: 'profile_required' });
    return null;
  }
  return id;
}

/**
 * Whether the request comes from the computer running the server. Resetting a
 * forgotten PIN is allowed only there: whoever has that computer has the data
 * file anyway, so a PIN can't keep them out — but it does stop someone on
 * another phone or the TV from removing yours.
 */
export function isLocalRequest(request: FastifyRequest): boolean {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

// --- Per-profile settings ---------------------------------------------------

const PROFILE_KEYS = new Set<string>(PER_PROFILE_SETTINGS);

export function isProfileSetting(key: string): boolean {
  return PROFILE_KEYS.has(key);
}

/** A profile's value for a per-profile setting, else the install-wide default. */
export function getProfileSetting(profileId: string, key: string): string | null {
  const own = db.prepare('SELECT value FROM profile_settings WHERE profile_id = ? AND key = ?').get(profileId, key) as
    | { value: string | null }
    | undefined;
  if (own) return own.value;
  const shared = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return shared?.value ?? null;
}

export function setProfileSetting(profileId: string, key: string, value: string | null): void {
  db.prepare(`
    INSERT INTO profile_settings (profile_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(profile_id, key) DO UPDATE SET value = excluded.value
  `).run(profileId, key, value);
}

// --- A profile's videos ---------------------------------------------------------

const videoColumns = (db.pragma("table_info('videos')") as { name: string }[])
  .map(c => c.name)
  .filter(name => name !== 'relative_path' && name !== 'is_favorite');

/**
 * The videos in one profile's library, shaped exactly like the `videos` table —
 * except that `relative_path` and `is_favorite` are that profile's own. Use it
 * in place of `videos` in a FROM clause; it takes the profile id as its first
 * positional parameter:
 *
 *   db.prepare(`SELECT ... FROM ${PROFILE_VIDEOS} AS videos WHERE id = ?`).get(profileId, id)
 */
export const PROFILE_VIDEOS = `(
  SELECT ${videoColumns.map(c => `v.${c}`).join(', ')}, pv.relative_path AS relative_path, pv.is_favorite AS is_favorite,
    pv.in_library AS in_library
  FROM videos v JOIN profile_videos pv ON pv.video_id = v.id
  WHERE pv.profile_id = ?
)`;

/** Whether a plan belongs to the profile — every plan route checks this first. */
export function ownsPlan(profileId: string, planId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM workout_plans WHERE id = ? AND profile_id = ?').get(planId, profileId));
}

/** Whether a workout (a plan's day) belongs to the profile. */
export function ownsWorkout(profileId: string, workoutId: string): boolean {
  return Boolean(db.prepare(`
    SELECT 1 FROM workouts w JOIN workout_plans p ON p.id = w.plan_id
    WHERE w.id = ? AND p.profile_id = ?
  `).get(workoutId, profileId));
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `profileHook` on routes that belong to a profile. */
    profileId: string;
  }
}

/**
 * preHandler for a whole group of routes: every request in it must come from a
 * profile (else the client is told to show the picker), and `request.profileId`
 * says which.
 */
export async function profileHook(request: FastifyRequest, reply: FastifyReply) {
  const id = currentProfileId(request);
  if (!id) {
    reply.code(401).header('X-Profile-Required', '1').send({ error: 'profile_required' });
    return reply;
  }
  request.profileId = id;
}
