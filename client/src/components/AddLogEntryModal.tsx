import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Search, SignalHigh, SignalLow, SignalMedium, X } from 'lucide-react';
import { EQUIPMENT_ITEMS } from '../lib/equipment';
import { TRAINING_TYPES, BODY_PARTS, INTENSITIES } from '../lib/metadata';
import { useMetaLabels } from '../lib/labels';
import { Video } from '../types/video';
import Modal, { CloseButton } from './modal/Modal';

const API = '';

const INTENSITY_ICONS = { low: SignalLow, medium: SignalMedium, high: SignalHigh } as const;

type Props = {
  /** Target day in YYYY-MM-DD (already guaranteed to be today or earlier). */
  date: string;
  onClose: () => void;
  onSaved: (date: string) => void;
};

/** Log a past workout: a name and/or library videos, with tags for what was done. */
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
      .filter(v => (v.filename || '').toLowerCase().includes(q) || (v.relative_path || '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [videos, query]);

  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
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

  const chipGroup = (
    label: string,
    category: 'gear' | 'type' | 'body',
    items: { value: string; label: string }[],
    selected: string[],
    set: (next: string[]) => void
  ) => (
    <div className="md-group">
      <div className="md-label">{label}</div>
      <div className="md-chips">
        {items.map(item => {
          const on = selected.includes(item.value);
          return (
            <button key={item.value} type="button" className={`md-chip md-chip--${category}${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggle(selected, set, item.value)}>
              {on && <Check size={14} />}
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <Modal width={780} onClose={onClose} busy={saving} label={t('profile.add.title')}>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title">{t('profile.add.title')}</h2>
          <div className="md-sub" style={{ textTransform: 'capitalize' }}>{dateLabel}</div>
        </div>
        <CloseButton onClick={onClose} disabled={saving} />
      </div>

      <div className="md-body" style={{ gap: 24 }}>
        <div className="md-group">
          <div className="md-label">{t('profile.add.name_label')}</div>
          <label className="md-field">
            <input value={name} onChange={e => setName(e.target.value)} placeholder={t('profile.add.name_placeholder')} autoFocus />
          </label>
          <div className="md-help">{t('profile.add.name_hint')}</div>
        </div>

        {chipGroup(labels.sections.trainingType, 'type', [...TRAINING_TYPES].map(v => ({ value: v, label: labels.trainingType(v) })), trainingType, setTrainingType)}
        {chipGroup(labels.sections.bodyParts, 'body', [...BODY_PARTS].map(v => ({ value: v, label: labels.bodyPart(v) })), bodyParts, setBodyParts)}

        <div className="md-group">
          <div className="md-label">{labels.sections.intensity}</div>
          <div className="rx-seg md-seg--wide">
            {INTENSITIES.map(level => {
              const Icon = INTENSITY_ICONS[level];
              return (
                <button key={level} type="button" className={intensity === level ? 'is-on' : ''} onClick={() => setIntensity(intensity === level ? '' : level)}>
                  <Icon size={16} />
                  {labels.intensity(level)}
                </button>
              );
            })}
          </div>
        </div>

        {chipGroup(labels.sections.equipment, 'gear', EQUIPMENT_ITEMS.map(i => ({ value: i.id, label: labels.equipment(i.id) })), equipment, setEquipment)}

        <div className="md-group">
          <div className="md-label">{t('profile.add.videos_label')}</div>
          <div className="md-help">{t('profile.add.videos_hint')}</div>
          {selectedVideos.length > 0 && (
            <div className="md-picked">
              {selectedVideos.map(v => (
                <button key={v.id} type="button" onClick={() => toggleVideo(v.id)} title={v.filename}>
                  <span>{v.filename}</span>
                  <X size={13} />
                </button>
              ))}
            </div>
          )}
          <label className="md-field">
            <Search size={17} />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('profile.add.search_placeholder')} />
          </label>
          {query.trim() && (results.length > 0 ? (
            <div className="md-results">
              {results.map(v => {
                const sel = selectedVideoIds.includes(v.id);
                return (
                  <button key={v.id} type="button" className={sel ? 'is-on' : ''} onClick={() => toggleVideo(v.id)}>
                    {v.thumbnail_path ? <img src={`${API}/thumbnails/${v.thumbnail_path}`} alt="" /> : <span className="md-results-noimg" />}
                    <span className="md-results-text">
                      <b>{v.filename}</b>
                      <em>{v.relative_path}</em>
                    </span>
                    <span className="md-results-mark">{sel ? <Check size={16} /> : <Plus size={16} />}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="md-help">{t('profile.add.no_videos')}</div>
          ))}
        </div>

        {error && <div className="md-error" role="alert">{error}</div>}
      </div>

      <div className="md-foot md-foot--line">
        <button type="button" className="md-btn" onClick={onClose} disabled={saving}>{t('profile.add.cancel')}</button>
        <button type="button" className="md-btn md-btn--primary" onClick={handleSave} disabled={!canSave} style={{ padding: '0 26px' }}>
          {saving ? t('profile.add.saving') : t('profile.add.save')}
        </button>
      </div>
    </Modal>
  );
}
