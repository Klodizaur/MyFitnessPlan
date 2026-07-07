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
