import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { EQUIPMENT_ITEMS, EquipmentIcon } from '../lib/equipment';
import {
  TRAINING_TYPES,
  BODY_PARTS,
  INTENSITIES,
  TrainingTypeIcon,
  BodyPartIcon,
  IntensityIcon,
} from '../lib/metadata';
import { useMetaLabels } from '../lib/labels';
import { Video } from '../types/video';

const API = 'http://localhost:3000';

type Props = {
  /** Target day in YYYY-MM-DD (already guaranteed to be today or earlier). */
  date: string;
  onClose: () => void;
  onSaved: (date: string) => void;
};

export default function AddLogEntryModal({ date, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation();
  const labels = useMetaLabels();

  const [name, setName] = useState('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingType, setTrainingType] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<string>('');
  const [videos, setVideos] = useState<Video[]>([]);
  const [query, setQuery] = useState('');
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/library/videos`)
      .then(r => r.json())
      .then((data: Video[]) => setVideos(Array.isArray(data) ? data : []))
      .catch(() => setVideos([]));
  }, []);

  // Close on Escape for a native modal feel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    set(list.includes(value) ? list.filter(x => x !== value) : [...list, value]);
  };

  // Each selected library video is logged as its own separate entry, named after
  // the video and tagged from the video, so here we only track which are selected.
  const toggleVideo = (id: string) => {
    setSelectedVideoIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));
  };

  const videoById = useMemo(() => new Map(videos.map(v => [v.id, v])), [videos]);
  const selectedVideos = selectedVideoIds
    .map(id => videoById.get(id))
    .filter((v): v is Video => Boolean(v));

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return videos
      .filter(
        v =>
          (v.filename || '').toLowerCase().includes(q) ||
          (v.relative_path || '').toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [videos, query]);

  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, [date, i18n.language]);

  const canSave = (name.trim().length > 0 || selectedVideoIds.length > 0) && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/profile/history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          completedDate: date,
          workoutName: name.trim(),
          equipment,
          trainingType,
          bodyParts,
          intensity: intensity || null,
          videoIds: selectedVideoIds,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || t('profile.add.error'));
        setSaving(false);
        return;
      }
      onSaved(date);
    } catch {
      setError(t('profile.add.error'));
      setSaving(false);
    }
  };

  const chipButton = (
    key: string,
    selected: boolean,
    onClick: () => void,
    icon: ReactNode,
    label: string
  ) => (
    <button
      key={key}
      type="button"
      className={`wb-chip${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const jsx = (
    <div className="wb-overlay" onClick={onClose}>
      <div className="wb-modal" onClick={e => e.stopPropagation()}>
        <div className="wb-header">
          <div>
            <h2 className="wb-title">{t('profile.add.title')}</h2>
            <p className="wb-subtitle wb-subtitle-sm" style={{ textTransform: 'capitalize' }}>
              {dateLabel}
            </p>
          </div>
          <button className="wb-close" onClick={onClose} aria-label={t('profile.add.cancel')}>
            ✕
          </button>
        </div>

        <div className="wb-form">
          <div className="wb-field">
            <label className="wb-label">{t('profile.add.name_label')}</label>
            <input
              className="wb-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('profile.add.name_placeholder')}
              autoFocus
            />
            <p className="wb-subtitle wb-subtitle-sm" style={{ margin: 0 }}>{t('profile.add.name_hint')}</p>
          </div>

          <div className="wb-field">
            <label className="wb-label">{labels.sections.trainingType}</label>
            <div className="wb-chip-row">
              {TRAINING_TYPES.map(tt =>
                chipButton(
                  tt,
                  trainingType.includes(tt),
                  () => toggle(trainingType, setTrainingType, tt),
                  <TrainingTypeIcon type={tt} />,
                  labels.trainingType(tt)
                )
              )}
            </div>
          </div>

          <div className="wb-field">
            <label className="wb-label">{labels.sections.bodyParts}</label>
            <div className="wb-chip-row">
              {BODY_PARTS.map(bp =>
                chipButton(
                  bp,
                  bodyParts.includes(bp),
                  () => toggle(bodyParts, setBodyParts, bp),
                  <BodyPartIcon part={bp} />,
                  labels.bodyPart(bp)
                )
              )}
            </div>
          </div>

          <div className="wb-field">
            <label className="wb-label">{labels.sections.intensity}</label>
            <div className="wb-chip-row">
              {INTENSITIES.map(level =>
                chipButton(
                  level,
                  intensity === level,
                  () => setIntensity(intensity === level ? '' : level),
                  <IntensityIcon level={level} />,
                  labels.intensity(level)
                )
              )}
            </div>
          </div>

          <div className="wb-field">
            <label className="wb-label">{labels.sections.equipment}</label>
            <div className="wb-chip-row">
              {EQUIPMENT_ITEMS.map(item =>
                chipButton(
                  item.id,
                  equipment.includes(item.id),
                  () => toggle(equipment, setEquipment, item.id),
                  <EquipmentIcon id={item.id} size={16} />,
                  labels.equipment(item.id)
                )
              )}
            </div>
          </div>

          <div className="wb-field">
            <label className="wb-label">{t('profile.add.videos_label')}</label>
            <p className="wb-subtitle wb-subtitle-sm" style={{ margin: 0 }}>{t('profile.add.videos_hint')}</p>
            {selectedVideos.length > 0 && (
              <div className="wb-chip-row" style={{ marginBottom: 4 }}>
                {selectedVideos.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    className="wb-chip selected"
                    onClick={() => toggleVideo(v.id)}
                    title={v.filename}
                  >
                    <span
                      style={{
                        maxWidth: 200,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {v.filename}
                    </span>
                    <span aria-hidden>✕</span>
                  </button>
                ))}
              </div>
            )}
            <input
              className="wb-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('profile.add.search_placeholder')}
            />
            {query.trim() &&
              (results.length > 0 ? (
                <div
                  className="wb-videos list"
                  style={{ maxHeight: 260, overflowY: 'auto', marginTop: 8 }}
                >
                  {results.map(v => {
                    const sel = selectedVideoIds.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`wb-video-card${sel ? ' selected' : ''}`}
                        onClick={() => toggleVideo(v.id)}
                      >
                        {v.thumbnail_path ? (
                          <img
                            className="wb-video-thumb"
                            style={{ width: 84, height: 48, borderRadius: 8, flexShrink: 0 }}
                            src={`${API}/thumbnails/${v.thumbnail_path}`}
                            alt=""
                          />
                        ) : null}
                        <div className="wb-video-meta" style={{ flex: 1, minWidth: 0 }}>
                          <span className="wb-video-name">{v.filename}</span>
                          <span className="wb-video-path">{v.relative_path}</span>
                        </div>
                        <span className="wb-video-check">{sel ? '✓' : '+'}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="wb-empty" style={{ marginTop: 8 }}>
                  {t('profile.add.no_videos')}
                </p>
              ))}
          </div>

          {error && (
            <div className="wb-status" style={{ borderColor: 'var(--wb-danger-border)', color: 'var(--wb-danger)' }}>
              {error}
            </div>
          )}

          <div className="wb-actions">
            <button type="button" className="wb-btn wb-btn-ghost" onClick={onClose}>
              {t('profile.add.cancel')}
            </button>
            <button
              type="button"
              className="wb-btn wb-btn-primary wb-btn-min"
              onClick={handleSave}
              disabled={!canSave}
            >
              {saving ? t('profile.add.saving') : t('profile.add.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return jsx;
  return createPortal(jsx, document.body);
}
