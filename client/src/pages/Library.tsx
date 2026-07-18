import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import AlbumGrid from '../components/AlbumGrid';
import VideoCard from '../components/VideoCard';
import EquipmentPicker from '../components/EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, TRAINING_TYPES, BODY_PARTS } from '../lib/metadata';
import { matchesTags, matchesQuery, useFilterMatchMode, FilterMatchToggle } from '../lib/filters';
import { useMetaLabels } from '../lib/labels';
import { Video } from '../types/video';

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function albumKeyFromPath(rel: string) {
  if (!rel) return '.';
  const parts = rel.split('/');
  if (parts.length <= 1) return '.';
  return parts.slice(0, -1).join('/');
}

export default function Library() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [albums, setAlbums] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'alpha' | 'alpha_desc'>('alpha');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedTrainingType, setSelectedTrainingType] = useState<string[]>([]);
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<string>('');
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const labels = useMetaLabels();
  const { t } = useTranslation();

  const updateVideo = (updated: Video) => {
    setVideos(prev => prev.map(v => (v.id === updated.id ? updated : v)));
  };

  useEffect(() => {
    fetch('http://localhost:3000/api/library/videos')
      .then(r => r.json())
      .then((data: Video[]) => setVideos(data || []))
      .catch(err => console.error('Failed to load library:', err));
  }, []);

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
      const rel = v.relative_path || '';
      const top = rel.includes('/') ? rel.split('/')[0] : '.';
      const arr = map.get(top) || [];
      arr.push(v);
      map.set(top, arr);
    }

    const result = Array.from(map.entries()).map(([key, vids]) => {
      const stored = localStorage.getItem(`albumImage:${key}`);
      const cover = stored || (vids[0]?.thumbnail_path ? `http://localhost:3000/thumbnails/${vids[0].thumbnail_path}` : null);
      return { key, title: key === '.' ? t('library.root_folder') : key, cover, count: vids.length };
    });
    // apply natural sort for numbered folder titles
    if (sort === 'alpha') result.sort((a, b) => naturalCompare(a.title, b.title));
    else result.sort((a, b) => naturalCompare(b.title, a.title));
    setAlbums(result);
  }, [videos, sort, selectedEquipment, t]);

  const visibleAlbums = albums.filter(a => matchesQuery([a.title], query));

  const openAlbum = (key: string) => {
    navigate(`/library/${encodeURIComponent(key)}`);
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
        <AlbumGrid albums={visibleAlbums} onOpen={openAlbum} onImageChange={setAlbumImage} />
      </div>

      <div style={{ marginTop: '1.5rem', padding: '12px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{t('library.filter_by_equipment')}</h3>
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

      {(query.trim() || selectedEquipment.length > 0 || selectedTrainingType.length > 0 || selectedBodyParts.length > 0 || selectedIntensity) && (
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
