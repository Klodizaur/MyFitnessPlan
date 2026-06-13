import { useEffect, useState } from 'react';
import EquipmentPicker from './EquipmentPicker';
import { Video } from '../types/video';

type Props = {
  video: Video;
  onClose: () => void;
  onSaved: (video: Video) => void;
};

export default function VideoMetadataEditor({ video, onClose, onSaved }: Props) {
  const [description, setDescription] = useState(video.description || '');
  const [equipment, setEquipment] = useState<string[]>(video.equipment || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDescription(video.description || '');
    setEquipment(video.equipment || []);
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
        body: JSON.stringify({ description, equipment }),
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
          maxWidth: 520,
          padding: '1.5rem',
          maxHeight: '90vh',
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
            rows={4}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid var(--glass-border)',
              background: 'var(--surface-hover)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-family)',
              fontSize: '0.95rem',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </label>

        <div style={{ marginBottom: '1.5rem' }}>
          <span style={{ display: 'block', fontWeight: 700, marginBottom: 10, fontSize: '0.9rem' }}>Equipment</span>
          <EquipmentPicker selected={equipment} onChange={setEquipment} />
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
