import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight, ArrowUpDown, Check, ChevronDown, ChevronLeft, ChevronRight, Dumbbell, GripVertical, Minus, Moon,
  MoreHorizontal, Plus, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react';
import { BuilderWeek, createWeek, relayoutWeeks, workoutSlots } from '../../lib/builderModel';
import { EMPTY_LENGTH, isLengthActive, LengthRange, matchesLength, matchesQuery, matchesTags } from '../../lib/filters';
import LengthFilter from '../library/LengthFilter';
import { useMetaLabels } from '../../lib/labels';
import { BODY_PARTS, INTENSITIES, TRAINING_TYPES } from '../../lib/metadata';
import { EQUIPMENT_ITEMS } from '../../lib/equipment';
import { albumKeyForVideo, isExternalAlbumKey } from '../../lib/paths';
import { useIsMobile } from '../../lib/useIsMobile';
import { formatDuration, stripVideoExt, useVideoTags } from '../../lib/videoTags';
import YouTubeGlyph from '../icons/YouTubeGlyph';
import { TagRow } from '../library/LibraryCards';
import type { LibrarySort } from '../library/LibraryToolbar';
import { Video } from '../../types/video';
import '../../styles/builder.css';

export interface PlanBuilderScreenProps {
  editing: boolean;
  onClose: () => void;

  name: string;
  onName: (value: string) => void;
  description: string;
  onDescription: (value: string) => void;
  categories: { value: string; label: string }[];
  category: string;
  onCategory: (value: string) => void;
  customCategory: string;
  onCustomCategory: (value: string) => void;

  /** false = follow the global pattern from Settings. */
  patternCustom: boolean;
  onPatternCustom: (value: boolean) => void;
  pattern: number[];
  onPattern: (next: number[]) => void;

  weeks: BuilderWeek[];
  onWeeks: (next: BuilderWeek[]) => void;
  currentWeek: number;
  onCurrentWeek: (index: number) => void;
  currentDay: number;
  onCurrentDay: (index: number) => void;

  videos: Video[];
  onToggleVideo: (videoId: string) => void;
  onAddFromYouTube?: () => void;

  saving: boolean;
  status: string;
  onSave: () => void;
}

type Tab = 'details' | 'schedule';

/**
 * The plan builder, full screen.
 *
 * Two tabs: Details (what the plan is) and Schedule (what's in it). The
 * schedule is a two-pane layout on desktop — days on the left, the library on
 * the right — because building a plan is picking videos over and over, and
 * having the library permanently open is the whole job. On a phone there is no
 * room for two panes, so the library becomes a sheet opened from the day you're
 * filling.
 */
export default function PlanBuilderScreen(props: PlanBuilderScreenProps) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const isMobile = useIsMobile();
  const tagsFor = useVideoTags();

  const [tab, setTab] = useState<Tab>('details');
  const [weekMenu, setWeekMenu] = useState(false);
  // While true the custom category shows its text field; once you press Enter it
  // becomes a chip like the presets, and clicking that chip reopens the field.
  const [editingCustom, setEditingCustom] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sort, setSort] = useState<LibrarySort>('az');
  const [length, setLength] = useState<LengthRange>(EMPTY_LENGTH);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingType, setTrainingType] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const dragFrom = useRef<number | null>(null);

  const flash = (message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  };

  // A week is one turn of the rhythm: its workout days are the slots, and the rest
  // days come from the rhythm between them. Slots per week follow the rhythm, so
  // changing it re-deals the workouts into weeks of the new size.
  const slots = workoutSlots(props.pattern);
  const cycle: ({ kind: 'work'; slot: number } | { kind: 'rest'; n: number })[] = (() => {
    const out: ({ kind: 'work'; slot: number } | { kind: 'rest'; n: number })[] = [];
    let slot = 0;
    props.pattern.forEach((isWork, i) => {
      if (isWork === 1) out.push({ kind: 'work', slot: slot++ });
      else out.push({ kind: 'rest', n: i + 1 });
    });
    // A rhythm with no workout day can't be laid out; show the slots plainly.
    return out.some(c => c.kind === 'work') ? out : [{ kind: 'work', slot: 0 }];
  })();

  useEffect(() => {
    if (!props.weeks.some(w => w.days.length !== slots)) return;
    const next = relayoutWeeks(props.weeks, slots);
    props.onWeeks(next);
    if (props.currentWeek >= next.length) props.onCurrentWeek(next.length - 1);
    if (props.currentDay >= slots) props.onCurrentDay(slots - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, props.weeks]);

  const week = props.weeks[props.currentWeek];
  const day = week?.days[props.currentDay];
  const filledDays = props.weeks.reduce(
    (n, w) => n + w.days.filter(d => d.videoIds.length > 0).length, 0);

  const byId = useMemo(
    () => new Map(props.videos.map(v => [v.id, v])),
    [props.videos]
  );

  /** Folder chips: the album each video belongs to, most-used first. */
  const folders = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const video of props.videos) {
      const key = albumKeyForVideo(video);
      const label = isExternalAlbumKey(key)
        ? (video.external_playlist_title || t('library.untitled_playlist'))
        : key === '.' ? t('library.root_folder') : key;
      const entry = counts.get(key) || { label, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([key, v]) => ({ key, label: v.label }));
  }, [props.videos, t]);

  const filterCount = equipment.length + trainingType.length + bodyParts.length + intensity.length + (isLengthActive(length) ? 1 : 0);

  const pickable = useMemo(() => {
    const found = props.videos.filter(video => {
    if (folder && albumKeyForVideo(video) !== folder) return false;
    if (!matchesQuery([video.filename, video.description], query)) return false;
    // OR inside a group, AND across groups.
    if (!matchesTags(video.equipment, equipment, 'any')) return false;
    if (!matchesTags(video.training_type, trainingType, 'any')) return false;
    if (!matchesTags(video.body_parts, bodyParts, 'any')) return false;
    if (intensity.length > 0 && !intensity.includes(video.intensity || '')) return false;
    if (!matchesLength(video.duration_seconds, length)) return false;
    return true;
    });
    const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    const sorted = [...found];
    if (sort === 'size') sorted.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
    else if (sort === 'small') sorted.sort((a, b) => (a.duration_seconds || 0) - (b.duration_seconds || 0));
    else sorted.sort((a, b) => naturalCompare(a.filename, b.filename));
    if (sort === 'za') sorted.reverse();
    return sorted;
  }, [props.videos, folder, query, equipment, trainingType, bodyParts, intensity, length, sort]);

  const setDayVideos = (next: string[]) => {
    props.onWeeks(props.weeks.map((w, wi) => wi !== props.currentWeek ? w : {
      ...w,
      days: w.days.map((d, di) => di !== props.currentDay ? d : { ...d, videoIds: next }),
    }));
  };

  const toggleVideo = (video: Video) => {
    const inDay = day?.videoIds.includes(video.id);
    props.onToggleVideo(video.id);
    flash(inDay
      ? t('plans.builder_removed_from', { day: props.currentDay + 1 })
      : t('plans.builder_added_to', { week: props.currentWeek + 1, day: props.currentDay + 1 }));
  };

  /** Reorder within the open day. The grip is the handle; the row is the item. */
  const onDrop = (to: number) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from === null || from === to || !day) return;
    const next = [...day.videoIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDayVideos(next);
  };

  const addWeek = () => {
    props.onWeeks([...props.weeks, createWeek(props.weeks.length + 1, slots)]);
    props.onCurrentWeek(props.weeks.length);
    props.onCurrentDay(0);
    setWeekMenu(false);
  };

  const removeWeek = () => {
    if (props.weeks.length <= 1) return;
    props.onWeeks(props.weeks.filter((_, i) => i !== props.currentWeek));
    props.onCurrentWeek(Math.max(0, props.currentWeek - 1));
    props.onCurrentDay(0);
    setWeekMenu(false);
  };

  const workoutDays = props.pattern.filter(Boolean).length;

  // --- Pieces shared by the desktop panel and the mobile sheet ---------------

  const pickerControls = (
    <>
      <div className="pb-pick-controls">
        <div className="lib-search pb-search">
          <Search size={17} className="lib-search-icon" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('plans.builder_search')}
            aria-label={t('plans.builder_search')}
          />
        </div>
        <button
          type="button"
          className={`pb-filter-btn${filterCount || filtersOpen ? ' is-on' : ''}`}
          onClick={() => setFiltersOpen(v => !v)}
        >
          <SlidersHorizontal size={16} />
          {filterCount ? `${t('library.filters')} · ${filterCount}` : t('library.filters')}
        </button>
        <div className="pb-sort" title={t('library.sort')}>
          <ArrowUpDown size={16} />
          <ChevronDown size={13} />
          <select value={sort} onChange={e => setSort(e.target.value as LibrarySort)} aria-label={t('library.sort')}>
            <option value="az">{t('library.sort_az')}</option>
            <option value="za">{t('library.sort_za')}</option>
            <option value="size">{t('library.sort_longest')}</option>
            <option value="small">{t('library.sort_shortest')}</option>
          </select>
        </div>
      </div>

      {filtersOpen && (
        <div className="pb-filters">
          {([
            ['intensity', labels.sections.intensity, [...INTENSITIES].map(v => ({ value: v, label: labels.intensity(v) })), intensity, setIntensity],
            ['type', labels.sections.trainingType, [...TRAINING_TYPES].map(v => ({ value: v, label: labels.trainingType(v) })), trainingType, setTrainingType],
            ['body', labels.sections.bodyParts, [...BODY_PARTS].map(v => ({ value: v, label: labels.bodyPart(v) })), bodyParts, setBodyParts],
            ['gear', labels.sections.equipment, EQUIPMENT_ITEMS.map(i => ({ value: i.id, label: labels.equipment(i.id) })), equipment, setEquipment],
          ] as const).map(([cat, label, items, selected, setSelected]) => (
            <div key={cat} className="pb-filter-group">
              <div className="pb-filter-label">{label}</div>
              <div className="lib-chips">
                {items.map(item => {
                  const on = (selected as string[]).includes(item.value);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`lib-chip lib-chip--${cat} pb-chip${on ? ' is-on' : ''}`}
                      onClick={() => (setSelected as (v: string[]) => void)(
                        on ? (selected as string[]).filter(x => x !== item.value)
                           : [...(selected as string[]), item.value])}
                    >
                      {on && <Check size={13} />}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="pb-filter-group">
            <div className="pb-filter-label">{t('library.length')}</div>
            <LengthFilter value={length} onChange={setLength} />
          </div>
          {filterCount > 0 && (
            <button
              type="button"
              className="pb-clear-filters"
              onClick={() => { setEquipment([]); setTrainingType([]); setBodyParts([]); setIntensity([]); setLength(EMPTY_LENGTH); }}
            >
              {t('plans.builder_clear_filters')}
            </button>
          )}
        </div>
      )}

      <div className="pb-folders">
        <button type="button" className={`pb-folder${folder === '' ? ' is-on' : ''}`} onClick={() => setFolder('')}>
          {t('library.source_all')}
        </button>
        {folders.map(f => (
          <button
            key={f.key}
            type="button"
            className={`pb-folder${folder === f.key ? ' is-on' : ''}`}
            onClick={() => setFolder(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </>
  );

  const pickerResults = (
    <div className="pb-pick-grid">
      {pickable.map(video => {
        const inDay = Boolean(day?.videoIds.includes(video.id));
        const duration = formatDuration(video.duration_seconds);
        return (
          <button
            type="button"
            key={video.id}
            className={`pb-pick${inDay ? ' is-in' : ''}`}
            onClick={() => toggleVideo(video)}
          >
            <span className="pb-pick-thumb rx-thumb">
              {video.thumbnail_path
                ? <img src={`/thumbnails/${video.thumbnail_path}`} alt="" loading="lazy" />
                : <span className="pb-pick-noimg" />}
              <span className="pb-pick-mark">{inDay ? <Check size={16} /> : <Plus size={16} />}</span>
              {duration && <span className="rx-dur">{duration}</span>}
            </span>
            <span className="pb-pick-title rx-clamp-2">{stripVideoExt(video.filename)}</span>
            <TagRow tags={tagsFor(video)} rows={1} />
          </button>
        );
      })}
      {pickable.length === 0 && (
        <div className="lib-empty pb-pick-empty">
          <div className="lib-empty-title">{t('library.no_videos_match')}</div>
          <div className="lib-empty-hint">{t('library.no_videos_match_hint')}</div>
        </div>
      )}
    </div>
  );

  const dayCard = (dayIndex: number) => {
    const d = week.days[dayIndex];
    const selected = dayIndex === props.currentDay;
    const first = d.videoIds.length ? byId.get(d.videoIds[0]) : null;
    return (
      <div key={dayIndex} className={`pb-day${selected ? ' is-open' : ''}`}>
        <button type="button" className="pb-day-head" onClick={() => props.onCurrentDay(dayIndex)}>
          <span className="pb-day-label">{t('plans.builder_day_n', { n: dayIndex + 1 })}</span>
          <span className="pb-day-preview">
            {selected ? '' : first ? stripVideoExt(first.filename) : t('plans.builder_empty_day')}
          </span>
          {selected && isMobile && (
            <>
              <span
                role="button"
                tabIndex={0}
                className="pb-day-nav"
                aria-label={t('plans.builder_prev_day')}
                onClick={e => { e.stopPropagation(); if (props.currentDay > 0) props.onCurrentDay(props.currentDay - 1); }}
              >
                <ChevronLeft size={17} />
              </span>
              <span
                role="button"
                tabIndex={0}
                className="pb-day-nav"
                aria-label={t('plans.builder_next_day')}
                onClick={e => { e.stopPropagation(); if (props.currentDay < slots - 1) props.onCurrentDay(props.currentDay + 1); }}
              >
                <ChevronRight size={17} />
              </span>
            </>
          )}
          <span className={`pb-day-count${d.videoIds.length ? ' has' : ''}`}>{d.videoIds.length}</span>
        </button>

        {selected && (
          <div className="pb-day-body">
            {d.videoIds.map((id, index) => {
              const video = byId.get(id);
              return (
                <div
                  key={`${id}-${index}`}
                  className="pb-item"
                  draggable
                  onDragStart={() => { dragFrom.current = index; }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={() => onDrop(index)}
                >
                  <GripVertical size={16} className="pb-grip" />
                  {video?.thumbnail_path
                    ? <img className="pb-item-thumb" src={`/thumbnails/${video.thumbnail_path}`} alt="" loading="lazy" />
                    : <span className="pb-item-thumb" />}
                  <span className="pb-item-title rx-clamp-2">
                    {video ? stripVideoExt(video.filename) : id}
                  </span>
                  <button
                    type="button"
                    className="pb-item-remove"
                    aria-label={t('plans.builder_remove_video')}
                    onClick={() => setDayVideos(d.videoIds.filter((_, i) => i !== index))}
                  >
                    <X size={17} />
                  </button>
                </div>
              );
            })}

            {d.videoIds.length === 0 && (
              <div className="pb-day-empty">
                {isMobile ? t('plans.builder_no_videos_yet') : t('plans.builder_no_videos_yet_desktop')}
              </div>
            )}

            {isMobile && (
              <button type="button" className="rx-btn rx-btn--primary pb-add-btn" onClick={() => setPickerOpen(true)}>
                <Plus size={17} />
                {t('plans.builder_add_videos')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div className="pb">
      <div className="pb-bar">
        <button type="button" className="pb-close" aria-label={t('plans.builder_cancel')} onClick={props.onClose}>
          <X size={20} />
        </button>
        <div className="pb-bar-title">
          <div className="pb-eyebrow">
            {props.editing ? t('plans.builder_edit_plan') : t('plans.builder_new_plan')}
          </div>
          <div className="pb-name">{props.name || t('plans.builder_untitled')}</div>
        </div>

        {!isMobile && (
          <>
            <div className="rx-seg pb-tabs">
              <button type="button" className={tab === 'details' ? 'is-on' : ''} onClick={() => setTab('details')}>
                {t('plans.builder_tab_details')}
              </button>
              <button type="button" className={tab === 'schedule' ? 'is-on' : ''} onClick={() => setTab('schedule')}>
                {t('plans.builder_tab_schedule')}
              </button>
            </div>
            <div className="pb-summary">
              {`${t('plans.builder_summary_week', { count: props.weeks.length })} · ${t('plans.builder_summary_workout', { count: filledDays })}`}
            </div>
          </>
        )}

        <button
          type="button"
          className="rx-btn rx-btn--primary pb-save"
          onClick={props.onSave}
          disabled={props.saving || filledDays === 0}
        >
          {props.saving ? t('plans.builder_saving') : t('plans.builder_save')}
        </button>
      </div>

      {isMobile && (
        <div className="pb-mobile-tabs">
          <div className="rx-seg pb-tabs">
            <button type="button" className={tab === 'details' ? 'is-on' : ''} onClick={() => setTab('details')}>
              {t('plans.builder_tab_details')}
            </button>
            <button type="button" className={tab === 'schedule' ? 'is-on' : ''} onClick={() => setTab('schedule')}>
              {t('plans.builder_tab_schedule')}
            </button>
          </div>
          <div className="pb-summary">
            {`${t('plans.builder_summary_week', { count: props.weeks.length })} · ${t('plans.builder_summary_workout', { count: filledDays })}`}
          </div>
        </div>
      )}

      {tab === 'details' ? (
        <div className="pb-scroll">
          <div className="pb-details">
            <p className="pb-intro">{t('plans.builder_intro')}</p>

            <div>
              <div className="pb-label">{t('plans.builder_plan_name')}</div>
              <input
                className="pb-input"
                value={props.name}
                onChange={e => props.onName(e.target.value)}
                placeholder={t('plans.builder_plan_name')}
              />
            </div>

            <div>
              <div className="pb-label">{t('plans.builder_category')}</div>
              <div className="pb-cats">
                {props.categories.map(cat => {
                  const isCustom = cat.value === 'custom';
                  const named = isCustom && props.category === 'custom' && props.customCategory.trim() && !editingCustom;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      className={`pb-cat${props.category === cat.value ? ' is-on' : ''}`}
                      onClick={() => {
                        props.onCategory(cat.value);
                        // Picking Custom (or the chip that stands for it) opens the field to type in.
                        setEditingCustom(isCustom);
                      }}
                    >
                      {named ? props.customCategory.trim() : cat.label}
                    </button>
                  );
                })}
              </div>
              {props.category === 'custom' && (editingCustom || !props.customCategory.trim()) && (
                <input
                  className="pb-input pb-input--inline"
                  value={props.customCategory}
                  onChange={e => props.onCustomCategory(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (props.customCategory.trim()) setEditingCustom(false);
                    }
                  }}
                  onBlur={() => { if (props.customCategory.trim()) setEditingCustom(false); }}
                  placeholder={t('plans.category_custom_placeholder')}
                  autoFocus={editingCustom}
                />
              )}
            </div>

            <div>
              <div className="pb-rhythm-head">
                <div className="pb-label pb-label--flush">{t('plans.builder_rhythm')}</div>
                <div className="rx-seg rx-seg--sm">
                  <button type="button" className={!props.patternCustom ? 'is-on' : ''} onClick={() => props.onPatternCustom(false)}>
                    {t('plans.pattern_use_default')}
                  </button>
                  <button type="button" className={props.patternCustom ? 'is-on' : ''} onClick={() => props.onPatternCustom(true)}>
                    {t('plans.pattern_set_for_plan')}
                  </button>
                </div>
              </div>

              <div className={`pb-rhythm${props.patternCustom ? '' : ' is-locked'}`}>
                {props.pattern.map((value, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`pb-rhythm-day${value ? ' is-work' : ''}`}
                    disabled={!props.patternCustom}
                    onClick={() => props.onPattern(props.pattern.map((v, i) => i === index ? (v ? 0 : 1) : v))}
                  >
                    <span className="pb-rhythm-n">{index + 1}</span>
                    {value ? <Dumbbell size={18} /> : <Moon size={18} />}
                  </button>
                ))}
              </div>

              {/* The cycle itself can grow or shrink, so a plan isn't stuck with a
                  seven-day week: "5 workout days in every [− 7 +] days". */}
              <div className="pb-cycle">
                <span>{t('settings.workout_days_in_every', { count: workoutDays })}</span>
                <div className="pb-stepper">
                  <button
                    type="button"
                    aria-label={t('settings.remove_day')}
                    disabled={!props.patternCustom || props.pattern.length <= 1 || !props.pattern.slice(0, -1).some(v => v === 1)}
                    onClick={() => props.onPattern(props.pattern.slice(0, -1))}
                  >
                    <Minus size={15} />
                  </button>
                  <span>{props.pattern.length}</span>
                  <button
                    type="button"
                    aria-label={t('settings.add_day')}
                    disabled={!props.patternCustom || props.pattern.length >= 14}
                    onClick={() => props.onPattern([...props.pattern, 1])}
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <span>{t('settings.days_unit')}</span>
              </div>
              {!props.patternCustom && (
                <div className="pb-hint">{t('plans.pattern_follows_settings')}</div>
              )}
            </div>

            <div>
              <div className="pb-label">{t('plans.builder_description')}</div>
              <textarea
                className="pb-textarea"
                value={props.description}
                onChange={e => props.onDescription(e.target.value)}
                placeholder={t('plans.builder_description_placeholder')}
              />
              <div className="pb-hint">{t('plans.builder_description_hint')}</div>
            </div>

            <button type="button" className="pb-next" onClick={() => setTab('schedule')}>
              {t('plans.builder_next_schedule')}
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : (
        <div className="pb-schedule">
          <div className="pb-days">
            <div className="pb-weeks">
              {props.weeks.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className={`pb-week${i === props.currentWeek ? ' is-on' : ''}`}
                  onClick={() => { props.onCurrentWeek(i); props.onCurrentDay(0); setWeekMenu(false); }}
                >
                  {t('plans.builder_week_n', { n: i + 1 })}
                  <span className="pb-week-count">
                    {w.days.filter(d => d.videoIds.length > 0).length}/{slots}
                  </span>
                </button>
              ))}
              <button type="button" className="pb-add-week" onClick={addWeek}>
                <Plus size={15} />
                {t('plans.builder_week')}
              </button>
              <div className="pb-weeks-spacer" />
              <button
                type="button"
                className="pb-week-menu"
                aria-label={t('plans.builder_week_options')}
                onClick={() => setWeekMenu(v => !v)}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>

            {weekMenu && (
              <div className="pb-week-actions">
                <button
                  type="button"
                  className="pb-remove-week"
                  disabled={props.weeks.length <= 1}
                  onClick={removeWeek}
                >
                  <Trash2 size={15} />
                  {props.weeks.length > 1
                    ? t('plans.builder_remove_week_n', { n: props.currentWeek + 1 })
                    : t('plans.builder_cant_remove_week')}
                </button>
              </div>
            )}

            <p className="pb-note">{t('plans.builder_empty_days_note')}</p>

            {isMobile && (
              <div className="pb-day-pills" style={{ ['--n' as string]: cycle.length }}>
                {cycle.map((c, k) => c.kind === 'rest' ? (
                  <span key={`r${k}`} className="pb-day-pill is-rest" aria-label={t('plans.builder_rest_day')}>
                    <Moon size={15} />
                  </span>
                ) : (
                  <button
                    key={`w${c.slot}`}
                    type="button"
                    className={`pb-day-pill${c.slot === props.currentDay ? ' is-on' : ''}`}
                    onClick={() => props.onCurrentDay(c.slot)}
                  >
                    <span>{c.slot + 1}</span>
                    <span className={`pb-day-dot${week.days[c.slot]?.videoIds.length ? ' has' : ''}`} />
                  </button>
                ))}
              </div>
            )}

            <div className="pb-day-list">
              {isMobile
                ? dayCard(props.currentDay)
                : cycle.map((c, k) => c.kind === 'rest' ? (
                  <div key={`r${k}`} className="pb-rest">
                    <Moon size={15} />
                    {t('plans.builder_rest_day')}
                  </div>
                ) : dayCard(c.slot))}
            </div>
          </div>

          {!isMobile && (
            <div className="pb-picker">
              <div className="pb-pick-head">
                <div className="pb-pick-title">
                  {t('plans.builder_add_to', { week: props.currentWeek + 1, day: props.currentDay + 1 })}
                </div>
                {props.onAddFromYouTube && (
                  <button type="button" className="pb-yt" onClick={props.onAddFromYouTube}>
                    <YouTubeGlyph size={16} knockout="var(--t-page)" />
                    {t('library.add_from_youtube')}
                  </button>
                )}
              </div>
              {pickerControls}
              <div className="pb-pick-scroll">{pickerResults}</div>
            </div>
          )}
        </div>
      )}

      {/* Mobile: the library as a sheet over the day you're filling. */}
      {isMobile && pickerOpen && tab === 'schedule' && (
        <>
          <div className="pb-sheet-backdrop" onClick={() => setPickerOpen(false)} />
          <div className="pb-sheet">
            <div className="pb-sheet-head">
              <div>
                <div className="pb-pick-title">
                  {t('plans.builder_add_to', { week: props.currentWeek + 1, day: props.currentDay + 1 })}
                </div>
                <div className="pb-pick-sub">
                  {t('plans.builder_n_in_day', { count: day?.videoIds.length || 0 })}
                </div>
              </div>
              <button type="button" className="rx-btn rx-btn--primary pb-done" onClick={() => setPickerOpen(false)}>
                {t('plans.builder_done')}
              </button>
            </div>
            <div className="pb-sheet-controls">{pickerControls}</div>
            <div className="pb-pick-scroll">{pickerResults}</div>
          </div>
        </>
      )}

      {(toast || props.status) && <div className="pb-toast">{toast || props.status}</div>}
    </div>,
    document.body
  );
}
