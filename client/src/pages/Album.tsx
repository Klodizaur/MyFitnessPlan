import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import LibraryToolbar, { LibrarySort, LibraryView, SortPill } from '../components/library/LibraryToolbar';
import FiltersSheet from '../components/library/FiltersSheet';
import { FolderCard, FolderItem, FolderRow, VideoGridCard, VideoListRow } from '../components/library/LibraryCards';
import VideoDetailsModal from '../components/VideoDetailsModal';
import { EMPTY_LENGTH, isLengthActive, LengthRange, matchesLength, matchesTags, matchesQuery, useFilterMatchMode } from '../lib/filters';
import { useLengthLabel } from '../components/library/LengthFilter';
import { useIsMobile } from '../lib/useIsMobile';
import { ChevronLeft, ChevronRight, Sparkles, Pencil, Trash2 } from 'lucide-react';
import '../styles/library.css';
import { useMetaLabels } from '../lib/labels';
import { fromAlbumRouteParam, toAlbumRouteParam, toPosixPath, isExternalVideo, isExternalAlbumKey, isFavoritesAlbumKey, playlistIdFromAlbumKey } from '../lib/paths';
import { toggleVideoFavorite } from '../lib/favorites';
import { notify } from '../lib/notify';
import { confirmDialog } from '../lib/confirm';
import { useAiAvailable } from '../lib/useAiAvailable';
import { Video } from '../types/video';

const PAGE = 24;

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export default function Album() {
  const { albumId } = useParams();
  const [videos, setVideos] = useState<Video[]>([]);
  const [albumKey, setAlbumKey] = useState<string>('');
  // User-picked cover, or null to fall back to the first video's thumbnail.
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [sortMode, setSortMode] = useState<LibrarySort>('az');
  // Folders sort by name or by how many videos they hold; videos by name or length.
  const [folderSort, setFolderSort] = useState<'az' | 'za' | 'most' | 'fewest'>('most');
  const [viewMode, setViewMode] = useState<LibraryView | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  // Inside a folder that has subfolders, the videos list shows only the loose
  // ones until this is turned on — otherwise a folder of folders reads as a
  // flat wall of videos.
  const [includeSubfolders, setIncludeSubfolders] = useState(false);
  const [detailsVideo, setDetailsVideo] = useState<Video | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedTrainingType, setSelectedTrainingType] = useState<string[]>([]);
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<string[]>([]);
  const [selectedLength, setSelectedLength] = useState<LengthRange>(EMPTY_LENGTH);
  const lengthLabel = useLengthLabel();
  const navigate = useNavigate();
  const location = useLocation();
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const labels = useMetaLabels();
  const { t } = useTranslation();
  // Optional AI description clean-up for the whole album.
  const aiAvailable = useAiAvailable();

  useEffect(() => {
    const key = fromAlbumRouteParam(albumId);
    setAlbumKey(key);
    setCustomImage(localStorage.getItem(`albumImage:${key}`));
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setVideos(data || []))
      .catch(err => console.error('Failed to load library videos:', err));
  }, [albumId]);

  // Read nested path from query (supports deep nesting): ?path=sub1%2Fsub2
  const searchParams = new URLSearchParams(location.search);
  const pathParam = searchParams.get('path');
  const currentSub = pathParam ? toPosixPath(decodeURIComponent(pathParam)) : null;

  // Determine base prefix for this view (main album or a deeper nested folder)
  const basePrefix = currentSub ? (albumKey === '.' ? currentSub : `${albumKey}/${currentSub}`) : (albumKey === '.' ? '' : albumKey);

  const isUnderBase = (rel: string) => {
    const posix = toPosixPath(rel);
    if (!basePrefix) return !posix.includes('/');
    return posix.startsWith(basePrefix + '/');
  };

  // An imported playlist is a flat album keyed by its playlist ID, not a real
  // folder: it has no path, no subfolders, and nothing to nest into.
  const isExternalAlbum = isExternalAlbumKey(albumKey);
  const playlistId = isExternalAlbum ? playlistIdFromAlbumKey(albumKey) : null;

  // Favourites is a flat, virtual album: every starred video from anywhere in
  // the library, with no path, no subfolders and nothing to rename or delete.
  const isFavoritesAlbum = isFavoritesAlbumKey(albumKey);
  const isFlatAlbum = isExternalAlbum || isFavoritesAlbum;

  // Videos with no file on disk have an empty relative_path, which would match
  // the library-root prefix and show them alongside real files. Folder views
  // consider local videos only.
  const localVideos = videos.filter(v => !isExternalVideo(v));

  // Build subfolder map and mainVideos under current base
  const subMap = new Map<string, { key: string; count: number; sample?: Video }>();
  const mainVideos = isFavoritesAlbum
    ? videos.filter(v => v.is_favorite)
    : isExternalAlbum
      ? videos.filter(v => isExternalVideo(v) && (v.external_playlist_id || 'unknown') === playlistId)
      : localVideos.filter(v => isUnderBase(v.relative_path || ''));
  // apply filters to mainVideos later when showing
  for (const v of isFlatAlbum ? [] : localVideos) {
    const rel = toPosixPath(v.relative_path || '');
    const prefix = basePrefix ? basePrefix + '/' : '';
    if (!rel.startsWith(prefix)) continue;
    const remainder = rel.slice(prefix.length);
    const parts = remainder.split('/');
    const sub = parts.length > 1 ? parts[0] : '.'; // '.' files directly under base
    const cur = subMap.get(sub) || { key: sub, count: 0, sample: undefined };
    cur.count += 1;
    if (!cur.sample) cur.sample = v;
    subMap.set(sub, cur);
  }

  const subfolders = Array.from(subMap.entries()).filter(([k]) => k !== '.').map(([, v]) => v).sort((a, b) =>
      folderSort === 'most' ? b.count - a.count
      : folderSort === 'fewest' ? a.count - b.count
      : folderSort === 'za' ? naturalCompare(b.key, a.key)
      : naturalCompare(a.key, b.key));

  const filterCount = selectedEquipment.length + selectedTrainingType.length
    + selectedBodyParts.length + selectedIntensity.length + (isLengthActive(selectedLength) ? 1 : 0);
  const isFiltering = filterCount > 0 || q.trim().length > 0;

  /** Videos sitting directly in this folder, not in one of its subfolders. */
  const looseVideos = isFlatAlbum ? mainVideos : mainVideos.filter(v => {
    const rel = toPosixPath(v.relative_path || '');
    const remainder = basePrefix ? rel.slice(basePrefix.length + 1) : rel;
    return !remainder.includes('/');
  });

  // Searching or filtering always looks through the whole folder: hiding
  // matches in subfolders from a search would be a surprise.
  const scoped = (isFiltering || includeSubfolders || subfolders.length === 0)
    ? mainVideos
    : looseVideos;

  // Videos to display (apply all active filters)
  const filtered = scoped.filter(v => {
    if (!matchesQuery([v.filename, v.description], q)) return false;
    if (!matchesTags(v.equipment, selectedEquipment, matchMode)) return false;
    if (!matchesTags(v.training_type, selectedTrainingType, matchMode)) return false;
    if (selectedIntensity.length > 0 && !selectedIntensity.includes(v.intensity || '')) return false;
    if (!matchesTags(v.body_parts, selectedBodyParts, matchMode)) return false;
    if (!matchesLength(v.duration_seconds, selectedLength)) return false;
    return true;
  });
  const sorted = [...filtered];
  if (sortMode === 'size') sorted.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
  else if (sortMode === 'small') sorted.sort((a, b) => (a.duration_seconds || 0) - (b.duration_seconds || 0));
  else sorted.sort((a, b) => naturalCompare(a.filename, b.filename));
  if (sortMode === 'za') sorted.reverse();

  // Held in state, not read from localStorage during render: writing to storage
  // alone doesn't re-render, so a newly picked cover wouldn't appear until the
  // page was navigated away from and back.
  const albumImage = customImage ?? (mainVideos[0]?.thumbnail_path ? `/thumbnails/${mainVideos[0].thumbnail_path}` : null);

  const updateVideo = (updated: Video) => {
    setVideos(prev => prev.map(v => (v.id === updated.id ? updated : v)));
  };

  // The playlist name is stored on every video in the album, so any of them
  // can supply it.
  const playlistTitle = mainVideos[0]?.external_playlist_title || t('library.untitled_playlist');

  const handleRenamePlaylist = async () => {
    if (!playlistId) return;
    const next = window.prompt(t('library.rename_playlist'), playlistTitle);
    const trimmed = next?.trim();
    if (!trimmed || trimmed === playlistTitle) return;

    try {
      const res = await fetch(`/api/external/playlist/${encodeURIComponent(playlistId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed })
      });
      if (!res.ok) return;
      // Grouping keys off the playlist ID, so only the display name changes.
      setVideos(prev => prev.map(v =>
        (v.external_playlist_id || 'unknown') === playlistId
          ? { ...v, external_playlist_title: trimmed }
          : v
      ));
    } catch (err) {
      console.error('Failed to rename playlist:', err);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!playlistId) return;

    // Plans keep referencing deleted videos by ID; the schedule drops IDs it
    // can't resolve, so those entries just disappear from the plan. Say so
    // before deleting rather than letting a plan quietly shrink.
    let warning = '';
    try {
      const res = await fetch(`/api/external/playlist/${encodeURIComponent(playlistId)}/usage`);
      const usage = await res.json();
      if (usage?.planCount > 0) {
        warning = `\n\n${t('library.delete_playlist_in_use', { count: usage.planCount })}`;
      }
    } catch {
      // Usage is advisory; a failed check shouldn't block the delete.
    }

    const ok = await confirmDialog({
      title: t('library.delete_playlist'),
      message: `${t('library.delete_playlist_confirm', { name: playlistTitle })}${warning}`.trim(),
      confirmLabel: t('plans.delete'),
      danger: true,
    });
    if (!ok) return;

    try {
      const res = await fetch(`/api/external/playlist/${encodeURIComponent(playlistId)}`, { method: 'DELETE' });
      if (!res.ok) return;
      navigate('/library');
    } catch (err) {
      console.error('Failed to delete playlist:', err);
    }
  };

  /**
   * Clean every description in this album.
   *
   * Unlike the per-video button in the editor this writes straight to the
   * library — a hundred descriptions can't be reviewed one at a time — so it
   * asks first and says exactly how many videos it will rewrite. Progress is
   * reported by the panel mounted at the app root, which survives navigating
   * away. Tags are never touched.
   */
  const handleCleanDescriptions = async () => {
    const withDescriptions = mainVideos.filter(v => (v.description || '').trim());
    if (withDescriptions.length === 0) {
      notify(t('ai.cleanup_none'), 'ok');
      return;
    }
    // Translating is a bigger commitment than tidying — it replaces the
    // creator's own words rather than trimming around them — so the warning
    // says which one is about to happen. Read at click time rather than on
    // page load, since it only matters here.
    let language = '';
    try {
      const cfg = await (await fetch('/api/ai/settings')).json();
      language = cfg?.descriptionLanguage || '';
    } catch {
      // Settings unreadable; warn about the tidy-only case, which is the default.
    }

    const message = language
      ? t('ai.cleanup_confirm_translate', {
          count: withDescriptions.length,
          language: language === 'pl' ? 'Polski' : 'English',
        })
      : t('ai.cleanup_confirm', { count: withDescriptions.length });

    const ok = await confirmDialog({
      title: t('ai.cleanup_album'),
      message,
      confirmLabel: t('ai.clean_btn'),
    });
    if (!ok) return;

    try {
      const res = await fetch('/api/ai/clean-descriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: withDescriptions.map(v => v.id),
          label: isFavoritesAlbum ? t('library.favorites') : isExternalAlbum ? playlistTitle : albumKey === '.' ? 'Root' : albumKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) notify(data?.error || t('ai.error_generic'));
    } catch {
      notify(t('ai.error_unreachable'));
    }
  };


  const isMobile = useIsMobile();
  const effectiveView: LibraryView = viewMode || (isMobile ? 'list' : 'grid');
  const displayed = sorted.slice(0, limit);
  const left = sorted.length - displayed.length;

  const albumTitle = isFavoritesAlbum
    ? t('library.favorites')
    : isExternalAlbum
    ? playlistTitle
    : (currentSub ? currentSub.split('/').slice(-1)[0] : albumKey === '.' ? t('library.root_folder') : albumKey);

  /** Library › album › each nested folder, each one navigable. */
  const crumbs = [
    { label: t('nav.library'), go: () => navigate('/library') },
    ...(isFlatAlbum ? [] : [{
      label: albumKey === '.' ? t('library.root_folder') : albumKey,
      go: () => navigate(`/library/${encodeURIComponent(toAlbumRouteParam(albumKey))}`),
    }]),
    ...(currentSub ? currentSub.split('/').map((part, i, all) => ({
      label: part,
      go: () => navigate(`/library/${encodeURIComponent(toAlbumRouteParam(albumKey))}?path=${encodeURIComponent(all.slice(0, i + 1).join('/'))}`),
    })) : []),
  ];

  const openSub = (key: string) => {
    const next = currentSub ? `${currentSub}/${key}` : key;
    navigate(`/library/${encodeURIComponent(toAlbumRouteParam(albumKey))}?path=${encodeURIComponent(next)}`);
  };

  const subfolderItems: FolderItem[] = subfolders.map(sub => ({
    key: sub.key,
    title: sub.key,
    cover: sub.sample?.thumbnail_path ? `/thumbnails/${sub.sample.thumbnail_path}` : null,
    count: sub.count,
    isExternal: false,
  }));

  const clearAll = () => {
    setSelectedEquipment([]); setSelectedTrainingType([]);
    setSelectedBodyParts([]); setSelectedIntensity([]); setSelectedLength(EMPTY_LENGTH); setQ('');
  };

  /** Path shown under a video title, relative to the folder being viewed. */
  const relMeta = (video: Video) => {
    // Favourites mixes every folder, so say where each video lives.
    if (isFavoritesAlbum) {
      if (isExternalVideo(video)) return video.external_playlist_title || undefined;
      const dirs = toPosixPath(video.relative_path || '').split('/').slice(0, -1);
      return dirs.length ? dirs.join(' / ') : t('library.root_folder');
    }
    if (isExternalAlbum) return undefined;
    const rel = toPosixPath(video.relative_path || '');
    const remainder = basePrefix ? rel.slice(basePrefix.length + 1) : rel;
    const parts = remainder.split('/').slice(0, -1);
    return parts.length ? parts.join(' / ') : undefined;
  };

  return (
    <div className="lib">
      <div className="rx-wrap lib-folder-head">
        <nav className="lib-crumbs" aria-label={t('nav.library')}>
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`} className="lib-crumb">
              <button type="button" onClick={crumb.go} className={i === crumbs.length - 1 ? 'is-current' : ''}>
                {crumb.label}
              </button>
              {i < crumbs.length - 1 && <ChevronRight size={13} />}
            </span>
          ))}
        </nav>

        <div className="lib-folder-hero">
          <button
            type="button"
            className="lib-folder-back"
            aria-label={t('plans.builder_back')}
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={22} />
          </button>

          {albumImage
            ? <img className="lib-folder-hero-img" src={albumImage} alt="" />
            : <span className="lib-folder-hero-img" />}

          <div className="lib-folder-hero-text">
            <h1>{albumTitle}</h1>
            <div className="lib-head-meta">
              {[
                t('library.n_videos', { count: mainVideos.length }),
                subfolders.length ? t('library.n_subfolders', { count: subfolders.length }) : '',
              ].filter(Boolean).join(' · ')}
            </div>
          </div>

          <div className="lib-folder-actions">
            {isExternalAlbum && (
              <>
                <button type="button" className="lib-icon-btn" title={t('library.rename_playlist')} onClick={handleRenamePlaylist}>
                  <Pencil size={16} />
                </button>
                <button type="button" className="lib-icon-btn lib-icon-btn--danger" title={t('library.delete_playlist')} onClick={handleDeletePlaylist}>
                  <Trash2 size={16} />
                </button>
              </>
            )}
            {/* Only imported playlists carry descriptions worth cleaning up. */}
            {aiAvailable && isExternalAlbum && (
              <button type="button" className="lib-folder-action" onClick={handleCleanDescriptions}>
                <Sparkles size={14} className="lib-action-icon" />
                <span>{t('ai.cleanup_album')}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <LibraryToolbar
        query={q}
        onQuery={value => { setQ(value); setLimit(PAGE); }}
        placeholder={t('library.search_in', { name: albumTitle })}
        filterCount={filterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        view={effectiveView}
        onView={setViewMode}
        activeChips={[
          ...selectedEquipment.map(v => ({ key: `eq:${v}`, label: labels.equipment(v), category: 'gear' as const, remove: () => setSelectedEquipment(p => p.filter(x => x !== v)) })),
          ...selectedTrainingType.map(v => ({ key: `type:${v}`, label: labels.trainingType(v), category: 'type' as const, remove: () => setSelectedTrainingType(p => p.filter(x => x !== v)) })),
          ...selectedBodyParts.map(v => ({ key: `body:${v}`, label: labels.bodyPart(v), category: 'body' as const, remove: () => setSelectedBodyParts(p => p.filter(x => x !== v)) })),
          ...selectedIntensity.map(v => ({ key: `int:${v}`, label: labels.intensity(v), category: 'intensity' as const, remove: () => setSelectedIntensity(p => p.filter(x => x !== v)) })),
          ...(isLengthActive(selectedLength) ? [{ key: 'length', label: lengthLabel(selectedLength), category: 'length' as const, remove: () => setSelectedLength(EMPTY_LENGTH) }] : []),
        ]}
        onClearAll={clearAll}
      />

      <div className="rx-wrap lib-body">
        {subfolderItems.length > 0 && (
          <section>
            <div className="lib-section-head">
              <h2>{t('library.subfolders')}</h2>
              <span className="lib-section-count">{subfolderItems.length}</span>
              <SortPill
                value={folderSort}
                onChange={setFolderSort}
                options={[
                  { value: 'az', label: t('library.sort_az') },
                  { value: 'za', label: t('library.sort_za') },
                  { value: 'most', label: t('library.sort_most_videos') },
                  { value: 'fewest', label: t('library.sort_fewest_videos') },
                ]}
              />
            </div>
            {/* A strip on a phone, so a folder with many subfolders doesn't
                push its videos off the screen entirely. */}
            {isMobile ? (
              <div className="lib-sub-strip">
                {subfolderItems.map(item => (
                  <FolderCard key={item.key} folder={item} onOpen={() => openSub(item.key)} />
                ))}
              </div>
            ) : effectiveView === 'grid' ? (
              <div className="lib-grid">
                {subfolderItems.map(item => (
                  <FolderCard key={item.key} folder={item} onOpen={() => openSub(item.key)} />
                ))}
              </div>
            ) : (
              <div className="lib-rows">
                {subfolderItems.map(item => (
                  <FolderRow key={item.key} folder={item} onOpen={() => openSub(item.key)} />
                ))}
              </div>
            )}
          </section>
        )}

        <section>
          <div className="lib-section-head">
            <h2>
              {isFiltering
                ? t('library.results')
                : subfolders.length && !includeSubfolders
                  ? t('library.loose_videos')
                  : t('library.all_videos')}
            </h2>
            <span className="lib-section-count">{sorted.length}</span>
            <SortPill
              value={sortMode}
              onChange={value => { setSortMode(value); setLimit(PAGE); }}
              options={[
                { value: 'az', label: t('library.sort_az') },
                { value: 'za', label: t('library.sort_za') },
                { value: 'size', label: t('library.sort_longest') },
                { value: 'small', label: t('library.sort_shortest') },
              ]}
            />

            {subfolders.length > 0 && !isFiltering && (
              <button
                type="button"
                className="lib-scope"
                aria-pressed={includeSubfolders}
                onClick={() => { setIncludeSubfolders(v => !v); setLimit(PAGE); }}
              >
                <span className={`lib-scope-track${includeSubfolders ? ' is-on' : ''}`}>
                  <span className="lib-scope-knob" />
                </span>
                {t('library.include_subfolders')}
              </button>
            )}
          </div>

          {sorted.length === 0 ? (
            <div className="lib-empty">
              <div className="lib-empty-title">
                {isFiltering ? t('library.no_videos_match') : isFavoritesAlbum ? t('library.no_favorites') : t('library.no_loose_videos')}
              </div>
              <div className="lib-empty-hint">
                {isFiltering ? t('library.no_videos_match_hint') : isFavoritesAlbum ? t('library.no_favorites_hint') : t('library.no_loose_videos_hint')}
              </div>
            </div>
          ) : effectiveView === 'grid' ? (
            <div className="lib-grid">
              {displayed.map(video => (
                <VideoGridCard
                  key={video.id}
                  video={video}
                  meta={relMeta(video)}
                  onOpen={() => setDetailsVideo(video)}
                  onPlay={() => navigate(`/player/${video.id}`)}
                  onInfo={() => setDetailsVideo(video)}
                  onFavorite={() => toggleVideoFavorite(video, setVideos)}
                />
              ))}
            </div>
          ) : (
            <div className="lib-video-rows">
              {displayed.map(video => (
                <VideoListRow
                  key={video.id}
                  video={video}
                  meta={relMeta(video)}
                  onOpen={() => setDetailsVideo(video)}
                  onMenu={() => setDetailsVideo(video)}
                  onPlay={() => navigate(`/player/${video.id}`)}
                  onInfo={() => setDetailsVideo(video)}
                  onFavorite={() => toggleVideoFavorite(video, setVideos)}
                />
              ))}
            </div>
          )}

          {left > 0 && (
            <button type="button" className="lib-more" onClick={() => setLimit(l => l + PAGE)}>
              {t('library.show_more', { count: Math.min(PAGE, left), left })}
            </button>
          )}
        </section>
      </div>

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        equipment={selectedEquipment}
        onEquipment={setSelectedEquipment}
        trainingType={selectedTrainingType}
        onTrainingType={setSelectedTrainingType}
        bodyParts={selectedBodyParts}
        onBodyParts={setSelectedBodyParts}
        intensity={selectedIntensity}
        onIntensity={setSelectedIntensity}
        length={selectedLength}
        onLength={setSelectedLength}
        matchMode={matchMode}
        onMatchMode={setMatchMode}
        onClearAll={clearAll}
        resultCount={filtered.length}
      />

      {detailsVideo && (
        <VideoDetailsModal
          video={detailsVideo}
          onClose={() => setDetailsVideo(null)}
          onSaved={updateVideo}
        />
      )}
    </div>
  );
}
