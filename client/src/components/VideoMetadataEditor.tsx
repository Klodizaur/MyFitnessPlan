import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import EquipmentPicker from './EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, prettyLabel } from '../lib/metadata';
import { Video } from '../types/video';

type Props = {
  video: Video;
  onClose: () => void;
  onSaved: (video: Video) => void;
};

function VideoMetadataEditorInner({ video, onClose, onSaved }: Props) {
  const [description, setDescription] = useState(video.description || '');
  const [equipment, setEquipment] = useState<string[]>(video.equipment || []);
  const [trainingType, setTrainingType] = useState<string>(video.training_type || '');
  const [bodyParts, setBodyParts] = useState<string[]>(video.body_parts || []);
  const [intensity, setIntensity] = useState<string>(video.intensity || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescription(video.description || '');
    setEquipment(video.equipment || []);
    setTrainingType(video.training_type || '');
    setBodyParts(video.body_parts || []);
    setIntensity(video.intensity || '');
  }, [video]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`http://localhost:3000/api/library/videos/${video.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, equipment, training_type: trainingType, body_parts: bodyParts, intensity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="video-metadata-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="glass-card video-metadata-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 860,
          padding: '1.75rem',
          maxHeight: '92vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: '1.25rem' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Video Info</h2>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {video.filename}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              border: '1px solid var(--glass-border)',
              background: 'var(--surface-hover)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <label style={{ display: 'block', marginBottom: '1.25rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Description</span>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Notes about this video — focus areas, difficulty, etc."
            rows={8}
            style={{
              width: '100%',
              minHeight: 220,
              padding: '14px 16px',
              borderRadius: 12,
              border: '1px solid var(--glass-border)',
              background: 'var(--surface-hover)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-family)',
              fontSize: '1rem',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 10, fontSize: '0.9rem' }}>Equipment</span>
          <EquipmentPicker selected={equipment} onChange={setEquipment} />
        </div>

        <div style={{ marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Training Type</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['HIIT','Cardio','Strength','Mobility','Yoga','Pilates'].map(t => {
                  const sel = trainingType === t;
                  return (
                    <button key={t} onClick={() => setTrainingType(sel ? '' : t)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'rgba(59,130,246,0.08)' : 'var(--surface-hover)', cursor: 'pointer' }} title={t}>
                      <TrainingTypeIcon type={t} />
                      <span style={{ fontSize: '0.95rem' }}>{t}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Intensity</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['low','medium','high'].map(level => {
                  const sel = intensity === level;
                  return (
                    <button key={level} onClick={() => setIntensity(sel ? '' : level)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'rgba(59,130,246,0.08)' : 'var(--surface-hover)', cursor: 'pointer' }} title={prettyLabel(level)}>
                      <IntensityIcon level={level} />
                      <span style={{ fontSize: '0.95rem', textTransform: 'capitalize' }}>{level}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 8, fontSize: '0.9rem' }}>Body Parts</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['full_body','upper_body','lower_body','core','back','legs','arms','shoulders'].map(bp => {
              const selected = bodyParts.includes(bp);
              return (
                <button key={bp} onClick={() => setBodyParts(selected ? bodyParts.filter(b => b !== bp) : [...bodyParts, bp])} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: selected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: selected ? 'rgba(59,130,246,0.12)' : 'var(--surface-hover)', cursor: 'pointer' }} title={prettyLabel(bp)}>
                  <BodyPartIcon part={bp} />
                  <span style={{ fontSize: '0.95rem' }}>{prettyLabel(bp)}</span>
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p style={{ color: 'var(--rest-color)', fontSize: '0.9rem', marginBottom: 12 }}>{error}</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 18px',
              borderRadius: 10,
              border: '1px solid var(--glass-border)',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn"
            style={{ padding: '10px 20px', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
export default function VideoMetadataEditor(props: Props) {
  if (typeof document === 'undefined') return <VideoMetadataEditorInner {...props} />;
  return createPortal(<VideoMetadataEditorInner {...props} />, document.body);
}
