/**
 * The "Build with AI" entry point: describe what you want, pick constraints,
 * generate.
 *
 * This modal is only the front half of plan creation. It never saves anything —
 * it hands the generated weeks to the existing workout builder, which is where
 * the user reviews, edits and saves them exactly as they would a plan they
 * built by hand. Hidden entirely unless the server reports a configured model,
 * so an install without a key looks like an install without the feature.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import EquipmentPicker from '../EquipmentPicker';
import {
  BODY_PARTS,
  BodyPartIcon,
  INTENSITIES,
  IntensityIcon,
  TRAINING_TYPES,
  TrainingTypeIcon,
} from '../../lib/metadata';
import { useMetaLabels } from '../../lib/labels';
import { albumKeyForVideo, isExternalAlbumKey } from '../../lib/paths';
import YouTubeBadge from '../YouTubeBadge';
import WorkoutPatternPicker, { DEFAULT_PATTERN } from '../WorkoutPatternPicker';
import { BuilderWeek, createWeek } from '../../lib/builderModel';
import { Video } from '../../types/video';
import '../../styles/AiPlan.css';

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

/**
 * The questions the form asks, in the order the guided flow walks them.
 *
 * Both modes render the same set — 'all' lays them out on one page, 'guided'
 * shows one at a time — so there is never a field you can only reach one way.
 */
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
 * Which questions must be answered before a plan can be generated.
 *
 * Equipment and albums are the exceptions, and deliberately so: both are
 * filters where "nothing selected" is a real, useful answer — everything is
 * allowed. Every other question shapes the plan, and leaving it blank just
 * hands the model less to work with. The rest of the fields (day count, session
 * length, intensity) always hold a value, so only the free-text and multi-select
 * ones need checking.
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
}

export default function AiPlanModal({ open, onClose, onGenerated }: Props) {
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

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

  const albums = useMemo<AlbumOption[]>(() => {
    const byKey = new Map<string, AlbumOption>();
    for (const video of videos) {
      const key = albumKeyForVideo(video);
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
      });
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
        // Day count, session length and intensity always carry a value.
        return true;
    }
  };

  const missingSteps = steps.filter(key => !stepAnswered(key));
  const canGenerate = missingSteps.length === 0;

  if (!open) return null;

  /** Neutral → include → exclude → neutral, so one chip covers both intents. */
  const cycleAlbum = (key: string) => {
    setAlbumStates(prev => {
      const next = { ...prev };
      if (!next[key]) next[key] = 'include';
      else if (next[key] === 'include') next[key] = 'exclude';
      else delete next[key];
      return next;
    });
  };

  const toggle = (list: string[], value: string, set: (next: string[]) => void) => {
    set(list.includes(value) ? list.filter(item => item !== value) : [...list, value]);
  };

  const handleGenerate = async () => {
    setLoading(true);
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
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || t('ai.error_generic'));
        setLoading(false);
        return;
      }

      onGenerated(toBuilderWeeks(data, videos, workoutDays, patternCustom ? workoutPattern : null));
      setLoading(false);
    } catch {
      setError(t('ai.error_unreachable'));
      setLoading(false);
    }
  };

  // Every field the form can ask for, each rendered the same way in both modes —
  // the guided flow shows one at a time rather than a different set of controls.
  const fields: Record<StepKey, () => ReactElement> = {
    describe: () => (
      <div className="wb-field">
        <label className="wb-label">{t('ai.describe_label')} <span className="ai-required">*</span></label>
        <textarea
          className="wb-input ai-textarea"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder={t('ai.describe_placeholder')}
          rows={4}
          maxLength={2000}
        />
      </div>
    ),

    days: () => (
      <div className="wb-field">
        <label className="wb-label">{t('ai.days_label')}</label>
        <input
          className="wb-input"
          type="number"
          min={MIN_WORKOUT_DAYS}
          max={MAX_WORKOUT_DAYS}
          value={workoutDays}
          onChange={e =>
            setWorkoutDays(clamp(Number(e.target.value), MIN_WORKOUT_DAYS, MAX_WORKOUT_DAYS))
          }
        />
        <p className="ai-hint">{t('ai.days_hint')}</p>

        <label className="wb-label" style={{ marginTop: 14 }}>{t('plans.builder_pattern')}</label>
        <div className="wb-chip-row">
          <button
            type="button"
            className={`wb-chip${patternCustom ? '' : ' selected'}`}
            onClick={() => setPatternCustom(false)}
          >
            {t('plans.pattern_default')}
          </button>
          <button
            type="button"
            className={`wb-chip${patternCustom ? ' selected' : ''}`}
            onClick={() => setPatternCustom(true)}
          >
            {t('plans.pattern_custom')}
          </button>
        </div>
        <WorkoutPatternPicker
          pattern={workoutPattern}
          onChange={setWorkoutPattern}
          disabled={!patternCustom}
        />
        <p className="ai-hint">{t('ai.pattern_hint')}</p>
      </div>
    ),

    // A slider rather than a number box: session length is a feel judgement,
    // and the named bands give it meaning without forcing a choice between
    // fixed presets.
    minutes: () => (
      <div className="wb-field">
        <label className="wb-label">
          {t('ai.minutes_label')}
          <span className="ai-slider-value">
            {maxMinutes} {t('ai.minutes_unit')} · {t(sessionBand(maxMinutes))}
          </span>
        </label>
        <input
          className="ai-slider"
          type="range"
          min={MIN_SESSION}
          max={MAX_SESSION}
          step={5}
          value={maxMinutes}
          onChange={e => setMaxMinutes(clamp(Number(e.target.value), MIN_SESSION, MAX_SESSION))}
        />
        <div className="ai-slider-ticks">
          {SESSION_MARKS.map(mark => (
            <button
              type="button"
              key={mark}
              className={`ai-slider-tick${maxMinutes === mark ? ' selected' : ''}`}
              style={{
                left: `${((mark - MIN_SESSION) / (MAX_SESSION - MIN_SESSION)) * 100}%`,
              }}
              onClick={() => setMaxMinutes(mark)}
            >
              {mark}
            </button>
          ))}
        </div>
        <p className="ai-hint">{t('ai.minutes_hint')}</p>
      </div>
    ),

    equipment: () => (
      <div className="wb-field">
        <label className="wb-label">
          {t('ai.equipment_label')} <span className="ai-optional">{t('ai.optional')}</span>
        </label>
        <p className="ai-hint">{t('ai.equipment_hint')}</p>
        <EquipmentPicker selected={equipment} onChange={setEquipment} />
      </div>
    ),

    styles: () => (
      <div className="wb-field">
        <label className="wb-label">{t('ai.styles_label')} <span className="ai-required">*</span></label>
        <div className="wb-chip-row">
          {TRAINING_TYPES.map(type => (
            <button
              type="button"
              key={type}
              className={`wb-chip${trainingTypes.includes(type) ? ' selected' : ''}`}
              onClick={() => toggle(trainingTypes, type, setTrainingTypes)}
            >
              <TrainingTypeIcon type={type} />
              <span>{labels.trainingType(type)}</span>
            </button>
          ))}
        </div>
      </div>
    ),

    focus: () => (
      <div className="wb-field">
        <label className="wb-label">{t('ai.focus_label')} <span className="ai-required">*</span></label>
        <div className="wb-chip-row">
          {BODY_PARTS.map(part => (
            <button
              type="button"
              key={part}
              className={`wb-chip${bodyParts.includes(part) ? ' selected' : ''}`}
              onClick={() => toggle(bodyParts, part, setBodyParts)}
            >
              <BodyPartIcon part={part} />
              <span>{labels.bodyPart(part)}</span>
            </button>
          ))}
        </div>
      </div>
    ),

    intensity: () => (
      <div className="wb-field">
        <label className="wb-label">{t('ai.intensity_label')}</label>
        <div className="wb-chip-row">
          <button
            type="button"
            className={`wb-chip${intensity === '' ? ' selected' : ''}`}
            onClick={() => setIntensity('')}
          >
            {t('ai.any')}
          </button>
          {INTENSITIES.map(level => (
            <button
              type="button"
              key={level}
              className={`wb-chip${intensity === level ? ' selected' : ''}`}
              onClick={() => setIntensity(level)}
            >
              <IntensityIcon level={level} />
              <span>{labels.intensity(level)}</span>
            </button>
          ))}
        </div>
      </div>
    ),

    // Albums are shown as cover art rather than text chips: this is the same
    // set the Library page displays, and people recognise their albums by the
    // picture long before they read the name.
    albums: () => (
      <div className="wb-field">
        <label className="wb-label">
          {t('ai.albums_label')} <span className="ai-optional">{t('ai.optional')}</span>
        </label>
        <p className="ai-hint">{t('ai.albums_hint')}</p>
        <div className="ai-album-grid">
          {albums.map(album => {
            const state = albumStates[album.key];
            return (
              <button
                type="button"
                key={album.key}
                className={`ai-album-card ai-album-${state || 'neutral'}`}
                aria-pressed={state === 'include'}
                title={album.title}
                onClick={() => cycleAlbum(album.key)}
              >
                <span className="ai-album-cover">
                  {album.cover ? (
                    <img src={album.cover} alt="" />
                  ) : (
                    <span className="ai-album-nocover">{album.count}</span>
                  )}
                  <span className="ai-album-count">{album.count}</span>
                  {album.isExternal && <YouTubeBadge />}
                  {state && (
                    <span className="ai-album-state" aria-hidden="true">
                      {state === 'include' ? '✓' : '✕'}
                    </span>
                  )}
                  <span className="ai-album-title">{album.title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ),
  };

  const isLastStep = stepIndex >= steps.length - 1;

  return createPortal(
    <div className="wb-overlay">
      <div className="wb-modal ai-modal">
        <div className="wb-header">
          <div>
            <h2 className="wb-title">{t('ai.builder_title')}</h2>
            {guided ? (
              <p className="wb-subtitle">
                {t('plans.builder_step', { current: stepIndex + 1, total: steps.length })}
              </p>
            ) : (
              <>
                <p className="wb-subtitle">{t('ai.builder_intro')}</p>
                <p className="wb-subtitle wb-subtitle-sm">{t('ai.builder_note')}</p>
              </>
            )}
          </div>
          <button className="wb-close" onClick={onClose} disabled={loading}>✕</button>
        </div>

        <div className="wb-form">
          {guided ? (
            <>
              {/* Progress is worth showing when the fields are hidden from view:
                  without it there's no sense of how much is left. */}
              <div className="ai-step-progress" aria-hidden="true">
                {steps.map((key, index) => (
                  <span
                    key={key}
                    className={`ai-step-dot${index <= stepIndex ? ' done' : ''}`}
                  />
                ))}
              </div>
              {fields[steps[stepIndex]]()}
            </>
          ) : (
            steps.map(key => <div key={key}>{fields[key]()}</div>)
          )}

          {!guided && !canGenerate && (
            <p className="ai-hint">{t('ai.required_hint')}</p>
          )}

          {error && <p className="ai-error">{error}</p>}

          <div className="wb-actions">
            {guided && stepIndex > 0 ? (
              <button
                className="wb-btn wb-btn-ghost"
                onClick={() => setStepIndex(index => Math.max(0, index - 1))}
                disabled={loading}
              >
                {t('plans.builder_back')}
              </button>
            ) : (
              <button className="wb-btn wb-btn-ghost" onClick={onClose} disabled={loading}>
                {t('plans.builder_cancel')}
              </button>
            )}

            {guided && !isLastStep ? (
              <button
                className="wb-btn wb-btn-primary"
                onClick={() => setStepIndex(index => Math.min(steps.length - 1, index + 1))}
                disabled={!stepAnswered(steps[stepIndex])}
              >
                {t('plans.builder_next')}
              </button>
            ) : (
              <button
                className="wb-btn wb-btn-primary"
                onClick={handleGenerate}
                disabled={loading || !canGenerate}
              >
                {loading ? t('ai.generating') : t('ai.generate')}
              </button>
            )}
          </div>

          {loading && <p className="ai-hint ai-waiting">{t('ai.generating_hint')}</p>}
        </div>
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
