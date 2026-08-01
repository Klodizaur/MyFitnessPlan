import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AlbumGrid from '../components/AlbumGrid';
import AlbumPlaceholderCard from '../components/AlbumPlaceholderCard';
import VideoCard from '../components/VideoCard';
import EquipmentPicker from '../components/EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, TRAINING_TYPES, BODY_PARTS } from '../lib/metadata';
import { matchesTags, matchesQuery, matchesSource, useFilterMatchMode, FilterMatchToggle, SourceFilter, SourceFilterToggle } from '../lib/filters';
import { useMetaLabels } from '../lib/labels';
import { albumKeyForVideo, toAlbumRouteParam, isExternalAlbumKey } from '../lib/paths';
import { ImportResult, useImportAvailable, useDescriptionProgress } from '../lib/externalImport';
import YouTubeImportModal from '../components/YouTubeImportModal';
import { Video } from '../types/video';

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export default function Library() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'alpha' | 'alpha_desc'>('alpha');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedTrainingType, setSelectedTrainingType] = useState<string[]>([]);
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<string>('');
  const [selectedSource, setSelectedSource] = useState<SourceFilter>('');
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const labels = useMetaLabels();
  const { t } = useTranslation();
  const importAvailable = useImportAvailable();
  const [isImportOpen, setIsImportOpen] = useState(false);
  // Set once something has been imported this session, which starts the
  // background-description watch.
  const [justImported, setJustImported] = useState(false);

  const updateVideo = (updated: Video) => {
    setVideos(prev => prev.map(v => (v.id === updated.id ? updated : v)));
  };

  const loadVideos = useCallback(() => {
    fetch('/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setVideos(data || []))
      .catch(err => console.error('Failed to load library:', err));
  }, []);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // Descriptions are fetched in the background after an import, so refresh
  // while that runs rather than leaving the user to reload the page.
  const pendingDescriptions = useDescriptionProgress(justImported, loadVideos);

  useEffect(() => {
    // Group by top-level folder (main folders)
    const map = new Map<string, Video[]>();
    for (const v of videos) {
      // Apply combined filters (all active filters must match)
      const veq = v.equipment || [];
      if (selectedEquipment.length > 0 && !veq.some(id => selectedEquipment.includes(id))) continue;
      if (selectedTrainingType.length > 0) {
        const vtypes = v.training_type || [];
        if (!vtypes.some(tt => selectedTrainingType.includes(tt))) continue;
      }
      if (selectedIntensity && v.intensity !== selectedIntensity) continue;
      if (selectedBodyParts.length > 0) {
        const vparts = v.body_parts || [];
        if (!vparts.some(bp => selectedBodyParts.includes(bp))) continue;
      }
      if (!matchesSource(v, selectedSource)) continue;
      const top = albumKeyForVideo(v);
      const arr = map.get(top) || [];
      arr.push(v);
      map.set(top, arr);
    }

    // An imported album is named after its playlist, carried on every video in
    // it; a folder album is named after the folder.
    const albumTitle = (key: string, vids: Video[]) => {
      if (isExternalAlbumKey(key)) {
        return vids[0]?.external_playlist_title || t('library.untitled_playlist');
      }
      return key === '.' ? t('library.root_folder') : key;
    };

    const result = Array.from(map.entries()).map(([key, vids]) => {
      const stored = localStorage.getItem(`albumImage:${key}`);
      const cover = stored || (vids[0]?.thumbnail_path ? `/thumbnails/${vids[0].thumbnail_path}` : null);
      return {
        key,
        title: albumTitle(key, vids),
        cover,
        count: vids.length,
        isExternal: isExternalAlbumKey(key),
      };
    });
    // apply natural sort for numbered folder titles
    if (sort === 'alpha') result.sort((a, b) => naturalCompare(a.title, b.title));
    else result.sort((a, b) => naturalCompare(b.title, a.title));
    // Imported playlists group together after the user's own folders.
    result.sort((a, b) => Number(a.isExternal) - Number(b.isExternal));
    setAlbums(result);
  }, [videos, sort, selectedEquipment, selectedSource, t]);

  const visibleAlbums = albums.filter(a => matchesQuery([a.title], query));
  const isLibraryEmpty = videos.length === 0;

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

  const openAlbum = (key: string) => {
    navigate(`/library/${encodeURIComponent(toAlbumRouteParam(key))}`);
  };

  const setAlbumImage = (key: string, dataUrl: string | null) => {
    if (dataUrl) localStorage.setItem(`albumImage:${key}`, dataUrl);
    else localStorage.removeItem(`albumImage:${key}`);
    // refresh albums
    setAlbums(a => a.map((al: any) => al.key === key ? { ...al, cover: dataUrl } : al));
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <h1>{t('library.title')}</h1>
      <p style={{ color: 'var(--text-secondary)' }}>{t('library.subtitle')}</p>

      {/* Descriptions arrive well after the videos do, so say so instead of
          leaving them looking permanently blank. */}
      {pendingDescriptions > 0 && (
        <div className="library-descr-progress">
          <span className="library-descr-spinner" />
          {t('import.fetching_descriptions', { count: pendingDescriptions })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: '1rem', marginBottom: '1rem' }}>
        <div className="toolbar-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input placeholder={t('library.search_placeholder')} value={query} onChange={(e) => setQuery(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><path d="M21 10h-6"/><path d="M3 6h6"/><path d="M3 14h6"/><path d="M21 18h-6"/></svg>
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ border: 'none', background: 'transparent', outline: 'none' }}>
              <option value="alpha">{t('library.sort_az')}</option>
              <option value="alpha_desc">{t('library.sort_za')}</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <AlbumGrid albums={visibleAlbums} onOpen={openAlbum} onImageChange={setAlbumImage}>
          {/* A library with nothing in it has no obvious next step, so the two
              ways to fill it appear as album slots waiting to be used. The
              YouTube slot stays afterwards — adding another playlist should
              feel like adding another album. */}
          {isLibraryEmpty && (
            <AlbumPlaceholderCard
              title={t('library.empty_scan_title')}
              hint={t('library.empty_scan_hint')}
              accent
              onClick={() => navigate('/settings')}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v1" /><path d="M3 7h18l-1.6 11.2A2 2 0 0 1 17.4 20H6.6a2 2 0 0 1-2-1.8L3 7z" /></svg>
              }
            />
          )}
          {importAvailable && (
            <AlbumPlaceholderCard
              title={t('import.btn')}
              hint={t('library.empty_youtube_hint')}
              onClick={() => setIsImportOpen(true)}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12s0-3.2-.4-4.8z" />
                  <path d="M10 15.5v-7l6 3.5-6 3.5z" fill="var(--surface-color)" />
                </svg>
              }
            />
          )}
        </AlbumGrid>
      </div>

      {isImportOpen && (
        <YouTubeImportModal
          onClose={() => setIsImportOpen(false)}
          onImported={handleImported}
        />
      )}

      <div style={{ marginTop: '1.5rem', padding: '12px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{t('library.filter_by_equipment')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <SourceFilterToggle
              value={selectedSource}
              onChange={setSelectedSource}
              allLabel={t('library.source_all')}
              localLabel={t('library.source_local')}
              externalLabel={t('library.source_external')}
            />
            <FilterMatchToggle
              mode={matchMode}
              onChange={setMatchMode}
              label={t('library.match_label')}
              anyLabel={t('library.match_any')}
              allLabel={t('library.match_all')}
              anyHint={t('library.match_any_hint')}
              allHint={t('library.match_all_hint')}
            />
          </div>
        </div>
        <EquipmentPicker selected={selectedEquipment} onChange={setSelectedEquipment} />
      </div>

      <div className="filter-columns" style={{ marginTop: '1rem' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>{t('library.training_type')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TRAINING_TYPES.map(t => {
              const sel = selectedTrainingType.includes(t);
              return (
                <button key={t} onClick={() => setSelectedTrainingType(sel ? selectedTrainingType.filter(x => x !== t) : [...selectedTrainingType, t])} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'var(--accent-soft)' : 'var(--surface-hover)', cursor: 'pointer' }} title={labels.trainingType(t)}>
                  <TrainingTypeIcon type={t} />
                  <span style={{ fontSize: '0.9rem' }}>{labels.trainingType(t)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>{t('library.body_parts')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {BODY_PARTS.map(bp => {
              const sel = selectedBodyParts.includes(bp);
              return (
                <button key={bp} onClick={() => setSelectedBodyParts(sel ? selectedBodyParts.filter(b => b !== bp) : [...selectedBodyParts, bp])} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'var(--accent-soft)' : 'var(--surface-hover)', cursor: 'pointer' }} title={labels.bodyPart(bp)}>
                  <BodyPartIcon part={bp} />
                  <span style={{ fontSize: '0.9rem' }}>{labels.bodyPart(bp)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>{t('library.intensity')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['low','medium','high'].map(level => {
              const sel = selectedIntensity === level;
              return (
                <button key={level} onClick={() => setSelectedIntensity(sel ? '' : level)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: sel ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)', background: sel ? 'var(--accent-soft)' : 'var(--surface-hover)', cursor: 'pointer' }} title={labels.intensity(level)}>
                  <IntensityIcon level={level} />
                  <span style={{ fontSize: '0.9rem', textTransform: 'capitalize' }}>{labels.intensity(level)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {(query.trim() || selectedEquipment.length > 0 || selectedTrainingType.length > 0 || selectedBodyParts.length > 0 || selectedIntensity || selectedSource) && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{t('library.matching_videos')}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setViewMode('grid')} title={t('library.grid_view')} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--glass-border)', background: viewMode === 'grid' ? 'var(--accent-color)' : 'transparent', color: viewMode === 'grid' ? 'white' : 'var(--text-primary)' }}>▦</button>
              <button onClick={() => setViewMode('list')} title={t('library.list_view')} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--glass-border)', background: viewMode === 'list' ? 'var(--accent-color)' : 'transparent', color: viewMode === 'list' ? 'white' : 'var(--text-primary)' }}>☰</button>
            </div>
          </div>

          {(() => {
            const matching = videos.filter(v => {
              if (!matchesQuery([v.filename, v.description], query)) return false;
              if (!matchesTags(v.equipment, selectedEquipment, matchMode)) return false;
              if (!matchesTags(v.training_type, selectedTrainingType, matchMode)) return false;
              if (selectedIntensity && v.intensity !== selectedIntensity) return false;
              if (!matchesTags(v.body_parts, selectedBodyParts, matchMode)) return false;
              if (!matchesSource(v, selectedSource)) return false;
              return true;
            });

            if (matching.length === 0) return <p style={{ color: 'var(--text-secondary)' }}>{t('library.no_match')}</p>;

            return viewMode === 'grid' ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 320px))', gap: 20 }}>
                {matching.map(v => <VideoCard key={v.id} video={v} viewMode="grid" onUpdate={updateVideo} />)}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {matching.map(v => <VideoCard key={v.id} video={v} viewMode="list" onUpdate={updateVideo} />)}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
