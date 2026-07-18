import { useEffect, useState } from 'react';

export type MatchMode = 'any' | 'all';

const STORAGE_KEY = 'filterMatchMode';

/**
 * Decide whether a video's tags satisfy the current selection.
 * - 'any' (OR): the video has at least one of the selected tags
 * - 'all' (AND): the video has every selected tag
 * An empty selection always matches (the filter is inactive).
 */
export function matchesTags(videoTags: string[] | undefined, selected: string[], mode: MatchMode): boolean {
  if (selected.length === 0) return true;
  const tags = videoTags || [];
  return mode === 'all'
    ? selected.every(tag => tags.includes(tag))
    : selected.some(tag => tags.includes(tag));
}

/**
 * Persisted (localStorage) match-mode toggle, shared across the Library,
 * Album and plan-builder filter panels so the preference stays consistent.
 */
export function useFilterMatchMode(): [MatchMode, (mode: MatchMode) => void] {
  const [mode, setMode] = useState<MatchMode>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'all' ? 'all' : 'any';
    } catch {
      return 'any';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage unavailable - keep the choice in memory only */
    }
  }, [mode]);

  return [mode, setMode];
}

type FilterMatchToggleProps = {
  mode: MatchMode;
  onChange: (mode: MatchMode) => void;
  label?: string;
  anyLabel?: string;
  allLabel?: string;
  anyHint?: string;
  allHint?: string;
};

/**
 * Small segmented "Any / All" control. Labels default to English but can be
 * overridden (e.g. with i18n strings) by the caller.
 */
export function FilterMatchToggle({
  mode,
  onChange,
  label = 'Match',
  anyLabel = 'Any',
  allLabel = 'All',
  anyHint = 'Show videos with at least one selected tag',
  allHint = 'Show only videos that have every selected tag',
}: FilterMatchToggleProps) {
  const options: { value: MatchMode; text: string; hint: string }[] = [
    { value: 'any', text: anyLabel, hint: anyHint },
    { value: 'all', text: allLabel, hint: allHint },
  ];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      <div style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)' }}>
        {options.map(opt => {
          const active = mode === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              title={opt.hint}
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              style={{
                border: 'none',
                cursor: 'pointer',
                padding: '5px 14px',
                borderRadius: 999,
                fontSize: '0.85rem',
                fontWeight: 700,
                background: active ? 'var(--accent-color)' : 'transparent',
                color: active ? '#fff' : 'var(--text-primary)',
                transition: 'background 0.15s ease',
              }}
            >
              {opt.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Fold text into a diacritic-insensitive, lowercase form for searching.
 * Uses Unicode NFD decomposition and strips combining marks so accents are
 * ignored, e.g. "GÓRĘ Ciała" -> "gore ciala". This lets a user type "gora"
 * (or "góra") and still match "górę".
 */
export function normalizeText(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Length of the shared leading characters of two strings. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Does a single normalized word satisfy a single normalized query token?
 * Matches when the token is a substring (handles partial/prefix typing and
 * exact hits) or when the two words share a stem, so Polish inflections match
 * (e.g. "gora" vs "gore" from "góra"/"górę"): they agree on all but a short
 * trailing suffix.
 */
function wordMatchesToken(word: string, token: string): boolean {
  if (!token) return true;
  if (word.includes(token)) return true;
  const common = commonPrefixLength(word, token);
  const minLen = Math.min(word.length, token.length);
  // Require a meaningful shared stem and allow only a short differing suffix.
  return common >= 3 && common >= minLen - 2;
}

/**
 * Diacritic- and inflection-tolerant text search used by the Library, Album
 * and plan-builder search boxes. The query is split into words; every query
 * word must match some word across the provided fields (AND semantics, order
 * independent). An empty query always matches.
 */
export function matchesQuery(fields: Array<string | null | undefined>, query: string): boolean {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const words = fields.flatMap(f => normalizeText(f).split(/\s+/).filter(Boolean));
  if (words.length === 0) return false;
  return tokens.every(token => words.some(word => wordMatchesToken(word, token)));
}
