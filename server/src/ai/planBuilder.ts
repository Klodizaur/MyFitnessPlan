/**
 * Turn a described goal plus a shortlist of videos into a draft plan.
 *
 * The result is a suggestion, not a saved plan: it goes back to the client in
 * the same shape the manual workout builder already holds in state, the user
 * reviews and edits it there, and the existing save path stores it. Nothing
 * here writes to the database.
 */
import { callModel, AiError } from './provider.js';
import { Candidate, CandidateSet, CandidateFilter, selectCandidates } from './candidates.js';

/** One day of a drafted plan. An empty list is a rest day. */
export interface DraftDay {
  videoIds: string[];
}

export interface DraftWeek {
  days: DraftDay[];
}

export interface DraftPlan {
  summary: string;
  weeks: DraftWeek[];
  /** Ids the model returned that aren't in the library, after validation. */
  droppedIds: string[];
  /** How many library videos were eligible, and whether the list was capped. */
  candidateCount: number;
  truncated: boolean;
}

export interface GenerateRequest extends CandidateFilter {
  description: string;
  weeks: number;
  daysPerWeek: number;
}

/** The builder models a week as seven day slots; rest days are simply empty. */
const DAYS_PER_WEEK = 7;
const MAX_WEEKS = 12;

/**
 * The coaching brief.
 *
 * Left to itself a model will happily schedule high-intensity work seven days
 * running, stack three long sessions into one evening, or open week one with
 * the hardest thing in the library. The rules below are the ordinary
 * programming judgement a trainer would apply — recovery between hard days,
 * short videos as components and long ones as whole sessions, a gradual ramp —
 * stated explicitly because that is the only way it reliably survives into the
 * output.
 *
 * Scope is deliberately narrow: arranging videos the person already owns. It
 * does not assess anyone, and it treats a stated limitation as a hard rule
 * rather than something to reason around.
 */
const SYSTEM_PROMPT = `You are an experienced personal trainer building a home workout plan for one person, using only a fixed catalogue of workout videos they already own.

You arrange the training they have. You do not assess anyone's health, diagnose anything, or work around an injury beyond respecting what the person tells you about it.

CHOOSING VIDEOS
- Only ever use ids that appear in the catalogue. Never invent an id, and never use a title in place of an id.
- Each entry lists its length in minutes and whatever tags exist. Many videos are untagged: infer what you can from the title and length, and never assume an untagged video is easy.

BUILDING A DAY
- Add up the listed minutes. A day should land near the requested session length, not far over it.
- Short videos (roughly under 15 minutes) are components. Combine them into one session: a warm-up, one or two main blocks, then a stretch or cool-down.
- A long video (roughly 30 minutes or more) is a complete session on its own — it almost always contains its own warm-up and cool-down. Never put two long videos on the same day, and do not bolt extra work onto one. After a hard long session you may add a short stretch or cool-down, nothing more.
- Never put more than four videos in one day.

BUILDING A WEEK
- Respect the requested number of training days. Every other day is a rest day and must be left empty. Rest is part of the plan, not a gap in it.
- Hard work needs recovery. Do not schedule high-intensity sessions (HIIT, hard cardio, heavy strength) on consecutive days, and use at most two or three in a week.
- Do not train the same body part hard on back-to-back days. Alternate the emphasis.
- Use the breadth of the catalogue. Do not repeat a video within the same week unless the catalogue is too small to avoid it, and never on consecutive days.
- In any week with four or more training days, make at least one of them deliberately easy — mobility, stretching, or low intensity.

ACROSS WEEKS
- Build gradually. Do not open week one with the hardest sessions available.
- Increase volume or intensity a little at a time, and not both in the same week.
- In a plan of four weeks or more, make roughly every fourth week lighter to allow recovery.

CONSTRAINTS
- Equipment, album and length limits are already applied — everything in the catalogue is allowed.
- Style, body-part and intensity notes are preferences: follow them where the catalogue allows, use judgement where it does not.
- Anything the person states as a limitation — no jumping, quiet for neighbours, a sore knee, period-friendly — is a hard rule. If the catalogue cannot honour it, leave that day lighter or empty rather than breaking it.

Reply with JSON only, no prose and no code fences, in exactly this shape:
{"summary":"one or two sentences on the structure you chose","weeks":[{"days":[{"videoIds":["id1","id2"]},{"videoIds":[]}]}]}`;

export async function generatePlan(request: GenerateRequest): Promise<DraftPlan> {
  const weeks = clamp(Math.round(request.weeks) || 1, 1, MAX_WEEKS);
  const daysPerWeek = clamp(Math.round(request.daysPerWeek) || 3, 1, DAYS_PER_WEEK);

  const candidateSet = selectCandidates(request);
  if (candidateSet.candidates.length === 0) {
    throw new AiError(
      'No videos in your library match those constraints. Try allowing more equipment, more albums, or a longer session.',
      'no_candidates'
    );
  }

  const raw = await callModel({
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(request, weeks, daysPerWeek, candidateSet),
  });

  const parsed = parseJsonReply(raw);
  const known = new Set(candidateSet.candidates.map(c => c.id));
  const { draftWeeks, droppedIds } = validateWeeks(parsed?.weeks, weeks, known);

  if (draftWeeks.every(week => week.days.every(day => day.videoIds.length === 0))) {
    throw new AiError(
      'The model did not pick any videos from your library. Try again, or check that the model name is right.',
      'empty_plan'
    );
  }

  return {
    summary: typeof parsed?.summary === 'string' ? parsed.summary.trim().slice(0, 500) : '',
    weeks: draftWeeks,
    droppedIds,
    candidateCount: candidateSet.candidates.length,
    truncated: candidateSet.truncated,
  };
}

function buildUserPrompt(
  request: GenerateRequest,
  weeks: number,
  daysPerWeek: number,
  candidateSet: CandidateSet
): string {
  const lines: string[] = [];

  lines.push(`Plan length: ${weeks} week(s), ${daysPerWeek} training day(s) per week.`);
  if (request.maxMinutes > 0) {
    // Worth stating: the catalogue was already filtered to fit, so the model
    // should be budgeting a day's total rather than re-checking each video.
    lines.push(
      `Target session length: about ${request.maxMinutes} minutes. ` +
      'No single video in the catalogue is longer than that, so combine short ' +
      'ones to reach it and let a long one stand alone.'
    );
  }
  if (request.intensity) lines.push(`Preferred intensity: ${request.intensity}.`);
  if (request.trainingTypes.length) lines.push(`Preferred styles: ${request.trainingTypes.join(', ')}.`);
  if (request.bodyParts.length) lines.push(`Focus areas: ${request.bodyParts.join(', ')}.`);
  if (request.equipment.length) lines.push(`Equipment available: ${request.equipment.join(', ')}.`);
  else lines.push('Equipment available: not specified.');

  const description = request.description.trim();
  if (description) {
    lines.push('', 'In the user\'s own words:', description.slice(0, 2000));
  }

  lines.push('', `Catalogue (${candidateSet.candidates.length} videos):`);
  for (const candidate of candidateSet.candidates) {
    lines.push(formatCandidate(candidate));
  }

  lines.push(
    '',
    `Build the plan now. Return exactly ${weeks} week(s), each with exactly ${DAYS_PER_WEEK} day slots.`
  );
  return lines.join('\n');
}

function formatCandidate(candidate: Candidate): string {
  const facts: string[] = [];
  if (candidate.minutes) facts.push(`${candidate.minutes}min`);
  if (candidate.intensity) facts.push(candidate.intensity);
  if (candidate.types.length) facts.push(candidate.types.join('/'));
  if (candidate.parts.length) facts.push(candidate.parts.join('/'));
  if (candidate.equipment.length) facts.push(`needs ${candidate.equipment.join('+')}`);
  const suffix = facts.length ? ` [${facts.join(' | ')}]` : '';
  return `${candidate.id} :: ${candidate.title}${suffix}`;
}

/**
 * Pull the JSON object out of a reply.
 *
 * Models are asked for bare JSON but frequently wrap it in a code fence or add
 * a sentence of preamble, and that is not worth failing the whole request over.
 */
function parseJsonReply(raw: string): any {
  const withoutFence = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  const slice = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;

  try {
    return JSON.parse(slice);
  } catch {
    throw new AiError('The model did not return a usable plan. Try generating again.', 'unparsable');
  }
}

/**
 * Coerce whatever came back into exactly `weeks` weeks of seven days, keeping
 * only ids that exist in the catalogue.
 *
 * Anything unrecognised is dropped and reported rather than passed through: a
 * phantom id would render as a nameless row in the builder and then vanish on
 * save, so the plan the user reviewed would not be the plan they saved.
 */
function validateWeeks(
  rawWeeks: unknown,
  weeks: number,
  known: Set<string>
): { draftWeeks: DraftWeek[]; droppedIds: string[] } {
  const source = Array.isArray(rawWeeks) ? rawWeeks : [];
  const dropped = new Set<string>();
  const draftWeeks: DraftWeek[] = [];

  for (let w = 0; w < weeks; w++) {
    const rawDays = Array.isArray((source[w] as any)?.days) ? (source[w] as any).days : [];
    const days: DraftDay[] = [];

    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const rawIds = (rawDays[d] as any)?.videoIds;
      const seen = new Set<string>();
      const videoIds: string[] = [];

      if (Array.isArray(rawIds)) {
        for (const value of rawIds) {
          if (typeof value !== 'string') continue;
          const id = value.trim();
          if (!id || seen.has(id)) continue;
          if (!known.has(id)) {
            dropped.add(id);
            continue;
          }
          seen.add(id);
          videoIds.push(id);
        }
      }
      days.push({ videoIds });
    }
    draftWeeks.push({ days });
  }

  return { draftWeeks, droppedIds: Array.from(dropped) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
