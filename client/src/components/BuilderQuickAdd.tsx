import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matchesQuery } from '../lib/filters';
import { Video } from '../types/video';

type Props = {
  videos: Video[];
  /** Videos already on the day being edited, so results can show a tick. */
  selectedIds: string[];
  /** Adds the video to the day, or removes it if it's already there. */
  onToggle: (videoId: string) => void;
};

/** Fewer than this and the list is noise: one letter matches most of a library. */
const MIN_QUERY = 2;
const MAX_RESULTS = 8;

const stripExt = (filename: string) => filename.replace(/\.[^/.]+$/, '');

/**
 * "Start typing…" — add a video to the selected day without leaving the top of
 * the builder.
 *
 * The full library browser with its filters is still below, unchanged; this is
 * for when you already know what you want and scrolling past the day list to
 * find it is the slow part. It searches the whole library, ignoring the filters
 * set below, because those belong to the browser and would otherwise hide a
 * video you typed the exact name of.
 *
 * The query is kept after adding, so a series ("TONED ARMS 3", "…4", "…5") can
 * be added in a row. Picking one that's already on the day removes it, the same
 * toggle the library cards use.
 */
export default function BuilderQuickAdd({ videos, selectedIds, onToggle }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();

  const matches = useMemo(() => {
    if (trimmed.length < MIN_QUERY) return [];
    const found = videos.filter(v => matchesQuery([v.filename, v.description], trimmed));
    // Titles that contain what was typed, as typed, go first — that's almost
    // always the one being reached for. The rest keep library order.
    const needle = trimmed.toLowerCase();
    return [
      ...found.filter(v => v.filename.toLowerCase().includes(needle)),
      ...found.filter(v => !v.filename.toLowerCase().includes(needle)),
    ];
  }, [videos, trimmed]);

  const shown = matches.slice(0, MAX_RESULTS);
  const showList = open && trimmed.length >= MIN_QUERY;

  const pick = (id: string) => {
    onToggle(id);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && shown.length) {
      e.preventDefault();
      setOpen(true);
      setActive(i => (i + 1) % shown.length);
    } else if (e.key === 'ArrowUp' && shown.length) {
      e.preventDefault();
      setActive(i => (i - 1 + shown.length) % shown.length);
    } else if (e.key === 'Enter' && shown[active]) {
      e.preventDefault();
      pick(shown[active].id);
    } else if (e.key === 'Escape') {
      setQuery('');
      setActive(0);
    }
  };

  return (
    <div className="wb-quick">
      <svg className="wb-quick-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref={inputRef}
        className="wb-input wb-quick-input"
        value={query}
        placeholder={t('plans.builder_quick_add_placeholder')}
        aria-label={t('plans.builder_quick_add_placeholder')}
        role="combobox"
        aria-expanded={showList}
        aria-controls="wb-quick-list"
        aria-autocomplete="list"
        onChange={e => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a result lands before the list disappears.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />

      {showList && (
        <div className="wb-quick-list" id="wb-quick-list" role="listbox">
          {shown.length === 0 ? (
            <p className="wb-quick-empty">{t('plans.builder_quick_add_none')}</p>
          ) : (
            shown.map((video, index) => {
              const added = selectedIds.includes(video.id);
              return (
                <button
                  key={video.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`wb-quick-item${index === active ? ' active' : ''}${added ? ' added' : ''}`}
                  // mousedown, not click: keeps focus in the input so you can
                  // carry on typing or add the next one straight away.
                  onMouseDown={e => { e.preventDefault(); pick(video.id); }}
                  onMouseEnter={() => setActive(index)}
                  title={video.filename}
                >
                  {video.thumbnail_path ? (
                    <img className="wb-mini-thumb" src={`/thumbnails/${video.thumbnail_path}`} alt="" loading="lazy" />
                  ) : (
                    <span className="wb-mini-thumb wb-mini-thumb-empty" aria-hidden="true" />
                  )}
                  <span className="wb-quick-name">{stripExt(video.filename)}</span>
                  <span className="wb-quick-mark" aria-hidden="true">{added ? '✓' : '+'}</span>
                </button>
              );
            })
          )}
          {matches.length > shown.length && (
            <p className="wb-quick-more">
              {t('plans.builder_quick_add_more', { count: matches.length - shown.length })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
