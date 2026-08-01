import { FastifyInstance } from 'fastify';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import db from '../db.js';
import { FastifyBaseLogger } from 'fastify';
import { importAvailable, PlaylistResolveError, PlaylistResolver, resolverFor } from '../external/index.js';
import { formatVideoRow, VIDEO_COLUMNS } from './library.js';
import { autoTagFromTitle } from '../autoTag.js';

const THUMB_DIR = path.join(process.cwd(), 'data', 'thumbnails');

/** A thumbnail is a small JPEG; anything larger is not what we asked for. */
const MAX_THUMB_BYTES = 5 * 1024 * 1024;
const THUMB_TIMEOUT_MS = 15_000;

/**
 * Download a provider thumbnail into data/thumbnails as `<videoId>.jpg`.
 *
 * Storing it locally rather than hotlinking means every existing
 * `/thumbnails/${thumbnail_path}` render site works unchanged, and browsing the
 * library still shows covers when offline. Returns null on any failure — a
 * missing thumbnail is cosmetic and must not fail the import.
 */
async function downloadThumbnail(url: string, videoId: string): Promise<string | null> {
  const filename = `${videoId}.jpg`;
  const dest = path.join(THUMB_DIR, filename);
  if (fs.existsSync(dest)) return filename;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(THUMB_TIMEOUT_MS) });
    if (!res.ok) return null;

    const type = res.headers.get('content-type') || '';
    if (!type.startsWith('image/')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_THUMB_BYTES) return null;

    fs.mkdirSync(THUMB_DIR, { recursive: true });
    fs.writeFileSync(dest, buffer);
    return filename;
  } catch {
    return null;
  }
}

/** True while the description worker is draining. See {@link enrichDescriptions}. */
let enriching = false;

/** Videos looked up per round trip to the resolver. */
const ENRICH_BATCH = 20;

/**
 * Fill in descriptions after an import has already returned.
 *
 * Descriptions need a full extraction per video — minutes for a large playlist
 * — so making the user wait for them is not an option. This runs detached and
 * updates rows as they arrive; the UI picks them up on its next load.
 *
 * NULL vs empty string matters here: NULL means "never looked up", '' means
 * "looked up, YouTube had nothing". Writing '' for every video we attempted is
 * what stops the backfill re-querying the same duds on every launch. Rows the
 * user has typed into are non-empty and are never touched.
 *
 * @param playlistId Restrict to one playlist, or omit to sweep every external
 *   video that has never been looked up — including ones imported before
 *   playlists were tracked, which no per-playlist run would ever reach.
 */
function enrichDescriptions(resolver: PlaylistResolver, log: FastifyBaseLogger): void {
  // One worker, draining a queue — not one job per playlist. An import that
  // lands while the worker is busy needs no job of its own: the loop re-queries
  // every round, so it picks the new rows up before it finishes. Starting a
  // second job here instead would mean either running two slow jobs at once or
  // dropping the newer one entirely.
  if (enriching) return;
  enriching = true;

  const selectPending = db.prepare(
    "SELECT external_id FROM videos WHERE source <> 'local' AND external_id IS NOT NULL AND description IS NULL LIMIT ?"
  );
  const update = db.prepare(
    'UPDATE videos SET description = ? WHERE external_id = ? AND source = ? AND description IS NULL'
  );

  void (async () => {
    let filled = 0;
    try {
      while (true) {
        const pending = selectPending.all(ENRICH_BATCH) as { external_id: string }[];
        if (pending.length === 0) break;

        const ids = pending.map(v => v.external_id);
        const descriptions = await resolver.fetchDescriptions(ids);

        // Nothing at all came back. That reads far more like being offline or
        // yt-dlp being blocked than like every video genuinely having no
        // description, so stop and leave the rows NULL for a later run —
        // marking them now would make the emptiness permanent.
        if (descriptions.size === 0) {
          log.warn('[external] no descriptions returned; leaving the rest to be retried');
          break;
        }

        db.transaction(() => {
          // Every attempted ID is written, using '' for the ones that really
          // have no description, so they aren't looked up again every launch.
          for (const id of ids) {
            update.run(descriptions.get(id) || '', id, resolver.source);
          }
        })();
        filled += descriptions.size;
      }
      if (filled > 0) log.info(`[external] filled in ${filled} description(s)`);
    } catch (err) {
      log.warn({ err }, '[external] description fetch failed');
    } finally {
      enriching = false;
    }
  })();
}

/**
 * Tag imported videos that predate auto-tagging, once.
 *
 * Runs a single time rather than on every launch, tracked by a settings flag:
 * without that, a user who deliberately cleared a video's tags would find them
 * silently restored on the next start. Purely local string matching, so it's
 * instant and needs no network.
 */
function backfillAutoTags(log: FastifyBaseLogger): void {
  const FLAG = 'autotag_backfill_done';
  const done = db.prepare('SELECT value FROM settings WHERE key = ?').get(FLAG) as
    { value: string } | undefined;
  if (done?.value === '1') return;

  // Only videos with nothing set at all — never a partially tagged one.
  const untagged = db.prepare(`
    SELECT id, filename FROM videos
    WHERE source <> 'local'
      AND COALESCE(equipment, '[]') IN ('[]', '')
      AND COALESCE(training_type, '[]') IN ('[]', '')
      AND COALESCE(body_parts, '[]') IN ('[]', '')
      AND COALESCE(intensity, '') = ''
  `).all() as { id: string; filename: string }[];

  const update = db.prepare(
    'UPDATE videos SET equipment = ?, training_type = ?, body_parts = ?, intensity = ? WHERE id = ?'
  );

  let tagged = 0;
  db.transaction(() => {
    for (const video of untagged) {
      const tags = autoTagFromTitle(video.filename);
      const found = tags.equipment.length + tags.training_type.length + tags.body_parts.length;
      if (found === 0 && !tags.intensity) continue;
      update.run(
        JSON.stringify(tags.equipment), JSON.stringify(tags.training_type),
        JSON.stringify(tags.body_parts), tags.intensity, video.id
      );
      tagged++;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FLAG, '1');
  })();

  if (tagged > 0) log.info(`[external] auto-tagged ${tagged} previously imported video(s)`);
}

export default async function (fastify: FastifyInstance) {
  /**
   * Whether importing is possible at all. The client hides its import entry
   * points when this is false, which is what makes the whole feature degrade
   * quietly if the resolver is ever removed (see server/src/external/index.ts).
   */
  fastify.get('/status', async (_request, reply) => {
    return reply.send({ available: await importAvailable() });
  });

  /**
   * How many imported videos are still waiting on a description. The client
   * polls this after an import so descriptions appear as they land instead of
   * only after a manual reload.
   */
  fastify.get('/descriptions-status', async (_request, reply) => {
    const pending = (db.prepare(
      "SELECT COUNT(*) AS c FROM videos WHERE source <> 'local' AND external_id IS NOT NULL AND description IS NULL"
    ).get() as { c: number }).c;
    return reply.send({ pending, running: enriching });
  });

  /**
   * Look up descriptions for every imported video that has never had one
   * fetched. Safe to call repeatedly: already-attempted videos are skipped, and
   * a run already in progress just keeps going.
   */
  fastify.post('/backfill-descriptions', async (request, reply) => {
    const pending = (db.prepare(
      "SELECT COUNT(*) AS c FROM videos WHERE source <> 'local' AND external_id IS NOT NULL AND description IS NULL"
    ).get() as { c: number }).c;

    if (pending === 0) return reply.send({ success: true, pending: 0 });

    // Any registered resolver can do the lookup; they all target the same
    // provider set. Pick the one that owns these rows.
    const resolver = resolverFor('https://www.youtube.com/');
    if (!resolver) {
      return reply.code(503).send({ error: 'Import is not available', code: 'unavailable' });
    }

    enrichDescriptions(resolver, request.log);
    return reply.send({ success: true, pending });
  });

  fastify.post('/import', async (request, reply) => {
    const { url } = request.body as { url?: string };
    const trimmed = typeof url === 'string' ? url.trim() : '';
    if (!trimmed) {
      return reply.code(400).send({ error: 'A playlist link is required', code: 'unsupported_url' });
    }

    const resolver = resolverFor(trimmed);
    if (!resolver) {
      return reply.code(400).send({ error: 'That link is not supported', code: 'unsupported_url' });
    }

    let playlist;
    try {
      playlist = await resolver.resolve(trimmed);
    } catch (err) {
      if (err instanceof PlaylistResolveError) {
        const status = err.code === 'unavailable' ? 503 : err.code === 'not_found' ? 404 : 400;
        return reply.code(status).send({ error: err.message, code: err.code });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'Import failed', code: 'failed' });
    }

    const selectExisting = db.prepare(
      'SELECT id, thumbnail_path FROM videos WHERE source = ? AND external_id = ?'
    );

    // Thumbnails are fetched outside the write transaction: better-sqlite3 is
    // synchronous, so awaiting inside a transaction would hold it open across
    // network I/O.
    const prepared: Array<{
      id: string;
      isNew: boolean;
      thumbnailPath: string | null;
      title: string;
      videoUrl: string;
      durationSeconds: number | null;
      externalId: string;
    }> = [];

    for (const item of playlist.items) {
      const existing = selectExisting.get(resolver.source, item.externalId) as
        { id: string; thumbnail_path: string | null } | undefined;

      const id = existing?.id || nanoid();
      const thumbnailPath = existing?.thumbnail_path
        || (item.thumbnailUrl ? await downloadThumbnail(item.thumbnailUrl, id) : null);

      prepared.push({
        id,
        isNew: !existing,
        thumbnailPath,
        title: item.title,
        videoUrl: item.url,
        durationSeconds: item.durationSeconds,
        externalId: item.externalId,
      });
    }

    const insertStmt = db.prepare(`
      INSERT INTO videos
        (id, filename, filepath, relative_path, thumbnail_path, duration_seconds,
         source, external_id, external_url, external_playlist_id, external_playlist_title,
         equipment, training_type, body_parts, intensity)
      VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Refresh provider-owned fields on re-import. User-owned metadata
    // (description, equipment, training_type, body_parts, intensity) is
    // deliberately untouched so re-importing a playlist never wipes tagging.
    const updateStmt = db.prepare(
      'UPDATE videos SET filename = ?, thumbnail_path = ?, duration_seconds = ?, external_url = ?, external_playlist_id = ? WHERE id = ?'
    );

    // An album the user already renamed keeps its name across re-imports —
    // otherwise every refresh would undo their edit.
    const existingAlbumTitle = (db.prepare(
      'SELECT external_playlist_title FROM videos WHERE external_playlist_id = ? AND external_playlist_title IS NOT NULL LIMIT 1'
    ).get(playlist.playlistId) as { external_playlist_title?: string } | undefined)?.external_playlist_title;
    const albumTitle = existingAlbumTitle || playlist.title;

    db.transaction(() => {
      for (const row of prepared) {
        if (row.isNew) {
          // Seeded from the title so a freshly imported playlist isn't a wall of
          // untagged videos. Only ever applied to new rows, so re-importing
          // never overwrites tagging the user has since corrected.
          const tags = autoTagFromTitle(row.title);
          insertStmt.run(
            row.id, row.title, row.videoUrl, row.thumbnailPath, row.durationSeconds,
            resolver.source, row.externalId, row.videoUrl, playlist.playlistId, albumTitle,
            JSON.stringify(tags.equipment), JSON.stringify(tags.training_type),
            JSON.stringify(tags.body_parts), tags.intensity
          );
        } else {
          updateStmt.run(
            row.title, row.thumbnailPath, row.durationSeconds, row.videoUrl,
            playlist.playlistId, row.id
          );
        }
      }
      // Applied to the whole album so re-imported rows adopt the current name.
      db.prepare(
        'UPDATE videos SET external_playlist_title = ? WHERE external_playlist_id = ?'
      ).run(albumTitle, playlist.playlistId);
    })();

    const ids = prepared.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT ${VIDEO_COLUMNS} FROM videos WHERE id IN (${placeholders})`
    ).all(...ids) as any[];

    // Preserve playlist order, which the DB query does not guarantee.
    const byId = new Map(rows.map(r => [r.id, r]));
    const videos = ids.map(id => byId.get(id)).filter(Boolean).map(formatVideoRow);

    // Detached on purpose: the response must not wait on it. If the worker is
    // already running it will pick these rows up on its own.
    enrichDescriptions(resolver, request.log);

    return reply.send({
      success: true,
      playlistId: playlist.playlistId,
      playlistTitle: albumTitle,
      truncated: playlist.truncated,
      importedCount: prepared.filter(r => r.isNew).length,
      totalCount: videos.length,
      videos,
    });
  });

  /** Rename an imported album. Grouping is by playlist ID, so this is display-only. */
  fastify.patch('/playlist/:playlistId', async (request, reply) => {
    const { playlistId } = request.params as { playlistId: string };
    const { title } = request.body as { title?: string };

    const trimmed = typeof title === 'string' ? title.trim().slice(0, 120) : '';
    if (!trimmed) {
      return reply.code(400).send({ error: 'A name is required' });
    }

    const result = db.prepare(
      'UPDATE videos SET external_playlist_title = ? WHERE external_playlist_id = ?'
    ).run(trimmed, playlistId);

    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Playlist not found' });
    }

    return reply.send({ success: true, playlistId, title: trimmed });
  });

  /**
   * Remove an imported album and every video in it.
   *
   * Plans may still reference these videos. Their IDs are left in
   * `workouts.video_ids`, which the schedule already tolerates — it drops IDs
   * with no matching row — so a plan loses those entries rather than breaking.
   * The response reports how many plans were affected so the client can warn
   * before deleting.
   */
  fastify.delete('/playlist/:playlistId', async (request, reply) => {
    const { playlistId } = request.params as { playlistId: string };

    const videos = db.prepare(
      'SELECT id, thumbnail_path FROM videos WHERE external_playlist_id = ?'
    ).all(playlistId) as { id: string; thumbnail_path: string | null }[];

    if (videos.length === 0) {
      return reply.code(404).send({ error: 'Playlist not found' });
    }

    db.prepare('DELETE FROM videos WHERE external_playlist_id = ?').run(playlistId);

    // Thumbnails were downloaded by this app and belong to nothing else.
    for (const video of videos) {
      if (!video.thumbnail_path) continue;
      try {
        fs.unlinkSync(path.join(THUMB_DIR, video.thumbnail_path));
      } catch {
        // Already gone, or never written — nothing to clean up.
      }
    }

    return reply.send({ success: true, deletedCount: videos.length });
  });

  /**
   * How many plan workouts reference videos from this album. Lets the client
   * warn before a delete that would empty out part of a plan.
   */
  fastify.get('/playlist/:playlistId/usage', async (request, reply) => {
    const { playlistId } = request.params as { playlistId: string };

    const ids = new Set(
      (db.prepare('SELECT id FROM videos WHERE external_playlist_id = ?').all(playlistId) as { id: string }[])
        .map(v => v.id)
    );

    const workouts = db.prepare('SELECT plan_id, video_ids FROM workouts').all() as
      { plan_id: string; video_ids: string | null }[];

    const affectedPlans = new Set<string>();
    for (const workout of workouts) {
      let videoIds: string[] = [];
      try {
        const parsed = JSON.parse(workout.video_ids || '[]');
        if (Array.isArray(parsed)) videoIds = parsed;
      } catch {}
      if (videoIds.some(id => ids.has(id))) affectedPlans.add(workout.plan_id);
    }

    return reply.send({ videoCount: ids.size, planCount: affectedPlans.size });
  });

  backfillAutoTags(fastify.log);

  // Sweep on startup, so imports made before descriptions were fetched (or
  // while offline) fill themselves in without the user having to ask. Delayed
  // so it never competes with serving the first page, and cheap on later
  // launches because attempted videos are recorded and skipped.
  const startupResolver = resolverFor('https://www.youtube.com/');
  if (startupResolver) {
    const timer = setTimeout(() => enrichDescriptions(startupResolver, fastify.log), 5_000);
    // Don't hold the process open just for this.
    timer.unref?.();
  }
}
