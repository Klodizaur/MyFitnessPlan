import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EquipmentIcon, getEquipmentItem } from '../lib/equipment';
import { Video } from '../types/video';
import VideoMetadataEditor from './VideoMetadataEditor';

type Props = {
  video: Video;
  viewMode: 'grid' | 'list';
  onUpdate: (video: Video) => void;
};

export default function VideoCard({ video, viewMode, onUpdate }: Props) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);

  const equipment = video.equipment || [];
  const hasMeta = Boolean(video.description?.trim()) || equipment.length > 0;

  const openPlayer = () => navigate(`/player/${video.id}`);

  const hoverOverlay = (
    <div
      className="video-card-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        opacity: hovered ? 1 : 0,
        transition: 'opacity 160ms ease',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        padding: 10,
        pointerEvents: hovered ? 'auto' : 'none',
      }}
    >
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setEditing(true);
        }}
        title="Edit video info"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.25)',
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(8px)',
          color: 'white',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontWeight: 700,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        Edit info
      </button>
    </div>
  );

  const metaBelow = hasMeta && (
    <div style={{ padding: '10px 12px', background: 'var(--surface-color)', borderTop: '1px solid var(--glass-border)' }}>
      {video.description?.trim() && (
        <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.4 }}>
          {video.description}
        </p>
      )}
      {equipment.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {equipment.map(id => (
            <span
              key={id}
              title={getEquipmentItem(id)?.label}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                borderRadius: 8,
                background: 'var(--surface-hover)',
                border: '1px solid var(--glass-border)',
                color: 'var(--text-primary)',
              }}
            >
              <EquipmentIcon id={id} size={16} />
            </span>
          ))}
        </div>
      )}
    </div>
  );

  if (viewMode === 'list') {
    return (
      <>
        <div
          className="video-card video-card--list"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={openPlayer}
          style={{
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            padding: 12,
            borderRadius: 10,
            border: '1px solid var(--glass-border)',
            background: 'var(--surface-color)',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 240,
              aspectRatio: '16/9',
              background: '#111',
              borderRadius: 8,
              overflow: 'hidden',
              flex: '0 0 240px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {video.thumbnail_path ? (
              <img src={`http://localhost:3000/thumbnails/${video.thumbnail_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ padding: 12 }}>{video.filename}</div>
            )}
            {hoverOverlay}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{video.filename}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{video.relative_path}</div>
            {hasMeta && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {video.description?.trim() && (
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.4 }}>
                    {video.description}
                  </p>
                )}
                {equipment.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, color: 'var(--text-primary)' }}>
                    {equipment.map(id => (
                      <span
                        key={id}
                        title={getEquipmentItem(id)?.label}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 30,
                          height: 30,
                          borderRadius: 8,
                          background: 'var(--surface-hover)',
                          border: '1px solid var(--glass-border)',
                        }}
                      >
                        <EquipmentIcon id={id} size={16} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {editing && (
          <VideoMetadataEditor
            video={video}
            onClose={() => setEditing(false)}
            onSaved={onUpdate}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="video-card video-card--grid"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={openPlayer}
        style={{
          borderRadius: 10,
          overflow: 'hidden',
          border: '1px solid var(--glass-border)',
          cursor: 'pointer',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16/9',
            background: '#111',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {video.thumbnail_path ? (
            <img src={`http://localhost:3000/thumbnails/${video.thumbnail_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ padding: 20 }}>{video.filename}</div>
          )}

          {hoverOverlay}

          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              padding: '8px 10px',
              background: hovered ? 'transparent' : 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%)',
              transition: 'background 160ms ease',
              pointerEvents: 'none',
            }}
          >
            <div style={{
              color: 'white',
              fontWeight: 600,
              fontSize: '0.95rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--font-family)',
              letterSpacing: '-0.01em',
              textShadow: '0 1px 2px rgba(0,0,0,0.6)',
              opacity: hovered ? 0 : 1,
              transition: 'opacity 160ms ease',
            }}>
              {video.filename}
            </div>
          </div>
        </div>

        {metaBelow}
      </div>

      {editing && (
        <VideoMetadataEditor
          video={video}
          onClose={() => setEditing(false)}
          onSaved={onUpdate}
        />
      )}
    </>
  );
}
