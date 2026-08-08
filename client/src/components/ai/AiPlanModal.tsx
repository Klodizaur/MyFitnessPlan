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
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import EquipmentPicker from '../EquipmentPicker';
import { BODY_PARTS, INTENSITIES, TRAINING_TYPES } from '../../lib/metadata';
import { useMetaLabels } from '../../lib/labels';
import { albumKeyForVideo, isExternalAlbumKey } from '../../lib/paths';
import { BuilderWeek, createWeek } from '../../lib/builderModel';
import { Video } from '../../types/video';
import '../../styles/AiPlan.css';

/** What the server drafted, translated into the builder's own shape. */
export interface AiPlanResult {
  weeks: BuilderWeek[];
  summary: string;
  /** Ids the model returned that no longer exist; dropped before handoff. */
  droppedIds: string[];
  candidateCount: number;
  truncated: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerated: (result: AiPlanResult) => void;
}

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

/** Albums are either included, excluded, or unconstrained. */
type AlbumState = 'include' | 'exclude';

interface AlbumOption {
  key: string;
  title: string;
  count: number;
}

export default function AiPlanModal({ open, onClose, onGenerated }: Props) {
  const { t } = useTranslation();
  const labels = useMetaLabels();

  const [description, setDescription] = useState('');
  const [weeks, setWeeks] = useState(4);
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [maxMinutes, setMaxMinutes] = useState(45);
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingTypes, setTrainingTypes] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState('');
  const [albumStates, setAlbumStates] = useState<Record<string, AlbumState>>({});

  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        continue;
      }
      byKey.set(key, { key, title: albumTitle(key, video, t), count: 1 });
    }
    return Array.from(byKey.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [videos, t]);

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
          weeks,
          daysPerWeek,
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

      onGenerated(toBuilderWeeks(data, videos));
      setLoading(false);
    } catch {
      setError(t('ai.error_unreachable'));
      setLoading(false);
    }
  };

  return createPortal(
    <div className="wb-overlay">
      <div className="wb-modal ai-modal">
        <div className="wb-header">
          <div>
            <h2 className="wb-title">{t('ai.builder_title')}</h2>
            <p className="wb-subtitle">{t('ai.builder_intro')}</p>
            <p className="wb-subtitle wb-subtitle-sm">{t('ai.builder_note')}</p>
          </div>
          <button className="wb-close" onClick={onClose} disabled={loading}>✕</button>
        </div>

        <div className="wb-form">
          <div className="wb-field">
            <label className="wb-label">{t('ai.describe_label')}</label>
            <textarea
              className="wb-input ai-textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t('ai.describe_placeholder')}
              rows={4}
              maxLength={2000}
            />
          </div>

          <div className="ai-number-row">
            <div className="wb-field">
              <label className="wb-label">{t('ai.weeks_label')}</label>
              <input
                className="wb-input"
                type="number"
                min={1}
                max={12}
                value={weeks}
                onChange={e => setWeeks(clamp(Number(e.target.value), 1, 12))}
              />
            </div>
            <div className="wb-field">
              <label className="wb-label">{t('ai.days_label')}</label>
              <input
                className="wb-input"
                type="number"
                min={1}
                max={7}
                value={daysPerWeek}
                onChange={e => setDaysPerWeek(clamp(Number(e.target.value), 1, 7))}
              />
            </div>
          </div>

          {/* A slider rather than a number box: session length is a feel
              judgement, and the named bands give it meaning without forcing a
              choice between fixed presets. */}
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
                  onClick={() => setMaxMinutes(mark)}
                >
                  {mark}
                </button>
              ))}
            </div>
            <p className="ai-hint">{t('ai.minutes_hint')}</p>
          </div>

          <div className="wb-field">
            <label className="wb-label">{t('ai.equipment_label')}</label>
            <p className="ai-hint">{t('ai.equipment_hint')}</p>
            <EquipmentPicker selected={equipment} onChange={setEquipment} />
          </div>

          <div className="wb-field">
            <label className="wb-label">{t('ai.styles_label')}</label>
            <div className="wb-chip-row">
              {TRAINING_TYPES.map(type => (
                <button
                  type="button"
                  key={type}
                  className={`wb-chip${trainingTypes.includes(type) ? ' selected' : ''}`}
                  onClick={() => toggle(trainingTypes, type, setTrainingTypes)}
                >
                  {labels.trainingType(type)}
                </button>
              ))}
            </div>
          </div>

          <div className="wb-field">
            <label className="wb-label">{t('ai.focus_label')}</label>
            <div className="wb-chip-row">
              {BODY_PARTS.map(part => (
                <button
                  type="button"
                  key={part}
                  className={`wb-chip${bodyParts.includes(part) ? ' selected' : ''}`}
                  onClick={() => toggle(bodyParts, part, setBodyParts)}
                >
                  {labels.bodyPart(part)}
                </button>
              ))}
            </div>
          </div>

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
                  {labels.intensity(level)}
                </button>
              ))}
            </div>
          </div>

          {albums.length > 1 && (
            <div className="wb-field">
              <label className="wb-label">{t('ai.albums_label')}</label>
              <p className="ai-hint">{t('ai.albums_hint')}</p>
              <div className="wb-chip-row">
                {albums.map(album => (
                  <button
                    type="button"
                    key={album.key}
                    className={`wb-chip ai-album-chip ai-album-${albumStates[album.key] || 'neutral'}`}
                    onClick={() => cycleAlbum(album.key)}
                  >
                    {albumStates[album.key] === 'include' && <span aria-hidden="true">✓ </span>}
                    {albumStates[album.key] === 'exclude' && <span aria-hidden="true">✕ </span>}
                    {album.title}
                    <span className="ai-album-count">{album.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="ai-error">{error}</p>}

          <div className="wb-actions">
            <button className="wb-btn wb-btn-ghost" onClick={onClose} disabled={loading}>
              {t('plans.builder_cancel')}
            </button>
            <button className="wb-btn wb-btn-primary" onClick={handleGenerate} disabled={loading}>
              {loading ? t('ai.generating') : t('ai.generate')}
            </button>
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
function toBuilderWeeks(data: any, videos: Video[]): AiPlanResult {
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
    summary: typeof data?.summary === 'string' ? data.summary : '',
    droppedIds: Array.from(dropped),
    candidateCount: Number(data?.candidateCount) || 0,
    truncated: Boolean(data?.truncated),
  };
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
