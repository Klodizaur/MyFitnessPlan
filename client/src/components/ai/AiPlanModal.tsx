/**
 * The "Build with AI" entry point: describe what you want, pick constraints,
 * generate.
 *
 * This modal is only the front half of plan creation. It never saves anything —
 * it hands the generated weeks to the existing workout builder, which is where
 * the user reviews, edits and saves them exactly as they would a plan they
 * built by hand. Hidden entirely unless the server reports a configured model,
 * so an install without a key looks like an install without the feature.
 *
 * Two layouts share the same fields: a guided wizard (one question per step, the
 * redesign's default look) and an all-at-once page, chosen in AI settings.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft, ArrowRight, Ban, Check, Dumbbell, FileVideo, Folder, Library, Minus, Moon, PartyPopper, Plus,
  RotateCcw, Shuffle, SignalHigh, SignalLow, SignalMedium, Sparkles, X,
} from 'lucide-react';
import { EQUIPMENT_ITEMS } from '../../lib/equipment';
import { BODY_PARTS, INTENSITIES, TRAINING_TYPES } from '../../lib/metadata';
import { useMetaLabels } from '../../lib/labels';
import { albumKeyForVideo, isExternalAlbumKey } from '../../lib/paths';
import { DEFAULT_PATTERN, isUsablePattern } from '../WorkoutPatternPicker';
import { BuilderWeek, createWeek } from '../../lib/builderModel';
import { Video } from '../../types/video';
import '../../styles/aiplan.css';
import '../../styles/builder.css';
import { localDateString } from '../../lib/dates';
import { formatDuration, stripVideoExt } from '../../lib/videoTags';

/** What the server drafted, translated into the builder's own shape. */
export interface AiPlanResult {
  weeks: BuilderWeek[];
  /** Model-suggested title; empty when the reply omitted one. */
  name: string;
  summary: string;
  /** Ids the model returned that no longer exist; dropped before handoff. */
  droppedIds: string[];
  candidateCount: number;
  truncated: boolean;
  /** Workout days asked for, and how many the draft actually came back with. */
  requestedWorkoutDays: number;
  workoutDayCount: number;
  /**
   * The rhythm the draft was paced for, handed to the builder to save with.
   * Null when the user kept their default, so the plan is saved without one and
   * keeps following Settings.
   */
  workoutPattern: number[] | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerated: (result: AiPlanResult) => void;
  /** The draft was saved as a plan straight from the review step. */
  onSaved: (workoutCount: number) => void;
}

/**
 * How many workout days a plan can hold.
 *
 * This counts sessions, not calendar days: rest days come from the workout
 * pattern in Settings and are added when the plan is scheduled. The ceiling is
 * twelve weeks at seven sessions a week, which is what the builder's week grid
 * can hold.
 */
const MIN_WORKOUT_DAYS = 1;
const MAX_WORKOUT_DAYS = 84;
const DEFAULT_WORKOUT_DAYS = 12;

/**
 * Session-length range.
 *
 * The low end is a genuine quick session rather than a token one; the high end
 * covers a long weekend workout without offering lengths nobody trains for.
 */
const MIN_SESSION = 10;
const MAX_SESSION = 90;

/** Jump-to points under the slider, at the lengths people actually pick. */
const SESSION_MARKS = [10, 20, 30, 45, 60, 90];

/** Plain-language band for the current value, so the number means something. */
function sessionBand(minutes: number): string {
  if (minutes <= 20) return 'ai.minutes_short';
  if (minutes <= 40) return 'ai.minutes_medium';
  if (minutes <= 60) return 'ai.minutes_long';
  return 'ai.minutes_very_long';
}

/** The questions the form asks, in the order the guided flow walks them. */
type StepKey = 'describe' | 'days' | 'minutes' | 'equipment' | 'styles' | 'focus' | 'intensity' | 'albums';

const STEP_ORDER: StepKey[] = [
  'describe',
  'days',
  'minutes',
  'equipment',
  'styles',
  'focus',
  'intensity',
  'albums',
];

/**
 * Equipment and albums are filters where "nothing selected" is a real, useful
 * answer — everything is allowed. Every other question shapes the plan, and
 * leaving it blank just hands the model less to work with. Day count, session
 * length and intensity always hold a value, so only the free-text and
 * multi-select ones need checking.
 */
const OPTIONAL_STEPS: ReadonlySet<StepKey> = new Set<StepKey>(['equipment', 'albums']);

/** Albums are either included, excluded, or unconstrained. */
type AlbumState = 'include' | 'exclude';

interface AlbumOption {
  key: string;
  title: string;
  count: number;
  /** Cover art, matching what the Library shows for the same album. */
  cover: string | null;
  isExternal: boolean;
  /**
   * Folders one level inside the album, so part of it can be left out. Empty
   * for imports and for albums whose videos all sit directly in the folder.
   */
  subs: AlbumSub[];
}

/** `key` is `Album/Sub`, or `Album/` for videos directly in the album — the server's format. */
interface AlbumSub {
  key: string;
  label: string;
  count: number;
  loose: boolean;
}

/** The folder a local video sits in below its album, or null when it has none to pick. */
function folderKeyForVideo(video: Video): { key: string; label: string; loose: boolean } | null {
  if (isExternalAlbumKey(albumKeyForVideo(video))) return null;
  const parts = (video.relative_path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return parts.length > 2
    ? { key: `${parts[0]}/${parts[1]}`, label: parts[1], loose: false }
    : { key: `${parts[0]}/`, label: '', loose: true };
}

type Phase = 'form' | 'gen' | 'done';

const INTENSITY_ICONS = { low: SignalLow, medium: SignalMedium, high: SignalHigh } as const;

export default function AiPlanModal({ open, onClose, onGenerated, onSaved }: Props) {
  const { t } = useTranslation();
  const labels = useMetaLabels();

  const [description, setDescription] = useState('');
  const [workoutDays, setWorkoutDays] = useState(DEFAULT_WORKOUT_DAYS);
  // How often this person trains. Decides the plan's real length on the
  // calendar, and paces the draft — so it belongs beside the day count rather
  // than being discovered later in Settings.
  const [workoutPattern, setWorkoutPattern] = useState<number[]>(DEFAULT_PATTERN);
  // Off by default: a drafted plan follows the rhythm from Settings unless the
  // user deliberately gives this one its own.
  const [patternCustom, setPatternCustom] = useState(false);
  const [maxMinutes, setMaxMinutes] = useState(45);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingTypes, setTrainingTypes] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState('');
  const [albumStates, setAlbumStates] = useState<Record<string, AlbumState>>({});
  // Subfolders switched off inside an included album (key -> true). Everything
  // is on by default, so this only holds the exceptions.
  const [folderOff, setFolderOff] = useState<Record<string, boolean>>({});

  const [videos, setVideos] = useState<Video[]>([]);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [draft, setDraft] = useState<AiPlanResult | null>(null);
  const loading = phase === 'gen';

  // Whether to ask everything at once or one thing at a time. Read from AI
  // settings each time the modal opens, defaulting to the all-at-once form so a
  // failed or slow check never changes the layout unexpectedly.
  const [guided, setGuided] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data?.workout_pattern) && data.workout_pattern.some((d: number) => d)) {
          setWorkoutPattern(data.workout_pattern);
        }
      })
      .catch(() => { /* keep the built-in default */ });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStepIndex(0);
    setPhase('form');
    setDraft(null);
    setError('');
    let cancelled = false;
    fetch('/api/ai/status')
      .then(r => r.json())
      .then(data => { if (!cancelled) setGuided(data?.planFlow === 'guided'); })
      .catch(() => { if (!cancelled) setGuided(false); });
    return () => { cancelled = true; };
  }, [open]);

  // The album list is derived from the library, so it is fetched when the
  // modal opens rather than held by the page that renders it.
  useEffect(() => {
    if (!open || videos.length > 0) return;
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setVideos(data || []))
      .catch(() => setVideos([]));
  }, [open, videos.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'gen') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, onClose]);

  const albums = useMemo<AlbumOption[]>(() => {
    const byKey = new Map<string, AlbumOption>();
    const subCounts = new Map<string, Map<string, AlbumSub>>();
    for (const video of videos) {
      const key = albumKeyForVideo(video);
      const folder = folderKeyForVideo(video);
      if (folder) {
        const subs = subCounts.get(key) ?? new Map<string, AlbumSub>();
        const sub = subs.get(folder.key) ?? { key: folder.key, label: folder.label, count: 0, loose: folder.loose };
        sub.count += 1;
        subs.set(folder.key, sub);
        subCounts.set(key, subs);
      }
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        // The first video with a thumbnail supplies the cover, matching how the
        // Library picks one, so an album looks the same in both places.
        if (!existing.cover && video.thumbnail_path) {
          existing.cover = `/thumbnails/${video.thumbnail_path}`;
        }
        continue;
      }
      byKey.set(key, {
        key,
        title: albumTitle(key, video, t),
        count: 1,
        cover: albumCover(key, video),
        isExternal: isExternalAlbumKey(key),
        subs: [],
      });
    }
    for (const [key, subs] of subCounts) {
      const album = byKey.get(key);
      if (!album) continue;
      const list = Array.from(subs.values());
      // Only worth a picker when there is a real subfolder to choose between.
      if (!list.some(s => !s.loose)) continue;
      album.subs = list.sort((a, b) => (a.loose === b.loose ? a.label.localeCompare(b.label) : a.loose ? 1 : -1));
    }
    return Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [videos, t]);

  // The album question only earns a step when there is more than one album to
  // choose between; with a single album it would be a page asking nothing.
  const steps = STEP_ORDER.filter(key => key !== 'albums' || albums.length > 1);

  const stepAnswered = (key: StepKey): boolean => {
    if (OPTIONAL_STEPS.has(key)) return true;
    switch (key) {
      case 'describe':
        return description.trim().length > 0;
      case 'styles':
        return trainingTypes.length > 0;
      case 'focus':
        return bodyParts.length > 0;
      default:
        return true;
    }
  };

  const missingSteps = steps.filter(key => !stepAnswered(key));
  const canGenerate = missingSteps.length === 0;

  const [saving, setSaving] = useState(false);

  // The drafted days with their videos resolved, for the preview strip.
  const draftDays = useMemo(() => {
    if (!draft) return [];
    const byId = new Map(videos.map(v => [v.id, v]));
    return draft.weeks
      .flatMap(week => week.days)
      .map(day => ({ videos: day.videoIds.map(id => byId.get(id)).filter((v): v is Video => Boolean(v)) }))
      .filter(day => day.videos.length > 0);
  }, [draft, videos]);

  if (!open) return null;

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
  };

  const setAlbum = (key: string, state: AlbumState) => {
    setAlbumStates(prev => {
      const next = { ...prev };
      if (next[key] === state) delete next[key];
      else next[key] = state;
      return next;
    });
  };

  // What the album filter will actually use, for the summary line.
  const anyIncluded = albums.some(a => albumStates[a.key] === 'include');
  const usedAlbums = albums.filter(a => (anyIncluded ? albumStates[a.key] === 'include' : albumStates[a.key] !== 'exclude'));
  // An included album with subfolders counts only the ones left switched on.
  const albumVideoCount = (a: AlbumOption) =>
    albumStates[a.key] === 'include' && a.subs.length > 0
      ? a.subs.reduce((n, s) => n + (folderOff[s.key] ? 0 : s.count), 0)
      : a.count;
  const usableVideos = usedAlbums.reduce((n, a) => n + albumVideoCount(a), 0);
  const skippedCount = albums.filter(a => albumStates[a.key] === 'exclude').length;
  const albumSummary = anyIncluded
    ? t('ai.albums_summary_in', { count: usedAlbums.length, videos: usableVideos })
    : skippedCount > 0
      ? t('ai.albums_summary_except', { count: skippedCount, videos: usableVideos })
      : t('ai.albums_summary_all', { videos: usableVideos });

  const cycleLength = Math.max(workoutPattern.length, 1);
  const patternWorkoutDays = Math.max(workoutPattern.filter(Boolean).length, 1);
  const approxWeeks = Math.max(1, Math.ceil((workoutDays / patternWorkoutDays) * cycleLength / 7));

  const handleGenerate = async () => {
    setPhase('gen');
    setError('');

    try {
      const res = await fetch('/api/ai/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          workoutDays,
          // Pacing hint only. Sent whichever rhythm applies, custom or default.
          workoutPattern,
          maxMinutes,
          equipment,
          trainingTypes,
          bodyParts,
          intensity,
          includeAlbums: Object.keys(albumStates).filter(k => albumStates[k] === 'include'),
          excludeAlbums: Object.keys(albumStates).filter(k => albumStates[k] === 'exclude'),
          // Only meaningful inside an album that is actually included.
          excludeFolders: albums
            .filter(a => albumStates[a.key] === 'include')
            .flatMap(a => a.subs.filter(s => folderOff[s.key]).map(s => s.key)),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || t('ai.error_generic'));
        setPhase('form');
        return;
      }

      setDraft(toBuilderWeeks(data, videos, workoutDays, patternCustom ? workoutPattern : null));
      setPhase('done');
    } catch {
      setError(t('ai.error_unreachable'));
      setPhase('form');
    }
  };

  /** Save the draft as a plan as it stands, without opening the builder. */
  const saveDraft = async () => {
    if (!draft || saving) return;
    const byId = new Map(videos.map(v => [v.id, v]));
    const days = draft.weeks.flatMap(week =>
      week.days.map(day => {
        const videoTitles = day.videoIds.map(id => byId.get(id)?.filename || '').filter(Boolean);
        return { ...day, name: videoTitles.join('\n'), videoTitles };
      })
    ).filter(day => day.videoIds.length > 0);
    if (days.length === 0) { setError(t('plans.builder_need_videos')); return; }

    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/plan/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim() || t('ai.default_plan_name'),
          startDate: localDateString(),
          category: '',
          description: draft.summary || '',
          workoutPattern: draft.workoutPattern,
          days,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data?.error || t('ai.error_generic'));
      } else {
        onSaved(days.length);
      }
    } catch {
      setError(t('ai.error_unreachable'));
    }
    setSaving(false);
  };

  const startOver = () => {
    setPhase('form');
    setDraft(null);
    setStepIndex(0);
  };

  const chipCount = (count: number, clear: () => void) =>
    count > 0 ? (
      <div className="ai-chip-count">
        <strong>{t('ai.selected_count', { count })}</strong>
        <button type="button" onClick={clear}>{t('ai.clear')}</button>
      </div>
    ) : null;

  // Every field the form can ask for, each rendered the same way in both modes —
  // the guided flow shows one at a time rather than a different set of controls.
  const fields: Record<StepKey, () => ReactElement> = {
    describe: () => (
      <div className="ai-field">
        <h2 className="ai-q">{t('ai.describe_label')}</h2>
        <textarea
          className="ai-textarea"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('ai.describe_placeholder')}
          maxLength={2000}
        />
      </div>
    ),

    days: () => (
      <div className="ai-field ai-field--wide">
        <div className="ai-field">
          <h2 className="ai-q">{t('ai.days_label')}</h2>
          <div className="ai-stepper">
            <button
              type="button"
              aria-label={t('ai.fewer_days')}
              onClick={() => setWorkoutDays(d => clamp(d - 1, MIN_WORKOUT_DAYS, MAX_WORKOUT_DAYS))}
            >
              <Minus size={20} />
            </button>
            <span className="ai-stepper-value">{workoutDays}</span>
            <button
              type="button"
              aria-label={t('ai.more_days')}
              onClick={() => setWorkoutDays(d => clamp(d + 1, MIN_WORKOUT_DAYS, MAX_WORKOUT_DAYS))}
            >
              <Plus size={20} />
            </button>
            <span className="ai-note">{t('ai.weeks_hint', { count: approxWeeks })}</span>
          </div>
          <p className="ai-note">{t('ai.days_hint')}</p>
        </div>

        <div className="ai-field">
          <div className="ai-rhythm-head">
            <div className="ai-rhythm-title">{t('plans.builder_pattern')}</div>
            <div className="rx-seg">
              <button type="button" className={!patternCustom ? 'is-on' : ''} onClick={() => setPatternCustom(false)}>
                {t('plans.pattern_default')}
              </button>
              <button type="button" className={patternCustom ? 'is-on' : ''} onClick={() => setPatternCustom(true)}>
                {t('plans.pattern_custom')}
              </button>
            </div>
          </div>
          <div className={`ai-rhythm${patternCustom ? '' : ' is-locked'}`}>
            {workoutPattern.map((value, index) => (
              <button
                key={index}
                type="button"
                className={`ai-rhythm-day${value ? ' is-work' : ''}`}
                disabled={!patternCustom}
                onClick={() => {
                  const next = workoutPattern.map((v, i) => (i === index ? (v ? 0 : 1) : v));
                  // A rhythm with no training day could never place a workout.
                  if (isUsablePattern(next)) setWorkoutPattern(next);
                }}
              >
                <span>{index + 1}</span>
                {value ? <Dumbbell size={17} /> : <Moon size={17} />}
              </button>
            ))}
          </div>
          {/* The cycle can grow or shrink, so a plan isn't stuck with a seven-day week. */}
          <div className="pb-cycle">
            <span>{t('settings.workout_days_in_every', { count: patternWorkoutDays })}</span>
            <div className="pb-stepper">
              <button
                type="button"
                aria-label={t('settings.remove_day')}
                disabled={!patternCustom || workoutPattern.length <= 1 || !workoutPattern.slice(0, -1).some(v => v === 1)}
                onClick={() => setWorkoutPattern(workoutPattern.slice(0, -1))}
              >
                <Minus size={15} />
              </button>
              <span>{workoutPattern.length}</span>
              <button
                type="button"
                aria-label={t('settings.add_day')}
                disabled={!patternCustom || workoutPattern.length >= 14}
                onClick={() => setWorkoutPattern([...workoutPattern, 1])}
              >
                <Plus size={15} />
              </button>
            </div>
            <span>{t('settings.days_unit')}</span>
          </div>
          <p className="ai-note">{t('ai.pattern_hint')}</p>
        </div>
      </div>
    ),

    // A slider rather than a number box: session length is a feel judgement,
    // and the named bands give it meaning without forcing a choice between
    // fixed presets.
    minutes: () => (
      <div className="ai-field">
        <h2 className="ai-q">{t('ai.minutes_label')}</h2>
        <div className="ai-minutes">
          <span className="ai-minutes-value">{maxMinutes}</span>
          <span className="ai-minutes-unit">{t('ai.minutes_unit')}</span>
          <span className="ai-band">{t(sessionBand(maxMinutes))}</span>
        </div>
        <div className="ai-slider-wrap">
          <input
            className="ai-slider"
            type="range"
            min={MIN_SESSION}
            max={MAX_SESSION}
            step={5}
            value={maxMinutes}
            // How far along the track the thumb is, for the filled part.
            style={{ ['--f' as string]: (maxMinutes - MIN_SESSION) / (MAX_SESSION - MIN_SESSION) }}
            onChange={e => setMaxMinutes(clamp(Number(e.target.value), MIN_SESSION, MAX_SESSION))}
          />
          {SESSION_MARKS.map(mark => (
            <button
              type="button"
              key={mark}
              className={`ai-tick${maxMinutes === mark ? ' is-on' : ''}`}
              style={{ ['--f' as string]: (mark - MIN_SESSION) / (MAX_SESSION - MIN_SESSION) }}
              onClick={() => setMaxMinutes(mark)}
            >
              {mark}
            </button>
          ))}
        </div>
        <p className="ai-note">{t('ai.minutes_hint')}</p>
      </div>
    ),

    equipment: () => (
      <div className="ai-field">
        <div>
          <h2 className="ai-q">{t('ai.equipment_label')} <span className="ai-optional">{t('ai.optional')}</span></h2>
          <p className="ai-note">{t('ai.equipment_hint')}</p>
        </div>
        <div className="ai-chips">
          {EQUIPMENT_ITEMS.map(item => {
            const on = equipment.includes(item.id);
            return (
              <button
                type="button"
                key={item.id}
                className={`ai-chip ai-chip--gear${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(equipment, item.id, setEquipment)}
              >
                {on && <Check size={14} />}
                {labels.equipment(item.id)}
              </button>
            );
          })}
        </div>
        {chipCount(equipment.length, () => setEquipment([]))}
      </div>
    ),

    styles: () => (
      <div className="ai-field">
        <div>
          <h2 className="ai-q">{t('ai.styles_label')}</h2>
          <p className="ai-note">{t('ai.pick_one')}</p>
        </div>
        <div className="ai-chips">
          {TRAINING_TYPES.map(type => {
            const on = trainingTypes.includes(type);
            return (
              <button
                type="button"
                key={type}
                className={`ai-chip ai-chip--type${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(trainingTypes, type, setTrainingTypes)}
              >
                {on && <Check size={14} />}
                {labels.trainingType(type)}
              </button>
            );
          })}
        </div>
        {chipCount(trainingTypes.length, () => setTrainingTypes([]))}
      </div>
    ),

    focus: () => (
      <div className="ai-field">
        <div>
          <h2 className="ai-q">{t('ai.focus_label')}</h2>
          <p className="ai-note">{t('ai.pick_one')}</p>
        </div>
        <div className="ai-chips">
          {BODY_PARTS.map(part => {
            const on = bodyParts.includes(part);
            return (
              <button
                type="button"
                key={part}
                className={`ai-chip ai-chip--body${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggle(bodyParts, part, setBodyParts)}
              >
                {on && <Check size={14} />}
                {labels.bodyPart(part)}
              </button>
            );
          })}
        </div>
        {chipCount(bodyParts.length, () => setBodyParts([]))}
      </div>
    ),

    intensity: () => (
      <div className="ai-field">
        <h2 className="ai-q">{t('ai.intensity_label')}</h2>
        <div className="ai-intensities">
          {[{ value: '', label: t('ai.any'), Icon: Shuffle }, ...INTENSITIES.map(level => ({
            value: level as string,
            label: labels.intensity(level),
            Icon: INTENSITY_ICONS[level],
          }))].map(({ value, label, Icon }) => (
            <button
              type="button"
              key={value || 'any'}
              className={`ai-intensity${intensity === value ? ' is-on' : ''}`}
              aria-pressed={intensity === value}
              onClick={() => setIntensity(value)}
            >
              <Icon size={22} />
              {label}
            </button>
          ))}
        </div>
      </div>
    ),

    // Same set the Library page shows, so people recognise their albums by the
    // cover before they read the name.
    albums: () => (
      <div className="ai-field">
        <div>
          <h2 className="ai-q">{t('ai.albums_label')} <span className="ai-optional">{t('ai.optional')}</span></h2>
          <p className="ai-note">{t('ai.albums_hint')}</p>
        </div>
        <div className="ai-album-summary"><Library size={16} />{albumSummary}</div>
        <div className="ai-albums">
          {albums.map(album => {
            const state = albumStates[album.key];
            const dimmed = state === 'exclude' || (anyIncluded && state !== 'include');
            return (
              <div key={album.key}>
              <div className={`ai-album${dimmed ? ' is-dim' : ''}`}>
                <div className={`ai-album-cover${album.cover ? '' : ' is-empty'}`}>
                  {album.cover ? <img src={album.cover} alt="" /> : <img src="/logo.png" alt="" />}
                </div>
                <div className="ai-album-text">
                  <div className="ai-album-name" title={album.title}>{album.title}</div>
                  <div className="ai-album-meta">
                    {state === 'include' && album.subs.length > 0
                      ? t('ai.album_videos_of', { count: albumVideoCount(album), total: album.count })
                      : t('ai.album_videos', { count: album.count })}
                    {album.subs.some(s => !s.loose) && ` · ${t('ai.album_subfolders', { count: album.subs.filter(s => !s.loose).length })}`}
                  </div>
                </div>
                <div className="rx-seg rx-seg--sm ai-album-seg">
                  <button
                    type="button"
                    className={state === 'include' ? 'is-on is-in' : ''}
                    aria-pressed={state === 'include'}
                    aria-label={t('ai.include')}
                    onClick={() => setAlbum(album.key, 'include')}
                  >
                    <Check size={14} /><span>{t('ai.include')}</span>
                  </button>
                  <button
                    type="button"
                    className={state === 'exclude' ? 'is-on is-out' : ''}
                    aria-pressed={state === 'exclude'}
                    aria-label={t('ai.skip')}
                    onClick={() => setAlbum(album.key, 'exclude')}
                  >
                    <Ban size={14} /><span>{t('ai.skip')}</span>
                  </button>
                </div>
              </div>
              {state === 'include' && album.subs.length > 0 && (
                <div className="ai-subs">
                  <div className="ai-subs-title">{t('ai.use_from', { name: album.title })}</div>
                  {album.subs.map(sub => {
                    const on = !folderOff[sub.key];
                    return (
                      <button
                        type="button"
                        key={sub.key}
                        className="ai-sub"
                        aria-pressed={on}
                        onClick={() => setFolderOff(prev => ({ ...prev, [sub.key]: on }))}
                      >
                        <span className={`ai-sub-box${on ? ' is-on' : ''}`}>{on && <Check size={13} />}</span>
                        {sub.loose ? <FileVideo size={15} /> : <Folder size={15} />}
                        <span className="ai-sub-label">{sub.loose ? t('ai.videos_directly_in', { name: album.title }) : sub.label}</span>
                        <span className="ai-sub-count">{sub.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              </div>
            );
          })}
        </div>
      </div>
    ),
  };

  const isLastStep = stepIndex >= steps.length - 1;
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];

  const stepLabel =
    phase === 'gen' ? t('ai.phase_generating')
    : phase === 'done' ? t('ai.phase_ready')
    : guided ? t('plans.builder_step', { current: stepIndex + 1, total: steps.length })
    : t('ai.builder_intro');

  const summaryRows: { key: StepKey; label: string; value: string }[] = [
    { key: 'describe', label: t('ai.summary_goal'), value: description.trim() },
    { key: 'days', label: t('ai.summary_days'), value: t('ai.summary_days_value', { days: workoutDays, count: patternWorkoutDays, total: cycleLength }) },
    { key: 'minutes', label: t('ai.summary_minutes'), value: `${maxMinutes} ${t('ai.minutes_unit')} · ${t(sessionBand(maxMinutes))}` },
    { key: 'equipment', label: t('ai.summary_equipment'), value: equipment.length ? equipment.map(labels.equipment).join(', ') : t('ai.summary_anything') },
    { key: 'styles', label: t('ai.summary_styles'), value: trainingTypes.map(labels.trainingType).join(', ') },
    { key: 'focus', label: t('ai.summary_focus'), value: bodyParts.map(labels.bodyPart).join(', ') },
    { key: 'intensity', label: t('ai.intensity_label'), value: intensity ? labels.intensity(intensity) : t('ai.any') },
    ...(steps.includes('albums') ? [{ key: 'albums' as StepKey, label: t('ai.albums_label'), value: albumSummary }] : []),
  ];

  return createPortal(
    <div className="ai-overlay">
      <div className="ai-card" role="dialog" aria-modal="true" aria-label={t('ai.builder_title')}>
        <div className="ai-head">
          <div className="ai-head-row">
            <div className="ai-head-icon"><Sparkles size={19} /></div>
            <div className="ai-head-text">
              <div className="ai-head-title">{t('ai.builder_title')}</div>
              <div className="ai-head-sub">{stepLabel}</div>
            </div>
            <button type="button" className="ai-close" onClick={onClose} disabled={loading} aria-label={t('ai.close')}>
              <X size={18} />
            </button>
          </div>
          {phase === 'form' && guided && (
            <div className="ai-bars">
              {steps.map((key, index) => (
                <button
                  type="button"
                  key={key}
                  className={`ai-bar${index <= stepIndex ? ' is-done' : ''}`}
                  disabled={index >= stepIndex}
                  onClick={() => setStepIndex(index)}
                  aria-label={t('plans.builder_step', { current: index + 1, total: steps.length })}
                />
              ))}
            </div>
          )}
        </div>

        <div className={`ai-body${phase === 'form' && !guided ? ' ai-body--all' : ''}`}>
          {phase === 'form' && (
            guided ? fields[currentStep]() : steps.map(key => <div key={key}>{fields[key]()}</div>)
          )}

          {phase === 'form' && !guided && !canGenerate && (
            <p className="ai-note">{t('ai.required_hint')}</p>
          )}

          {phase === 'gen' && (
            <div className="ai-gen">
              <div className="ai-spinner" />
              <div className="ai-gen-title">{t('ai.drafting')}</div>
              <div className="ai-gen-note">
                {t('ai.drafting_note', { days: workoutDays, minutes: maxMinutes, videos: usableVideos })}
              </div>
              <div className="ai-gen-note">{t('ai.generating_hint')}</div>
            </div>
          )}

          {phase === 'done' && (
            <div className="ai-field">
              <PartyPopper size={44} className="ai-party" />
              <h2 className="ai-q">{t('ai.draft_ready')}</h2>
              {draftDays.length > 0 && (
                <div className="ai-preview">
                  <div className="ai-preview-head">
                    <span>{t('ai.preview_title')}</span>
                    <em>{t('ai.preview_days', { count: draftDays.length })}</em>
                  </div>
                  <div className="ai-preview-strip">
                    {draftDays.map((day, i) => {
                      const first = day.videos[0];
                      const total = day.videos.reduce((s, v) => s + (v.duration_seconds || 0), 0);
                      const dur = formatDuration(total);
                      return (
                        <div key={i} className="ai-pv">
                          <div className="ai-pv-thumb">
                            {first?.thumbnail_path ? <img src={`/thumbnails/${first.thumbnail_path}`} alt="" loading="lazy" /> : null}
                            <span className="ai-pv-badge">{t('plans.details_day_n', { n: i + 1 })}</span>
                            {dur && <span className="ai-pv-dur">{dur}</span>}
                            {day.videos.length > 1 && <span className="ai-pv-count">{t('ai.preview_videos', { count: day.videos.length })}</span>}
                          </div>
                          <div className="ai-pv-title">{first ? stripVideoExt(first.filename) : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="ai-summary">
                {summaryRows.map(row => (
                  <div key={row.key} className="ai-summary-row">
                    <span className="ai-summary-k">{row.label}</span>
                    <span className="ai-summary-v">{row.value || '—'}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="ai-restart" onClick={startOver}>
                <RotateCcw size={14} />{t('ai.start_over')}
              </button>
            </div>
          )}

          {error && <p className="ai-error" role="alert">{error}</p>}
        </div>

        {phase !== 'gen' && (
          <div className="ai-foot">
            {phase === 'done' ? (
              <>
                <button type="button" className="ai-back" disabled={saving} onClick={() => draft && onGenerated(draft)}>
                  {t('ai.open_in_builder')}
                  <ArrowRight size={16} />
                </button>
                <span className="ai-foot-spacer" />
                <button type="button" className="ai-next" disabled={saving || draftDays.length === 0} onClick={saveDraft}>
                  <Check size={16} />
                  {saving ? t('ai.saving') : t('ai.save_plan')}
                </button>
              </>
            ) : guided ? (
              <>
                {stepIndex > 0 && (
                  <button type="button" className="ai-back" onClick={() => setStepIndex(i => Math.max(0, i - 1))}>
                    <ArrowLeft size={16} />{t('plans.builder_back')}
                  </button>
                )}
                <span className="ai-foot-spacer" />
                <button
                  type="button"
                  className="ai-next"
                  disabled={!stepAnswered(currentStep) || (isLastStep && !canGenerate)}
                  onClick={() => (isLastStep ? handleGenerate() : setStepIndex(i => Math.min(steps.length - 1, i + 1)))}
                >
                  {isLastStep ? t('ai.generate') : t('plans.builder_next')}
                  {isLastStep ? <Sparkles size={16} /> : <ArrowRight size={16} />}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="ai-back" onClick={onClose}>{t('plans.builder_cancel')}</button>
                <span className="ai-foot-spacer" />
                <button type="button" className="ai-next" disabled={!canGenerate} onClick={handleGenerate}>
                  {t('ai.generate')}
                  <Sparkles size={16} />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/**
 * Convert the server's draft into builder weeks.
 *
 * Ids are re-checked against the library here even though the server already
 * validated them: the builder renders a day straight from these ids, and an id
 * it cannot resolve would show as a nameless row and then silently disappear on
 * save — so the plan the user reviewed would not be the plan they saved.
 */
function toBuilderWeeks(
  data: any,
  videos: Video[],
  requestedWorkoutDays: number,
  workoutPattern: number[] | null
): AiPlanResult {
  const known = new Set(videos.map(v => v.id));
  const dropped = new Set<string>(Array.isArray(data?.droppedIds) ? data.droppedIds : []);

  const weeks: BuilderWeek[] = (Array.isArray(data?.weeks) ? data.weeks : []).map(
    (week: any, weekIndex: number) => {
      const base = createWeek(weekIndex + 1);
      const days = Array.isArray(week?.days) ? week.days : [];

      return {
        ...base,
        days: base.days.map((day, dayIndex) => {
          const raw: string[] = Array.isArray(days[dayIndex]?.videoIds) ? days[dayIndex].videoIds : [];
          const videoIds = raw.filter((id: string) => {
            if (known.has(id)) return true;
            dropped.add(id);
            return false;
          });
          return { ...day, videoIds };
        }),
      };
    }
  );

  return {
    weeks: weeks.length > 0 ? weeks : [createWeek(1)],
    name: typeof data?.name === 'string' ? data.name.trim() : '',
    summary: typeof data?.summary === 'string' ? data.summary : '',
    droppedIds: Array.from(dropped),
    candidateCount: Number(data?.candidateCount) || 0,
    truncated: Boolean(data?.truncated),
    requestedWorkoutDays,
    workoutDayCount: Number(data?.workoutDayCount) || 0,
    workoutPattern,
  };
}

/**
 * The album's cover image.
 *
 * Prefers the one the user set on the Library page — that lives in
 * localStorage under the same key the Library reads — so an album the user has
 * given a picture to looks like itself here too. Otherwise the first video's
 * thumbnail stands in, exactly as the Library does.
 */
function albumCover(key: string, video: Video): string | null {
  try {
    const stored = localStorage.getItem(`albumImage:${key}`);
    if (stored) return stored;
  } catch {
    /* localStorage unavailable — fall back to the thumbnail */
  }
  return video.thumbnail_path ? `/thumbnails/${video.thumbnail_path}` : null;
}

/**
 * A readable name for an album key. Imported albums carry their playlist title
 * on every video; folder albums are named after the folder, and `'.'` is the
 * library root.
 */
function albumTitle(key: string, video: Video, t: (k: string, o?: any) => string): string {
  if (isExternalAlbumKey(key)) {
    return video.external_playlist_title || t('ai.album_imported');
  }
  return key === '.' ? t('ai.album_root') : key;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}
