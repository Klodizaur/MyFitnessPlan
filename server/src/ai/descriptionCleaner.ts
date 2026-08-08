/**
 * Strip the clutter out of video descriptions.
 *
 * Imported descriptions arrive full of sponsor copy, affiliate links, social
 * handles and cross-promotion for unrelated videos; hand-pasted ones tend to
 * carry whatever came with them. What's left after removing that is usually one
 * or two useful sentences about the workout.
 *
 * Only ever touches the description text. Tags — equipment, training type, body
 * parts, intensity — are never read or written here.
 */
import db from '../db.js';
import { callModel, AiError } from './provider.js';
import { DESCRIPTION_LANGUAGE_NAMES, getAiSettings } from './settings.js';

/**
 * How many descriptions go in one request.
 *
 * Small enough that a confused reply loses six videos rather than sixty, large
 * enough that a 130-video album isn't 130 round trips.
 */
const BATCH_SIZE = 6;

/** Descriptions longer than this are truncated before being sent. */
const MAX_INPUT_CHARS = 4000;

/**
 * The instruction set, built per call because the language rule depends on a
 * setting: by default the original language is preserved, but a chosen target
 * language turns clean-up into a translation as well.
 */
function systemPrompt(): string {
  const target = getAiSettings().descriptionLanguage;
  const languageRule = target
    ? `- Write the result in ${DESCRIPTION_LANGUAGE_NAMES[target]}, translating it when the original is in another language.`
    : '- Keep the original language. Do not translate.';

  return `You clean up workout video descriptions.

Remove: URLs and links, social media handles and "follow me" lines, sponsor and affiliate copy, discount codes, subscribe/like/comment requests, timestamps and chapter lists, hashtags, email addresses, cross-promotion for other videos or channels, copyright and music credits, and repeated boilerplate.

Keep: what the workout actually is — its focus, length, intensity, equipment, structure, and any genuine instruction or warning from the creator.

Rules:
${languageRule}
- Keep the creator's own wording where it survives. Rewrite only to join up what's left into readable sentences.
- Do not invent anything that is not in the original.
- If nothing useful remains, return an empty string for that video.
- Aim for one to three sentences.`;
}

/** Clean a single description. Used by the editor, which previews the result. */
export async function cleanDescription(text: string): Promise<string> {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';

  const reply = await callModel({
    system: systemPrompt(),
    user:
      'Clean this description. Reply with the cleaned text only — no preamble, ' +
      'no quotes, no explanation.\n\n' +
      trimmed.slice(0, MAX_INPUT_CHARS),
  });

  return tidy(reply);
}

// ---------------------------------------------------------------------------
// Bulk job
// ---------------------------------------------------------------------------

export interface CleanJob {
  /** Identifies this run so the client can tell a new job from a finished one. */
  id: string;
  label: string;
  total: number;
  done: number;
  /** Videos whose description came back unusable and were left untouched. */
  failed: number;
  /** Videos rewritten. Lower than `done` when a description had nothing to cut. */
  changed: number;
  running: boolean;
  cancelled: boolean;
  /** Set when the run stopped early — a bad key, an unreachable endpoint. */
  error: string | null;
}

/**
 * One job at a time, held in memory.
 *
 * A cleanup run is cheap to restart and worthless to resume — if the server
 * stops mid-run, the descriptions already rewritten are saved and the rest can
 * be re-run — so this deliberately doesn't persist.
 */
let job: CleanJob | null = null;

export function getCleanJob(): CleanJob | null {
  return job;
}

export function cancelCleanJob(): void {
  if (job?.running) job.cancelled = true;
}

/** Clears a finished job so the progress panel can be dismissed. */
export function dismissCleanJob(): void {
  if (job && !job.running) job = null;
}

const selectStmt = db.prepare('SELECT id, description FROM videos WHERE id = ?');
const updateStmt = db.prepare('UPDATE videos SET description = ? WHERE id = ?');

/**
 * Start cleaning the given videos in the background.
 *
 * Returns immediately; the client polls `getCleanJob()` through the status
 * route. Videos with no description are skipped without spending a request.
 */
export function startCleanJob(videoIds: string[], label: string): CleanJob {
  if (job?.running) throw new AiError('A clean-up is already running.', 'job_running');

  const pending = videoIds
    .map(id => selectStmt.get(id) as { id: string; description: string | null } | undefined)
    .filter((row): row is { id: string; description: string } =>
      Boolean(row && row.description && row.description.trim())
    );

  job = {
    id: `${Date.now()}`,
    label,
    total: pending.length,
    done: 0,
    failed: 0,
    changed: 0,
    running: pending.length > 0,
    cancelled: false,
    error: null,
  };

  if (pending.length > 0) void run(pending, job);
  return job;
}

async function run(
  pending: { id: string; description: string }[],
  current: CleanJob
): Promise<void> {
  try {
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      if (current.cancelled) break;
      const batch = pending.slice(i, i + BATCH_SIZE);

      let cleaned: Map<string, string>;
      try {
        cleaned = await cleanBatch(batch);
      } catch (err) {
        // A key or endpoint problem will fail every remaining batch too, so
        // stop rather than burning through the album repeating it.
        if (err instanceof AiError && STOP_CODES.has(err.code)) {
          current.error = err.message;
          break;
        }
        // One bad batch shouldn't end the run.
        current.failed += batch.length;
        current.done += batch.length;
        continue;
      }

      for (const video of batch) {
        const next = cleaned.get(video.id);
        if (next === undefined) {
          current.failed += 1;
        } else if (next !== video.description) {
          updateStmt.run(next, video.id);
          current.changed += 1;
        }
        current.done += 1;
      }
    }
  } finally {
    current.running = false;
  }
}

/** Errors that will recur on every batch, so the run should stop. */
const STOP_CODES = new Set(['auth', 'not_configured', 'unreachable', 'not_found']);

/**
 * Clean a batch in one request.
 *
 * Ids go out and must come back, so a reply that drops or invents an entry
 * leaves those videos untouched rather than writing the wrong text to the
 * wrong video.
 */
async function cleanBatch(
  batch: { id: string; description: string }[]
): Promise<Map<string, string>> {
  const payload = batch.map(video => ({
    id: video.id,
    description: video.description.slice(0, MAX_INPUT_CHARS),
  }));

  const reply = await callModel({
    system: systemPrompt(),
    user:
      'Clean each description below. Reply with JSON only, no code fences, in ' +
      'exactly this shape, using the same ids:\n' +
      '{"results":[{"id":"...","description":"cleaned text"}]}\n\n' +
      JSON.stringify(payload),
  });

  const parsed = parseJson(reply);
  const results = Array.isArray(parsed?.results) ? parsed.results : [];
  const known = new Set(batch.map(video => video.id));
  const cleaned = new Map<string, string>();

  for (const entry of results) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (!known.has(id) || cleaned.has(id)) continue;
    if (typeof entry?.description !== 'string') continue;
    cleaned.set(id, tidy(entry.description));
  }
  return cleaned;
}

function parseJson(raw: string): any {
  const withoutFence = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  const slice = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
  try {
    return JSON.parse(slice);
  } catch {
    throw new AiError('The model did not return usable text.', 'unparsable');
  }
}

/** Strip wrapping quotes and collapse the blank lines models like to add. */
function tidy(text: string): string {
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
