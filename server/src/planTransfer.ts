/**
 * Plan export / import.
 * ---------------------
 * A plan is almost entirely portable already — a name, a rhythm, and an ordered
 * list of workouts each holding an ordered list of videos. The one thing that
 * does not travel is the video IDs, which are local to one database. So the
 * export swaps each ID for a reference that still means something elsewhere:
 *
 *   YouTube video -> its provider ID, plus enough detail (title, URL, runtime,
 *                    tags) to recreate the row outright. A plan made only of
 *                    these is self-contained: whoever opens it needs nothing
 *                    beforehand, not even the playlist.
 *
 *   Local video   -> its path and filename. Meaningless on someone else's
 *                    machine, exact on your own — which is what makes the same
 *                    file a personal backup as well as something to share.
 *
 * Nothing here ever overwrites: an import only ever creates a new plan, and only
 * ever inserts videos it could not find. An existing video row — and in
 * particular the tagging on it — is reused as-is and never written to.
 */
import db from './db.js';
import { nanoid } from 'nanoid';

export const PLAN_EXPORT_FORMAT = 'myfitnessplan.plan';
export const PLAN_EXPORT_VERSION = 1;

// Defensive caps. The file comes from outside, and "a plan" that claims a
// million workouts should be rejected rather than inserted row by row.
const MAX_PLANS = 200;
const MAX_WORKOUTS_PER_PLAN = 2000;
const MAX_VIDEOS_PER_WORKOUT = 200;

export interface ExportedVideo {
  source: 'local' | string;
  /** Display name; the filename for local videos, the title for external ones. */
  title: string;
  /** Local only: where it sat under the library root. */
  relativePath?: string;
  /** External only: the provider's stable ID, and where it came from. */
  externalId?: string;
  externalUrl?: string | null;
  externalPlaylistId?: string | null;
  externalPlaylistTitle?: string | null;
  durationSeconds?: number | null;
  description?: string | null;
  equipment?: string[];
  trainingType?: string[];
  bodyParts?: string[];
  intensity?: string | null;
}

export interface ExportedWorkout {
  name: string;
  sequenceOrder: number;
  videos: ExportedVideo[];
}

export interface ExportedPlan {
  name: string;
  category: string | null;
  description: string | null;
  /** JSON array of 0/1, or null to follow the global pattern. */
  workoutPattern: number[] | null;
  backgroundBlur: number;
  workouts: ExportedWorkout[];
}

export interface PlanExportFile {
  format: string;
  version: number;
  exportedAt: string;
  appVersion: string;
  plans: ExportedPlan[];
}

function parseJsonArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

// --- Export ------------------------------------------------------------------

/** Build the portable form of one video row. */
function toExportedVideo(row: any): ExportedVideo {
  const shared = {
    title: row.filename || '',
    durationSeconds: row.duration_seconds ?? null,
    description: row.description ?? null,
    equipment: parseJsonArray(row.equipment),
    trainingType: parseJsonArray(row.training_type),
    bodyParts: parseJsonArray(row.body_parts),
    intensity: row.intensity ?? null,
  };
  if ((row.source || 'local') === 'local') {
    return { source: 'local', relativePath: row.relative_path || '', ...shared };
  }
  return {
    source: row.source,
    externalId: row.external_id || undefined,
    externalUrl: row.external_url ?? null,
    externalPlaylistId: row.external_playlist_id ?? null,
    externalPlaylistTitle: row.external_playlist_title ?? null,
    ...shared,
  };
}

/** Export every plan, or just the ones named. */
export function exportPlans(planIds: string[] | null, appVersion: string): PlanExportFile {
  const plans = (planIds && planIds.length
    ? planIds
        .map(id => db.prepare('SELECT * FROM workout_plans WHERE id = ?').get(id))
        .filter(Boolean)
    : db.prepare('SELECT * FROM workout_plans ORDER BY uploaded_at ASC').all()) as any[];

  const videoStmt = db.prepare('SELECT * FROM videos WHERE id = ?');

  return {
    format: PLAN_EXPORT_FORMAT,
    version: PLAN_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    plans: plans.map(plan => {
      const workouts = db.prepare(
        'SELECT name, sequence_order, video_ids FROM workouts WHERE plan_id = ? ORDER BY sequence_order ASC'
      ).all(plan.id) as any[];

      return {
        name: plan.name,
        category: plan.category ?? null,
        description: plan.description ?? null,
        workoutPattern: plan.workout_pattern ? JSON.parse(plan.workout_pattern) : null,
        backgroundBlur: plan.background_blur ?? 0,
        workouts: workouts.map(w => ({
          name: w.name,
          sequenceOrder: w.sequence_order,
          // A video ID that no longer resolves is dropped rather than exported
          // as a dangling reference — the plan already renders without it.
          videos: parseJsonArray(w.video_ids)
            .map(id => videoStmt.get(id))
            .filter(Boolean)
            .map(toExportedVideo),
        })),
      };
    }),
  };
}

// --- Import ------------------------------------------------------------------

export interface ResolvedVideo {
  /** An existing row this reference already points at. */
  existingId: string | null;
  /** True when the reference carries enough to create the row from scratch. */
  creatable: boolean;
  ref: ExportedVideo;
}

/**
 * Find the video a reference points at, without writing anything.
 *
 * External videos match on the provider's ID, which is exact.
 *
 * Local videos match on the full library-relative path, then on the bare
 * filename — and stop there. The fuzzy matcher the CSV import and library
 * rescan use is deliberately NOT in this path: it is built to rebind names that
 * are already nearly the same, and against a whole library it will find
 * *something* for almost any title. That is the right trade when re-binding a
 * plan you wrote yourself, and the wrong one here, where a confident mismatch
 * would quietly put a video you never chose into a plan someone sent you. An
 * empty slot is honest; the Plans page can rematch on request afterwards.
 */
export function resolveVideo(ref: ExportedVideo): ResolvedVideo {
  if ((ref.source || 'local') !== 'local') {
    if (!ref.externalId) return { existingId: null, creatable: false, ref };
    const existing = db
      .prepare('SELECT id FROM videos WHERE source = ? AND external_id = ?')
      .get(ref.source, ref.externalId) as { id: string } | undefined;
    // Nothing local is needed to make an external video real again, so an
    // unmatched one is still creatable — this is what makes a YouTube-only plan
    // work for someone who has never seen the playlist.
    return { existingId: existing?.id || null, creatable: true, ref };
  }

  const byPath = ref.relativePath
    ? (db.prepare("SELECT id FROM videos WHERE source = 'local' AND relative_path = ?").get(ref.relativePath) as { id: string } | undefined)
    : undefined;
  if (byPath) return { existingId: byPath.id, creatable: false, ref };

  const byName = db
    .prepare("SELECT id FROM videos WHERE source = 'local' AND filename = ?")
    .get(ref.title) as { id: string } | undefined;
  if (byName) return { existingId: byName.id, creatable: false, ref };

  // A local file this machine hasn't got cannot be conjured from a name.
  return { existingId: null, creatable: false, ref };
}

export interface PlanImportReport {
  name: string;
  /** The name it will actually be given, once collisions are avoided. */
  importedAs: string;
  workoutCount: number;
  videoCount: number;
  /** Already in the library. */
  matched: number;
  /** External videos that will be created on import. */
  willCreate: number;
  /** Local files this machine does not have; these slots are left out. */
  missing: number;
  /** Titles of the missing local files, for the "what won't come across" list. */
  missingTitles: string[];
  /** Playlists this plan draws on, so the import dialog can offer to add them. */
  playlists: { id: string; title: string | null }[];
}

/** Validate the outer shape of an uploaded file, or explain what's wrong. */
export function validateExportFile(data: any): { ok: true; file: PlanExportFile } | { ok: false; error: string } {
  if (!data || typeof data !== 'object') return { ok: false, error: 'not_a_plan_file' };
  if (data.format !== PLAN_EXPORT_FORMAT) return { ok: false, error: 'not_a_plan_file' };
  if (typeof data.version !== 'number' || data.version > PLAN_EXPORT_VERSION) {
    return { ok: false, error: 'newer_version' };
  }
  if (!Array.isArray(data.plans) || data.plans.length === 0) return { ok: false, error: 'no_plans' };
  if (data.plans.length > MAX_PLANS) return { ok: false, error: 'too_large' };
  for (const plan of data.plans) {
    if (!plan || typeof plan.name !== 'string' || !Array.isArray(plan.workouts)) {
      return { ok: false, error: 'not_a_plan_file' };
    }
    if (plan.workouts.length > MAX_WORKOUTS_PER_PLAN) return { ok: false, error: 'too_large' };
    for (const workout of plan.workouts) {
      if (!workout || !Array.isArray(workout.videos)) return { ok: false, error: 'not_a_plan_file' };
      if (workout.videos.length > MAX_VIDEOS_PER_WORKOUT) return { ok: false, error: 'too_large' };
    }
  }
  return { ok: true, file: data as PlanExportFile };
}

/**
 * A name nothing else is using. Imports never overwrite a plan, so a repeat
 * import lands beside the first rather than on top of it.
 */
function uniquePlanName(name: string, alsoTaken: Set<string>): string {
  const base = (name || 'Imported plan').slice(0, 200);
  const taken = (suffix: string) =>
    alsoTaken.has(suffix) ||
    Boolean(db.prepare('SELECT id FROM workout_plans WHERE name = ?').get(suffix));

  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} (${n})`.slice(0, 200);
    if (!taken(candidate)) return candidate;
  }
  return `${base} (${nanoid(6)})`.slice(0, 200);
}

/** What an import would do, without doing any of it. */
export function analyzeImport(file: PlanExportFile): PlanImportReport[] {
  const namesTaken = new Set<string>();

  return file.plans.map(plan => {
    let matched = 0;
    let willCreate = 0;
    let missing = 0;
    let videoCount = 0;
    const missingTitles: string[] = [];
    const playlists = new Map<string, string | null>();

    for (const workout of plan.workouts) {
      for (const ref of workout.videos) {
        videoCount++;
        if (ref.externalPlaylistId) playlists.set(ref.externalPlaylistId, ref.externalPlaylistTitle ?? null);
        const resolved = resolveVideo(ref);
        if (resolved.existingId) matched++;
        else if (resolved.creatable) willCreate++;
        else {
          missing++;
          if (missingTitles.length < 20) missingTitles.push(ref.title);
        }
      }
    }

    const importedAs = uniquePlanName(plan.name, namesTaken);
    namesTaken.add(importedAs);

    return {
      name: plan.name,
      importedAs,
      workoutCount: plan.workouts.length,
      videoCount,
      matched,
      willCreate,
      missing,
      missingTitles,
      playlists: [...playlists].map(([id, title]) => ({ id, title })),
    };
  });
}

/**
 * Create the plans. Additive throughout: new plan rows, new workout rows, and
 * new video rows only for external references nothing already covers. No
 * existing row is updated, so tagging you have already corrected stays yours.
 */
export function importPlans(file: PlanExportFile): { reports: PlanImportReport[]; planIds: string[] } {
  const reports = analyzeImport(file);
  const planIds: string[] = [];
  const today = new Date().toISOString().split('T')[0];

  const insertVideo = db.prepare(`
    INSERT INTO videos
      (id, filename, filepath, relative_path, duration_seconds, description,
       equipment, training_type, body_parts, intensity,
       source, external_id, external_url, external_playlist_id, external_playlist_title)
    VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPlan = db.prepare(`
    INSERT INTO workout_plans
      (id, name, is_active, start_date, category, description, background_blur, workout_pattern)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?)
  `);
  const insertWorkout = db.prepare(
    'INSERT INTO workouts (id, plan_id, name, sequence_order, video_ids) VALUES (?, ?, ?, ?, ?)'
  );

  db.transaction(() => {
    file.plans.forEach((plan, planIndex) => {
      const planId = nanoid();
      planIds.push(planId);
      insertPlan.run(
        planId,
        reports[planIndex].importedAs,
        // An imported plan starts today and inactive: it is something to look
        // at and activate deliberately, not something that silently takes over
        // a slot the moment the file is opened.
        today,
        plan.category ?? null,
        plan.description ?? null,
        plan.backgroundBlur ?? 0,
        Array.isArray(plan.workoutPattern) ? JSON.stringify(plan.workoutPattern) : null
      );

      plan.workouts.forEach((workout, index) => {
        const ids: string[] = [];
        for (const ref of workout.videos) {
          const resolved = resolveVideo(ref);
          if (resolved.existingId) {
            ids.push(resolved.existingId);
            continue;
          }
          if (!resolved.creatable) continue; // a local file this machine hasn't got

          const videoId = nanoid();
          insertVideo.run(
            videoId,
            ref.title,
            ref.durationSeconds ?? null,
            ref.description ?? null,
            JSON.stringify(ref.equipment || []),
            JSON.stringify(ref.trainingType || []),
            JSON.stringify(ref.bodyParts || []),
            ref.intensity ?? null,
            ref.source,
            ref.externalId ?? null,
            ref.externalUrl ?? null,
            ref.externalPlaylistId ?? null,
            ref.externalPlaylistTitle ?? null
          );
          ids.push(videoId);
        }
        insertWorkout.run(
          nanoid(),
          planId,
          workout.name,
          typeof workout.sequenceOrder === 'number' ? workout.sequenceOrder : index,
          JSON.stringify(ids)
        );
      });
    });
  })();

  return { reports, planIds };
}
