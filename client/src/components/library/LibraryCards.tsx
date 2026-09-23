import { ChevronRight, MoreVertical, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import YouTubeGlyph from '../icons/YouTubeGlyph';
import { VideoTag, formatDuration, stripVideoExt, useVideoTags } from '../../lib/videoTags';
import { Video } from '../../types/video';

/** Read-only tag row. Capped to one or two rows; extra tags drop out whole. */
export function TagRow({ tags, rows = 1 }: { tags: VideoTag[]; rows?: 1 | 2 }) {
  if (tags.length === 0) return null;
  return (
    <div className={`rx-tags rx-tags--${rows} lib-tags`}>
      {tags.map(tag => (
        <span key={tag.key} className={`rx-tag rx-tag--${tag.category}`}>{tag.label}</span>
      ))}
    </div>
  );
}

export interface FolderItem {
  key: string;
  title: string;
  cover: string | null;
  count: number;
  isExternal: boolean;
}

/** A folder or imported album, as a cover card. */
export function FolderCard({ folder, onOpen }: { folder: FolderItem; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="lib-folder" onClick={onOpen}>
      <span className="lib-folder-cover">
        {folder.cover
          ? <img src={folder.cover} alt="" loading="lazy" />
          : <span className="lib-folder-noimg" />}
        {folder.isExternal && (
          <span className="rx-yt-badge" title={t('library.external_needs_internet')}>
            <YouTubeGlyph size={14} />
          </span>
        )}
      </span>
      <span className="lib-folder-name">{folder.title}</span>
      <span className="lib-folder-count">{t('library.n_videos', { count: folder.count })}</span>
    </button>
  );
}

/** The same folder as a list row. */
export function FolderRow({ folder, onOpen }: { folder: FolderItem; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="lib-folder-row" onClick={onOpen}>
      {folder.cover
        ? <img className="lib-folder-row-thumb" src={folder.cover} alt="" loading="lazy" />
        : <span className="lib-folder-row-thumb" />}
      <span className="lib-folder-row-text">
        <span className="lib-folder-name">{folder.title}</span>
        <span className="lib-folder-count">{t('library.n_videos', { count: folder.count })}</span>
      </span>
      {folder.isExternal && (
        <span className="lib-folder-row-yt" title={t('library.external_needs_internet')}>
          <YouTubeGlyph size={16} />
        </span>
      )}
      <ChevronRight size={18} className="lib-chevron" />
    </button>
  );
}

/**
 * "Add from YouTube" — a dashed tile that fills a grid cell like an album.
 * First on mobile and last on desktop, so on a phone it's reachable without
 * scrolling past the whole library, and on desktop it doesn't push albums down.
 */
export function AddFromYouTubeCard({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="lib-add-yt" onClick={onOpen}>
      <span className="lib-add-yt-icon"><YouTubeGlyph size={26} /></span>
      <span className="lib-add-yt-title">{t('library.add_from_youtube')}</span>
      <span className="lib-add-yt-hint">{t('library.add_from_youtube_hint')}</span>
    </button>
  );
}

export function AddFromYouTubeRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="lib-folder-row lib-add-yt-row" onClick={onOpen}>
      <span className="lib-add-yt-row-thumb"><YouTubeGlyph size={18} /></span>
      <span className="lib-folder-row-text">
        <span className="lib-folder-name">{t('library.add_from_youtube')}</span>
        <span className="lib-folder-count">{t('library.add_from_youtube_hint')}</span>
      </span>
      <Plus size={18} className="lib-chevron" />
    </button>
  );
}

interface VideoItemProps {
  video: Video;
  /** Folder path shown under the title, relative to where you are. */
  meta?: string;
  onOpen: () => void;
  onMenu?: () => void;
}

/** A video as a grid card: thumbnail, duration, 2-line title, path, one tag row. */
export function VideoGridCard({ video, meta, onOpen }: VideoItemProps) {
  const tagsFor = useVideoTags();
  const duration = formatDuration(video.duration_seconds);
  return (
    <button type="button" className="lib-video" onClick={onOpen}>
      <span className="rx-thumb lib-video-thumb">
        {video.thumbnail_path
          ? <img src={`/thumbnails/${video.thumbnail_path}`} alt="" loading="lazy" />
          : <span className="lib-video-noimg" />}
        {duration && <span className="rx-dur">{duration}</span>}
      </span>
      <span className="lib-video-title rx-clamp-2">{stripVideoExt(video.filename)}</span>
      {meta && <span className="lib-video-meta">{meta}</span>}
      <TagRow tags={tagsFor(video)} rows={1} />
    </button>
  );
}

/** The same video as a list row: bigger thumbnail, up to two tag rows. */
export function VideoListRow({ video, meta, onOpen, onMenu }: VideoItemProps) {
  const { t } = useTranslation();
  const tagsFor = useVideoTags();
  const duration = formatDuration(video.duration_seconds);
  return (
    <div className="lib-video-row">
      <button type="button" className="lib-video-row-main" onClick={onOpen}>
        <span className="rx-thumb lib-video-row-thumb">
          {video.thumbnail_path
            ? <img src={`/thumbnails/${video.thumbnail_path}`} alt="" loading="lazy" />
            : <span className="lib-video-noimg" />}
          {duration && <span className="rx-dur">{duration}</span>}
        </span>
        <span className="lib-video-row-text">
          <span className="lib-video-title rx-clamp-2">{stripVideoExt(video.filename)}</span>
          {meta && <span className="lib-video-meta">{meta}</span>}
          <TagRow tags={tagsFor(video)} rows={2} />
        </span>
      </button>
      {onMenu && (
        <button
          type="button"
          className="lib-video-row-menu"
          aria-label={t('library.video_details')}
          onClick={onMenu}
        >
          <MoreVertical size={18} />
        </button>
      )}
    </div>
  );
}
