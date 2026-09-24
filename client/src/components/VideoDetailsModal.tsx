import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronRight, Folder, Pencil, Play } from 'lucide-react';
import { Video } from '../types/video';
import { isExternalVideo } from '../lib/paths';
import { formatDuration, stripVideoExt, useVideoTags } from '../lib/videoTags';
import YouTubeGlyph from './icons/YouTubeGlyph';
import Modal, { CloseButton } from './modal/Modal';
import { TagRow } from './library/LibraryCards';
import { VideoEditForm } from './VideoMetadataEditor';

type Props = {
  video: Video;
  onClose: () => void;
  onSaved: (video: Video) => void;
  /** Hand editing to the parent instead of switching to the form in place. */
  onRequestEdit?: () => void;
};

/**
 * Video details: the picture, where it lives, its tags and notes, and the two
 * things you do with a video — play it, or add details. "Add details" swaps this
 * same dialog to the form, and Save comes back to the updated details.
 */
export default function VideoDetailsModal({ video: initial, onClose, onSaved, onRequestEdit }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tagsFor = useVideoTags();
  // Kept locally so the details show what was just saved without waiting for the parent.
  const [video, setVideo] = useState(initial);
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Modal width={780} onClose={() => setEditing(false)} label={t('editor.title')}>
        <VideoEditForm
          video={video}
          onCancel={() => setEditing(false)}
          onSaved={updated => { setVideo(updated); onSaved(updated); setEditing(false); }}
        />
      </Modal>
    );
  }

  const external = isExternalVideo(video);
  const dirs = external ? [] : (video.relative_path || '').split('/').filter(Boolean).slice(0, -1);
  const ext = video.filename.includes('.') ? `.${video.filename.split('.').pop()}` : '';
  const duration = formatDuration(video.duration_seconds);
  const hasDesc = Boolean(video.description?.trim());
  const tags = tagsFor(video);

  const play = () => {
    navigate(`/player/${video.id}`);
    onClose();
  };

  return (
    <Modal width={900} onClose={onClose} label={stripVideoExt(video.filename)}>
      <div className="md-view">
        <div className="md-view-side">
        <div className="md-view-media">
          {video.thumbnail_path ? <img src={`/thumbnails/${video.thumbnail_path}`} alt="" /> : <div className="md-view-noimg" />}
          <button type="button" className="md-play-circle" aria-label={t('library.play')} onClick={play}><Play size={24} /></button>
          {duration && <span className="md-view-dur">{duration}</span>}
        </div>
      <div className="md-view-actions">
          <button type="button" className="md-btn md-btn--primary" onClick={play}><Play size={16} />{t('library.play')}</button>
          <button type="button" className="md-btn" onClick={() => (onRequestEdit ? (onClose(), onRequestEdit()) : setEditing(true))}>
            <Pencil size={15} />
            {hasDesc ? t('editor.edit_details') : t('editor.add_details')}
          </button>
        </div>
        </div>

        <div className="md-view-info">
          <div className="md-view-titlerow">
            <h2 className="md-title">{stripVideoExt(video.filename)}</h2>
            <CloseButton onClick={onClose} />
          </div>

          <div className="md-crumbs">
            {external ? <YouTubeGlyph size={15} knockout="var(--t-surface-warm)" /> : <Folder size={14} />}
            {external
              ? video.external_playlist_title || t('library.untitled_playlist')
              : dirs.length > 0
                ? dirs.map((d, i) => <span key={i} style={{ display: 'contents' }}>{i > 0 && <ChevronRight size={13} />}{d}</span>)
                : t('library.root_folder')}
            {ext && <em>· {ext}</em>}
          </div>

          <TagRow tags={tags} rows={2} />

          {hasDesc
            ? <div className="md-desc"><ReactMarkdown remarkPlugins={[remarkGfm]}>{video.description as string}</ReactMarkdown></div>
            : <div className="md-empty-box">{t('editor.no_description')}</div>}

        </div>
      </div>
    </Modal>
  );
}
