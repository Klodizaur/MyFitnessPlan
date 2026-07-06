import { useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import VideoMetadataEditor from './VideoMetadataEditor';
import { Video } from '../types/video';
import { useNavigate } from 'react-router-dom';
import { EquipmentIcon, getEquipmentItem } from '../lib/equipment';

type Props = {
  video: Video;
  onClose: () => void;
  onSaved: (video: Video) => void;
  onRequestEdit?: () => void;
};

export default function VideoDetailsModal({ video, onClose, onSaved, onRequestEdit }: Props) {
  const navigate = useNavigate();

  const handlePlay = () => {
    navigate(`/player/${video.id}`);
    onClose();
  };

  const jsx = (
    <div
      className="video-details-backdrop"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 920, maxHeight: '90vh', overflowY: 'auto', borderRadius: 14, background: 'var(--surface-color)', padding: 18, boxSizing: 'border-box', boxShadow: '0 12px 40px rgba(2,6,23,0.6)' }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 18, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ width: '100%', aspectRatio: '16/9', background: '#0b0b0b', borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {video.thumbnail_path ? (
                  <img src={`http://localhost:3000/thumbnails/${video.thumbnail_path}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ padding: 14, color: 'var(--text-secondary)' }}>{video.filename}</div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={handlePlay} className="btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--accent-color)', color: 'white', borderRadius: 10, border: 'none', fontWeight: 700, cursor: 'pointer' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" /></svg>
                  Play
                </button>

                <button onClick={() => { onClose(); onRequestEdit && onRequestEdit(); }} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--glass-border)', background: 'transparent', cursor: 'pointer', fontWeight: 600 }}>{video.description?.trim() ? 'Edit Details' : 'Add Details'}</button>
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: '1.15rem', lineHeight: 1.15 }}>{video.filename}</h3>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.relative_path}</div>
                </div>
              </div>

              <div style={{ marginTop: 14, color: 'var(--text-primary)', lineHeight: 1.6 }}>
                {video.description?.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{video.description}</ReactMarkdown>
                ) : (
                  <div style={{ color: 'var(--text-secondary)' }}>No description. Click "Add Details" to edit notes about this video.</div>
                )}
              </div>

              {video.equipment && video.equipment.length > 0 && (
                <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {video.equipment.map(id => (
                    <div key={id} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)', fontSize: '0.9rem' }} title={getEquipmentItem(id)?.label || id}>
                      <EquipmentIcon id={id} size={16} />
                      <span style={{ color: 'var(--text-primary)' }}>{getEquipmentItem(id)?.label || id}</span>
                    </div>
                  ))}
                </div>
              )}

              {(video.training_type || (video.body_parts && video.body_parts.length) || video.intensity) && (
                <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  {video.training_type && (
                    <div style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)', fontSize: '0.85rem', fontWeight: 700 }}>{video.training_type}</div>
                  )}

                  {video.body_parts && video.body_parts.length > 0 && video.body_parts.map(bp => (
                    <div key={bp} style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--surface-hover)', border: '1px solid var(--glass-border)', fontSize: '0.85rem' }}>{bp.replace('_', ' ')}</div>
                  ))}

                  {video.intensity && (
                    <div style={{ padding: '6px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)', fontSize: '0.85rem', color: 'var(--accent-color)', fontWeight: 700 }}>{video.intensity}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* editing is handled by parent (VideoCard) to avoid duplicate editors */}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return jsx;
  return createPortal(jsx, document.body);
}
