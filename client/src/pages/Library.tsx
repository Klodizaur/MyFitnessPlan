import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import LibraryToolbar, { LibrarySort, LibraryView, ActiveChip } from '../components/library/LibraryToolbar';
import FiltersSheet from '../components/library/FiltersSheet';
import {
  AddFromYouTubeCard, AddFromYouTubeRow, FolderCard, FolderItem, FolderRow, VideoGridCard, VideoListRow,
} from '../components/library/LibraryCards';
import { EMPTY_LENGTH, isLengthActive, LengthRange, matchesLength, matchesQuery, matchesSource, matchesTags, useFilterMatchMode, SourceFilter } from '../lib/filters';
import { useLengthLabel } from '../components/library/LengthFilter';
import { useMetaLabels } from '../lib/labels';
import { albumKeyForVideo, FAVORITES_ALBUM_KEY, isExternalAlbumKey, toAlbumRouteParam } from '../lib/paths';
import { toggleVideoFavorite } from '../lib/favorites';
import { ImportResult, useDescriptionProgress, useImportAvailable } from '../lib/externalImport';
import { useIsMobile } from '../lib/useIsMobile';
import VideoDetailsModal from '../components/VideoDetailsModal';
import YouTubeImportModal from '../components/YouTubeImportModal';
import { Video } from '../types/video';
import '../styles/library.css';

const PAGE = 24;

const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Library index: the folders and imported albums, with search and filters.
 *
 * Folders are the point of this screen, so videos only appear once a search or
 * a filter is on — then it shows matching folders above matching videos, since
 * a search for "arms" could mean either.
 */
export default function Library() {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [videos, setVideos] = useState<Video[]>([]);
  const [detailsVideo, setDetailsVideo] = useState<Video | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>('az');
  const [view, setView] = useState<LibraryView | null>(null);
  const [source, setSource] = useState<SourceFilter>('');
  const [equipment, setEquipment] = useState<string[]>([]);
  const [trainingType, setTrainingType] = useState<string[]>([]);
  const [bodyParts, setBodyParts] = useState<string[]>([]);
  const [intensity, setIntensity] = useState<string[]>([]);
  const [length, setLength] = useState<LengthRange>(EMPTY_LENGTH);
  const lengthLabel = useLengthLabel();
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);

  // List is the sensible default on a phone and grid on a desktop, until the
  // user picks one.
  const effectiveView: LibraryView = view || (isMobile ? 'list' : 'grid');

  const loadVideos = useCallback(() => {
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setVideos(data || []))
      .catch(err => console.error('Failed to load library:', err));
  }, []);

  useEffect(() => { loadVideos(); }, [loadVideos]);

  const importAvailable = useImportAvailable();
  // Descriptions are fetched in the background after an import, so refresh
  // while that runs rather than leaving the user to reload the page.
  useDescriptionProgress(justImported, loadVideos);

  const filterCount = equipment.length + trainingType.length + bodyParts.length + intensity.length + (isLengthActive(length) ? 1 : 0);
  const trimmedQuery = query.trim();
  const isFiltering = filterCount > 0 || trimmedQuery.length > 0;

  /** Videos left by the source switch and the filter groups (not the search). */
  const filteredVideos = useMemo(() => videos.filter(video => {
    if (!matchesSource(video, source)) return false;
    if (!matchesTags(video.equipment, equipment, matchMode)) return false;
    if (!matchesTags(video.training_type, trainingType, 'any')) return false;
    if (!matchesTags(video.body_parts, bodyParts, 'any')) return false;
    if (intensity.length > 0 && !intensity.includes(video.intensity || '')) return false;
    if (!matchesLength(video.duration_seconds, length)) return false;
    return true;
  }), [videos, source, equipment, trainingType, bodyParts, intensity, length, matchMode]);

  const albums = useMemo<FolderItem[]>(() => {
    const map = new Map<string, Video[]>();
    for (const video of filteredVideos) {
      const key = albumKeyForVideo(video);
      const arr = map.get(key) || [];
      arr.push(video);
      map.set(key, arr);
    }

    const result: FolderItem[] = Array.from(map.entries()).map(([key, vids]) => {
      const stored = localStorage.getItem(`albumImage:${key}`);
      return {
        key,
        title: isExternalAlbumKey(key)
          ? (vids[0]?.external_playlist_title || t('library.untitled_playlist'))
          : key === '.' ? t('library.root_folder') : key,
        cover: stored || (vids[0]?.thumbnail_path ? `/thumbnails/${vids[0].thumbnail_path}` : null),
        count: vids.length,
        isExternal: isExternalAlbumKey(key),
      };
    });

    if (sort === 'size') result.sort((a, b) => b.count - a.count);
    else if (sort === 'small') result.sort((a, b) => a.count - b.count);
    else result.sort((a, b) => naturalCompare(a.title, b.title));
    if (sort === 'za') result.reverse();
    // Imported playlists group together after the user's own folders.
    result.sort((a, b) => Number(a.isExternal) - Number(b.isExternal));

    // Favourites is pinned first whatever the sort: it's a shortcut, not a folder.
    const starred = filteredVideos.filter(v => v.is_favorite);
    if (starred.length > 0) {
      result.unshift({
        key: FAVORITES_ALBUM_KEY,
        title: t('library.favorites'),
        cover: starred[0].thumbnail_path ? `/thumbnails/${starred[0].thumbnail_path}` : null,
        count: starred.length,
        isExternal: false,
        isFavorites: true,
      });
    }
    return result;
  }, [filteredVideos, sort, t]);

  /** How many albums the library has in total — the header describes the
      library, so it shouldn't shrink as filters are applied. */
  const totalAlbums = useMemo(
    () => new Set(videos.map(albumKeyForVideo)).size,
    [videos]
  );

  const visibleFolders = useMemo(
    () => (trimmedQuery ? albums.filter(a => matchesQuery([a.title], trimmedQuery)) : albums),
    [albums, trimmedQuery]
  );

  /** Videos are only listed once something is being searched or filtered for. */
  const matchingVideos = useMemo(() => {
    if (!isFiltering) return [];
    const found = filteredVideos.filter(v =>
      matchesQuery([v.filename, v.description], trimmedQuery));
    const sorted = [...found];
    if (sort === 'size') sorted.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
    else if (sort === 'small') sorted.sort((a, b) => (a.duration_seconds || 0) - (b.duration_seconds || 0));
    else sorted.sort((a, b) => naturalCompare(a.filename, b.filename));
    if (sort === 'za') sorted.reverse();
    return sorted;
  }, [filteredVideos, isFiltering, trimmedQuery, sort]);

  const shown = matchingVideos.slice(0, limit);
  const left = matchingVideos.length - shown.length;

  const activeChips: ActiveChip[] = [
    ...equipment.map(v => ({
      key: `eq:${v}`, label: labels.equipment(v), category: 'gear' as const,
      remove: () => setEquipment(prev => prev.filter(x => x !== v)),
    })),
    ...trainingType.map(v => ({
      key: `type:${v}`, label: labels.trainingType(v), category: 'type' as const,
      remove: () => setTrainingType(prev => prev.filter(x => x !== v)),
    })),
    ...bodyParts.map(v => ({
      key: `body:${v}`, label: labels.bodyPart(v), category: 'body' as const,
      remove: () => setBodyParts(prev => prev.filter(x => x !== v)),
    })),
    ...intensity.map(v => ({
      key: `int:${v}`, label: labels.intensity(v), category: 'intensity' as const,
      remove: () => setIntensity(prev => prev.filter(x => x !== v)),
    })),
    ...(isLengthActive(length) ? [{
      key: 'length', label: lengthLabel(length), category: 'length' as const,
      remove: () => setLength(EMPTY_LENGTH),
    }] : []),
  ];

  const clearAll = () => {
    setEquipment([]); setTrainingType([]); setBodyParts([]); setIntensity([]); setLength(EMPTY_LENGTH); setQuery('');
  };

  const openAlbum = (key: string) =>
    navigate(`/library/${encodeURIComponent(toAlbumRouteParam(key))}`);

  const handleImported = (result: ImportResult) => {
    // Merge rather than refetch so the new album appears immediately.
    setVideos(prev => {
      const byId = new Map(prev.map(v => [v.id, v]));
      for (const v of result.videos || []) byId.set(v.id, v);
      return Array.from(byId.values());
    });
    setIsImportOpen(false);
    setJustImported(true);
  };

  // Hidden while searching or filtering, and when the source switch is set to
  // local files — in those states it isn't one of the results.
  const showAddYouTube = importAvailable && !isFiltering && source !== 'local';
  const addYouTube = <AddFromYouTubeCard onOpen={() => setIsImportOpen(true)} />;

  return (
    <div className="lib">
      <header className="rx-wrap lib-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{t('nav.library')}</h1>
          <div className="lib-head-meta">
            {t('library.folders_and_videos', { folders: totalAlbums, videos: videos.length })}
          </div>
        </div>
      </header>

      <LibraryToolbar
        query={query}
        onQuery={value => { setQuery(value); setLimit(PAGE); }}
        placeholder={t('library.search_folders_videos')}
        filterCount={filterCount}
        onOpenFilters={() => setFiltersOpen(true)}
        source={source}
        onSource={value => { setSource(value); setLimit(PAGE); }}
        sort={sort}
        onSort={setSort}
        sizeLabel={t('library.sort_most_videos')}
        smallLabel={t('library.sort_fewest_videos')}
        view={effectiveView}
        onView={setView}
        activeChips={activeChips}
        onClearAll={clearAll}
      />

      <div className="rx-wrap lib-body">
        {(visibleFolders.length > 0 || showAddYouTube) && (
          <section>
            {isFiltering && (
              <div className="lib-section-head">
                <h2>{t('library.folders')}</h2>
                <span className="lib-section-count">{visibleFolders.length}</span>
              </div>
            )}

            {effectiveView === 'grid' ? (
              <div className="lib-grid">
                {/* First on a phone so it's reachable without scrolling the
                    whole library; last on desktop so it doesn't displace one. */}
                {showAddYouTube && isMobile && addYouTube}
                {visibleFolders.map(folder => (
                  <FolderCard key={folder.key} folder={folder} onOpen={() => openAlbum(folder.key)} />
                ))}
                {showAddYouTube && !isMobile && addYouTube}
              </div>
            ) : (
              <div className="lib-rows">
                {showAddYouTube && <AddFromYouTubeRow onOpen={() => setIsImportOpen(true)} />}
                {visibleFolders.map(folder => (
                  <FolderRow key={folder.key} folder={folder} onOpen={() => openAlbum(folder.key)} />
                ))}
              </div>
            )}
          </section>
        )}

        {isFiltering && (
          <section>
            <div className="lib-section-head">
              <h2>{t('library.matching_videos')}</h2>
              <span className="lib-section-count">{matchingVideos.length}</span>
            </div>

            {matchingVideos.length === 0 ? (
              <div className="lib-empty">
                <div className="lib-empty-title">{t('library.no_videos_match')}</div>
                <div className="lib-empty-hint">{t('library.no_videos_match_hint')}</div>
              </div>
            ) : effectiveView === 'grid' ? (
              <div className="lib-grid">
                {shown.map(video => (
                  <VideoGridCard
                    key={video.id}
                    video={video}
                    meta={video.relative_path ? video.relative_path.split('/').slice(0, -1).join(' / ') : undefined}
                    onOpen={() => setDetailsVideo(video)}
                    onPlay={() => navigate(`/player/${video.id}`)}
                    onInfo={() => setDetailsVideo(video)}
                    onFavorite={() => toggleVideoFavorite(video, setVideos)}
                  />
                ))}
              </div>
            ) : (
              <div className="lib-video-rows">
                {shown.map(video => (
                  <VideoListRow
                    key={video.id}
                    video={video}
                    meta={video.relative_path ? video.relative_path.split('/').slice(0, -1).join(' / ') : undefined}
                    onOpen={() => setDetailsVideo(video)}
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
        )}
      </div>

      <FiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        equipment={equipment}
        onEquipment={setEquipment}
        trainingType={trainingType}
        onTrainingType={setTrainingType}
        bodyParts={bodyParts}
        onBodyParts={setBodyParts}
        intensity={intensity}
        onIntensity={setIntensity}
        length={length}
        onLength={setLength}
        matchMode={matchMode}
        onMatchMode={setMatchMode}
        onClearAll={clearAll}
        resultCount={filteredVideos.length}
      />

      {detailsVideo && (
        <VideoDetailsModal
          video={detailsVideo}
          onClose={() => setDetailsVideo(null)}
          onSaved={updated => setVideos(prev => prev.map(v => (v.id === updated.id ? updated : v)))}
        />
      )}

      {isImportOpen && (
        <YouTubeImportModal onClose={() => setIsImportOpen(false)} onImported={handleImported} />
      )}
    </div>
  );
}
