import { ChevronRight, Heart, Info, MoreVertical, Play, Plus } from 'lucide-react';
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
  /** The virtual Favourites album, marked with a heart instead of a source badge. */
  isFavorites?: boolean;
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
        {folder.isFavorites && (
          <span className="rx-heart rx-heart--top is-on lib-fav-badge"><Heart size={15} /></span>
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
          {/* The triangle is a cut-out, so it takes the row's own background. */}
          <YouTubeGlyph size={18} knockout="var(--t-surface)" />
        </span>
      )}
      {folder.isFavorites && (
        <span className="lib-folder-row-yt lib-fav-row"><Heart size={16} /></span>
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
  // Built like an album card — cover, name, one line under it — so it sits in
  // the grid at exactly their size. The cover holds only the icon.
  return (
    <button type="button" className="lib-folder" onClick={onOpen}>
      <span className="lib-folder-cover">
        <span className="lib-add-yt-cover">
          <YouTubeGlyph size={30} knockout="var(--t-band-even)" />
        </span>
      </span>
      <span className="lib-folder-name">{t('library.add_from_youtube')}</span>
      <span className="lib-folder-count">{t('library.add_from_youtube_hint')}</span>
    </button>
  );
}

export function AddFromYouTubeRow({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="lib-folder-row lib-add-yt-row" onClick={onOpen}>
      <span className="lib-add-yt-row-thumb"><YouTubeGlyph size={18} knockout="var(--t-subtle)" /></span>
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
  /** Plays the video. With `onInfo`, the pair shows over the thumbnail on hover. */
  onPlay?: () => void;
  /** Opens the video's details. */
  onInfo?: () => void;
  /** Toggles the star. Omit to hide the heart. */
  onFavorite?: () => void;
}

/** Play and info, over a thumbnail, on hover. Siblings of the card's own button —
 *  a button can't hold buttons — and inert until hovered, so on a touch screen a
 *  tap still just opens the card. */
function HoverActions({ onPlay, onInfo }: { onPlay?: () => void; onInfo?: () => void }) {
  const { t } = useTranslation();
  if (!onPlay && !onInfo) return null;
  return (
    <div className="lib-hover-actions">
      {onPlay && (
        <button type="button" className="lib-hover-play" aria-label={t('library.play')} title={t('library.play')} onClick={onPlay}>
          <Play size={18} />
        </button>
      )}
      {onInfo && (
        <button type="button" className="lib-hover-info" aria-label={t('library.video_details')} title={t('library.video_details')} onClick={onInfo}>
          <Info size={15} />
        </button>
      )}
    </div>
  );
}

/** A video as a grid card: thumbnail, duration, 2-line title, path, one tag row. */
export function VideoGridCard({ video, meta, onOpen, onPlay, onInfo, onFavorite }: VideoItemProps) {
  const { t } = useTranslation();
  const tagsFor = useVideoTags();
  const duration = formatDuration(video.duration_seconds);
  return (
    // The heart is a sibling of the card button, not inside it: a button can't
    // contain another button.
    <div className="lib-video-item">
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
    <HoverActions onPlay={onPlay} onInfo={onInfo} />
    {onFavorite && (
      <button
        type="button"
        className={`rx-heart rx-heart--top${video.is_favorite ? ' is-on' : ''}`}
        aria-pressed={Boolean(video.is_favorite)}
        aria-label={t(video.is_favorite ? 'library.unfavorite_video' : 'library.favorite_video')}
        title={t(video.is_favorite ? 'library.unfavorite_video' : 'library.favorite_video')}
        onClick={onFavorite}
      >
        <Heart size={15} />
      </button>
    )}
    </div>
  );
}

/** The same video as a list row: bigger thumbnail, up to two tag rows. */
export function VideoListRow({ video, meta, onOpen, onMenu, onPlay, onInfo, onFavorite }: VideoItemProps) {
  const { t } = useTranslation();
  const tagsFor = useVideoTags();
  const duration = formatDuration(video.duration_seconds);
  return (
    <div className="lib-video-row">
      <HoverActions onPlay={onPlay} onInfo={onInfo} />
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
      {onFavorite && (
        <button
          type="button"
          className={`lib-video-row-menu lib-video-row-fav${video.is_favorite ? ' is-on' : ''}`}
          aria-pressed={Boolean(video.is_favorite)}
          aria-label={t(video.is_favorite ? 'library.unfavorite_video' : 'library.favorite_video')}
          onClick={onFavorite}
        >
          <Heart size={18} />
        </button>
      )}
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
