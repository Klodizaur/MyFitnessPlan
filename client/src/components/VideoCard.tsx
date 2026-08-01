import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { EquipmentIcon } from '../lib/equipment';
import { useMetaLabels } from '../lib/labels';
import { isExternalVideo } from '../lib/paths';
import { Video } from '../types/video';
import VideoMetadataEditor from './VideoMetadataEditor';
import VideoDetailsModal from './VideoDetailsModal';
import YouTubeBadge from './YouTubeBadge';

type Props = {
  video: Video;
  viewMode: 'grid' | 'list';
  onUpdate: (video: Video) => void;
};

// "1:04:20" for long videos, "32:15" otherwise — the usual player convention.
function formatRuntime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export default function VideoCard({ video, viewMode, onUpdate }: Props) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const labels = useMetaLabels();
  const { t } = useTranslation();

  const equipment = video.equipment || [];
  const hasMeta = Boolean(video.description?.trim()) || equipment.length > 0;
  const isExternal = isExternalVideo(video);

  const openPlayer = () => navigate(`/player/${video.id}`);

  // Marks a video that streams from YouTube rather than playing from disk, so
  // it's obvious at a glance which parts of a plan need a connection.
  const sourceBadge = isExternal ? <YouTubeBadge /> : null;

  // Runtime chip in the thumbnail's bottom-right corner. Hidden on hover so it
  // doesn't sit on top of the hover overlay.
  const durationBadge = video.duration_seconds ? (
    <span className="video-duration-badge" style={{ opacity: hovered ? 0 : 1 }}>
      {formatRuntime(video.duration_seconds)}
    </span>
  ) : null;

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
      {/* Edit info removed — use Info → Edit Details instead */}
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setShowDetails(true); }}
        title="Details"
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
        Info
      </button>
    </div>
  );

  const metaBelow = (
    <div style={{ padding: '10px 12px', background: 'var(--surface-color)', borderTop: '1px solid var(--glass-border)' }}>
      {equipment.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {equipment.map(id => (
            <span
              key={id}
              title={labels.equipment(id)}
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
              <img src={`/thumbnails/${video.thumbnail_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ padding: 12 }}>{video.filename}</div>
            )}
            {durationBadge}
            {sourceBadge}
            {hoverOverlay}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>{video.filename}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {isExternal ? t('library.external_needs_internet') : video.relative_path}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {equipment.length > 0 && (
                <div style={{ display: 'flex', gap: 6, color: 'var(--text-primary)' }}>
                  {equipment.map(id => (
                    <span
                      key={id}
                      title={labels.equipment(id)}
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
          </div>
        </div>

        {editing && (
          <VideoMetadataEditor
            video={video}
            onClose={() => setEditing(false)}
            onSaved={onUpdate}
          />
        )}
        {showDetails && (
          <VideoDetailsModal video={video} onClose={() => setShowDetails(false)} onSaved={onUpdate} onRequestEdit={() => { setShowDetails(false); setEditing(true); }} />
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
            <img src={`/thumbnails/${video.thumbnail_path}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ padding: 20 }}>{video.filename}</div>
          )}

          {durationBadge}
          {sourceBadge}
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
              // Keep the title clear of the runtime chip in the corner.
              paddingRight: video.duration_seconds ? 48 : 0,
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
      {showDetails && (
        <VideoDetailsModal video={video} onClose={() => setShowDetails(false)} onSaved={onUpdate} onRequestEdit={() => { setShowDetails(false); setEditing(true); }} />
      )}
    </>
  );
}
