/**
 * Guess a video's tags from its title.
 *
 * Imported videos arrive with nothing but a title, and tagging dozens of them
 * by hand is the main cost of pulling in a playlist. This fills in the obvious
 * ones so the user is correcting a draft rather than starting from scratch.
 *
 * Deliberately conservative — a wrong tag is worse than a missing one, because
 * a missing tag is visibly missing while a wrong one silently skews filters:
 *   - matches whole words (by stem), never bare substrings, so "mata" doesn't
 *     fire on "automat"
 *   - understands negation, so "bez hantli" / "without dumbbells" doesn't tag
 *     the video as needing dumbbells
 *   - only ever fills fields the user hasn't set
 *
 * Titles only. Descriptions are long, full of sponsor copy and cross-promotion
 * for other workouts, and produce far more false positives than they're worth.
 */
import {
  VALID_BODY_PARTS,
  VALID_EQUIPMENT,
  VALID_INTENSITIES,
  VALID_TRAINING_TYPES,
} from './routes/library.js';

export interface AutoTags {
  equipment: string[];
  training_type: string[];
  body_parts: string[];
  intensity: string;
}

/**
 * A tag and the words that imply it.
 *
 * `stems` match any word in the title that *starts with* the stem, which covers
 * Polish inflection cheaply: "hantl" catches hantle / hantli / hantlami.
 * `phrases` match across word boundaries, for things like "cale cialo".
 * Both are written already normalized: lowercase, no diacritics.
 */
interface Rule {
  tag: string;
  stems?: string[];
  phrases?: string[];
}

/** Words that flip the meaning of a keyword appearing just after them. */
const NEGATIONS = new Set(['bez', 'brak', 'braku', 'nie', 'no', 'without', 'zero']);

/** How many words before a match to scan for a negation. */
const NEGATION_WINDOW = 2;

const EQUIPMENT_RULES: Rule[] = [
  { tag: 'dumbbells', stems: ['hantl', 'hantel', 'dumbbell', 'ciezark'] },
  { tag: 'kettlebell', stems: ['kettlebell', 'kettle', 'odwaznik', 'girya'] },
  { tag: 'resistance_bands', stems: ['guma', 'gumy', 'gumami', 'gumach', 'tasma', 'tasmy'], phrases: ['resistance band', 'mini band'] },
  { tag: 'gym_ball', phrases: ['pilka gimnastyczna', 'gym ball', 'swiss ball', 'fitball', 'pilka fitness'] },
  { tag: 'pilates_ball', phrases: ['pilka pilates', 'mala pilka', 'pilates ball', 'soft ball'] },
  { tag: 'pilates_bar', phrases: ['drazek pilates', 'pilates bar'] },
  // "macie" is deliberately absent: it's the locative of "mata" but also the
  // everyday verb "you have", and the verb is far more common in titles.
  { tag: 'mat', stems: ['karimat', 'mata'], phrases: ['yoga mat', 'exercise mat'] },
];

const TRAINING_TYPE_RULES: Rule[] = [
  { tag: 'HIIT', stems: ['hiit', 'tabata', 'interwal', 'interval'] },
  { tag: 'Cardio', stems: ['cardio', 'kardio', 'aerobik', 'aerobic'] },
  { tag: 'Strength', stems: ['silow', 'wzmacniaj', 'wzmocnien', 'strength'] },
  { tag: 'Mobility', stems: ['mobility', 'mobilnosc'] },
  { tag: 'Yoga', stems: ['joga', 'jogi', 'yoga'] },
  { tag: 'Pilates', stems: ['pilates'] },
  { tag: 'Functional Strength Training', stems: ['funkcjonaln', 'functional'] },
  { tag: 'Warmup', stems: ['rozgrzewk', 'rozruch', 'warmup'], phrases: ['warm up'] },
  { tag: 'Cooldown', stems: ['wyciszenie', 'schlodzenie', 'cooldown'], phrases: ['cool down'] },
  { tag: 'Stretching', stems: ['stretching', 'stretch', 'rozciag'] },
  { tag: 'Standing', stems: ['standing'], phrases: ['na stojaco'] },
  { tag: 'No Jumping', phrases: ['bez skakania', 'bez skokow', 'no jumping', 'low impact'] },
  { tag: 'Period-Friendly', stems: ['miesiaczk'], phrases: ['period friendly', 'na okres'] },
];

const BODY_PART_RULES: Rule[] = [
  { tag: 'full_body', phrases: ['cale cialo', 'calego ciala', 'full body', 'total body'] },
  { tag: 'upper_body', phrases: ['gora ciala', 'gore ciala', 'gory ciala', 'upper body'] },
  { tag: 'lower_body', phrases: ['dol ciala', 'dolu ciala', 'lower body'] },
  // These are all stems rather than phrases: as phrases they'd substring-match,
  // so "core" would fire on "hardcore" and "back" on "comeback".
  { tag: 'core', stems: ['brzuch', 'brzucha', 'boczki', 'abs', 'abdominal', 'core'] },
  { tag: 'back', stems: ['plecy', 'plecow', 'kregoslup', 'back', 'spine'] },
  // "uda" (thighs) is omitted: it also starts "udalo", "udany" and friends.
  { tag: 'legs', stems: ['nogi', 'nog', 'legs', 'thigh'], phrases: ['leg workout'] },
  { tag: 'glutes', stems: ['posladk', 'glutes', 'booty', 'buttock', 'pupa'] },
  { tag: 'arms', stems: ['rece', 'ramion', 'biceps', 'triceps', 'arms'] },
  { tag: 'shoulders', stems: ['barki', 'barkow', 'shoulders'] },
  { tag: 'chest', stems: ['klatka', 'klatke', 'chest'] },
];

const INTENSITY_RULES: Rule[] = [
  { tag: 'high', stems: ['intensywn', 'intensive', 'intense', 'mocny'], phrases: ['high intensity'] },
  { tag: 'low', stems: ['lagodn', 'spokojn', 'gentle', 'easy'], phrases: ['low intensity'] },
  { tag: 'medium', stems: ['sredni', 'moderate'] },
];

/** Lowercase, strip diacritics, and reduce to space-separated words. */
function normalize(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when a negation sits just before `index` in `words`. */
function isNegated(words: string[], index: number): boolean {
  const from = Math.max(0, index - NEGATION_WINDOW);
  for (let i = from; i < index; i++) {
    if (NEGATIONS.has(words[i])) return true;
  }
  return false;
}

/** Does the title satisfy this rule, ignoring negated occurrences? */
function ruleMatches(rule: Rule, normalized: string, words: string[]): boolean {
  for (const stem of rule.stems || []) {
    const index = words.findIndex(word => word.startsWith(stem));
    if (index !== -1 && !isNegated(words, index)) return true;
  }

  for (const phrase of rule.phrases || []) {
    const at = normalized.indexOf(phrase);
    if (at === -1) continue;
    // Locate the phrase's first word to reuse the same negation check.
    const wordIndex = normalized.slice(0, at).split(' ').filter(Boolean).length;
    if (!isNegated(words, wordIndex)) return true;
  }

  return false;
}

function applyRules(rules: Rule[], normalized: string, words: string[], allowed: readonly string[]): string[] {
  const matched: string[] = [];
  for (const rule of rules) {
    if (!allowed.includes(rule.tag)) continue; // guards against a renamed tag
    if (ruleMatches(rule, normalized, words) && !matched.includes(rule.tag)) {
      matched.push(rule.tag);
    }
  }
  return matched;
}

/** Tags implied by a video title. Empty arrays when nothing is recognised. */
export function autoTagFromTitle(title: string): AutoTags {
  const normalized = normalize(title);
  const words = normalized.split(' ').filter(Boolean);

  // Only one intensity can apply; the first matching rule wins, ordered
  // high → low → medium so an explicit "intensywny" beats a vaguer word.
  const intensities = applyRules(INTENSITY_RULES, normalized, words, VALID_INTENSITIES);

  return {
    equipment: applyRules(EQUIPMENT_RULES, normalized, words, VALID_EQUIPMENT),
    training_type: applyRules(TRAINING_TYPE_RULES, normalized, words, VALID_TRAINING_TYPES),
    body_parts: applyRules(BODY_PART_RULES, normalized, words, VALID_BODY_PARTS),
    intensity: intensities[0] || '',
  };
}
