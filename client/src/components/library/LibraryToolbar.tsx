import { ArrowUpDown, ChevronDown, LayoutGrid, List, Search, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SourceFilter } from '../../lib/filters';

/** 'size' and 'small' are the two ends of the same axis: most/fewest videos at
 *  the index, longest/shortest runtime inside a folder. */
export type LibrarySort = 'az' | 'za' | 'size' | 'small';
export type LibraryView = 'grid' | 'list';

export interface ActiveChip {
  key: string;
  label: string;
  category: 'intensity' | 'type' | 'body' | 'gear' | 'length';
  remove: () => void;
}

interface Props {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  filterCount: number;
  onOpenFilters: () => void;
  /** The All / My files / YouTube switch, shown at the library index only. */
  source?: SourceFilter;
  onSource?: (value: SourceFilter) => void;
  /** Omit `onSort` to leave the pill out (a folder page sorts each section on its own). */
  sort?: LibrarySort;
  onSort?: (value: LibrarySort) => void;
  /** "Most videos" at the index, "Longest first" inside a folder. */
  sizeLabel?: string;
  /** The opposite end: "Fewest videos" / "Shortest first". */
  smallLabel?: string;
  view: LibraryView;
  onView: (value: LibraryView) => void;
  activeChips: ActiveChip[];
  onClearAll: () => void;
}

const SOURCES: { value: SourceFilter; key: string }[] = [
  { value: '', key: 'library.source_all' },
  { value: 'local', key: 'library.source_local' },
  { value: 'external', key: 'library.source_external' },
];

/** A sort control: a styled pill with the real <select> invisible on top. */
export function SortPill<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label: string }[] }) {
  const { t } = useTranslation();
  const current = options.find(o => o.value === value)?.label ?? '';
  return (
    <div className="lib-sort">
      <ArrowUpDown size={15} />
      <span>{current}</span>
      <ChevronDown size={14} className="lib-sort-caret" />
      <select value={value} onChange={e => onChange(e.target.value as T)} aria-label={t('library.sort')}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/**
 * The sticky toolbar: search, filters, source, sort, and the grid/list switch.
 *
 * The sort control is a styled pill with a transparent native <select> laid
 * over it, so the label stays centred and the platform's own picker still
 * opens — a custom dropdown here would be worse on a phone.
 */
export default function LibraryToolbar({
  query, onQuery, placeholder,
  filterCount, onOpenFilters,
  source, onSource,
  sort, onSort, sizeLabel, smallLabel,
  view, onView,
  activeChips, onClearAll,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="lib-toolbar">
      <div className="rx-wrap lib-toolbar-inner">
        <div className="lib-toolbar-top">
          <div className="lib-search">
            <Search size={18} className="lib-search-icon" />
            <input
              value={query}
              onChange={e => onQuery(e.target.value)}
              placeholder={placeholder}
              aria-label={placeholder}
            />
            {query && (
              <button type="button" className="lib-search-clear" aria-label={t('library.clear_search')} onClick={() => onQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>

          <button
            type="button"
            className={`lib-filter-btn${filterCount ? ' is-active' : ''}`}
            onClick={onOpenFilters}
          >
            <SlidersHorizontal size={18} />
            <span className="lib-filter-label">{t('library.filters')}</span>
            {filterCount > 0 && <span className="lib-filter-count">{filterCount}</span>}
          </button>
        </div>

        <div className="lib-toolbar-row">
          {onSource && (
            <div className="rx-seg">
              {SOURCES.map(item => (
                <button
                  key={item.key}
                  type="button"
                  className={source === item.value ? 'is-on' : ''}
                  onClick={() => onSource(item.value)}
                >
                  {t(item.key)}
                </button>
              ))}
            </div>
          )}

          {onSort && sort && (
            <SortPill
              value={sort}
              onChange={onSort}
              options={[
                { value: 'az', label: t('library.sort_az') },
                { value: 'za', label: t('library.sort_za') },
                { value: 'size', label: sizeLabel || '' },
                { value: 'small', label: smallLabel || '' },
              ]}
            />
          )}

          <div className="lib-toolbar-spacer" />

          <div className="rx-seg rx-seg--icons">
            <button type="button" className={view === 'grid' ? 'is-on' : ''} aria-label={t('library.grid_view')} onClick={() => onView('grid')}>
              <LayoutGrid size={16} />
            </button>
            <button type="button" className={view === 'list' ? 'is-on' : ''} aria-label={t('library.list_view')} onClick={() => onView('list')}>
              <List size={16} />
            </button>
          </div>
        </div>

        {activeChips.length > 0 && (
          <div className="lib-active-chips">
            {activeChips.map(chip => (
              <button
                key={chip.key}
                type="button"
                className={`lib-active-chip lib-active-chip--${chip.category}`}
                onClick={chip.remove}
              >
                {chip.label}
                <X size={13} />
              </button>
            ))}
            <button type="button" className="lib-clear-all" onClick={onClearAll}>
              {t('library.clear_all')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
