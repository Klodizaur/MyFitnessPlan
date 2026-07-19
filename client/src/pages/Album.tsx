import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import VideoCard from '../components/VideoCard';
import EquipmentPicker from '../components/EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, TRAINING_TYPES, BODY_PARTS } from '../lib/metadata';
import { matchesTags, matchesQuery, useFilterMatchMode, FilterMatchToggle } from '../lib/filters';
import { useMetaLabels } from '../lib/labels';
import { fromAlbumRouteParam, toAlbumRouteParam, toPosixPath } from '../lib/paths';
import { Video } from '../types/video';

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export default function Album() {
  const { albumId } = useParams();
  const [videos, setVideos] = useState<Video[]>([]);
  const [albumKey, setAlbumKey] = useState<string>('');
  const [imgHover, setImgHover] = useState(false);
  const [q, setQ] = useState('');
  const [sortMode, setSortMode] = useState<'alpha' | 'alpha_desc'>('alpha');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedTrainingType, setSelectedTrainingType] = useState<string[]>([]);
  const [selectedBodyParts, setSelectedBodyParts] = useState<string[]>([]);
  const [selectedIntensity, setSelectedIntensity] = useState<string>('');
  const navigate = useNavigate();
  const location = useLocation();
  const [matchMode, setMatchMode] = useFilterMatchMode();
  const labels = useMetaLabels();

  useEffect(() => {
    setAlbumKey(fromAlbumRouteParam(albumId));
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

  // Build subfolder map and mainVideos under current base
  const subMap = new Map<string, { key: string; count: number; sample?: Video }>();
  const mainVideos = videos.filter(v => isUnderBase(v.relative_path || ''));
  // apply filters to mainVideos later when showing
  for (const v of videos) {
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

  const subfolders = Array.from(subMap.entries()).filter(([k]) => k !== '.').map(([, v]) => v).sort((a, b) => b.count - a.count);

  // Videos to display (apply all active filters)
  const filtered = mainVideos.filter(v => {
    if (!matchesQuery([v.filename, v.description], q)) return false;
    if (!matchesTags(v.equipment, selectedEquipment, matchMode)) return false;
    if (!matchesTags(v.training_type, selectedTrainingType, matchMode)) return false;
    if (selectedIntensity && v.intensity !== selectedIntensity) return false;
    if (!matchesTags(v.body_parts, selectedBodyParts, matchMode)) return false;
    return true;
  });
  const shown = filtered.slice();
  shown.sort((a, b) => (sortMode === 'alpha' ? naturalCompare(a.filename, b.filename) : naturalCompare(b.filename, a.filename)));

  const albumImage = localStorage.getItem(`albumImage:${albumKey}`) || (mainVideos[0]?.thumbnail_path ? `/thumbnails/${mainVideos[0].thumbnail_path}` : null);
  const setImage = (d: string | null) => {
    if (d) localStorage.setItem(`albumImage:${albumKey}`, d);
    else localStorage.removeItem(`albumImage:${albumKey}`);
  };

  const updateVideo = (updated: Video) => {
    setVideos(prev => prev.map(v => (v.id === updated.id ? updated : v)));
  };

  return (
    <div className="page-root">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} aria-label="Back" title="Back" style={{ width: 40, height: 40, borderRadius: 10, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <h1 style={{ display: 'inline-block', margin: 0 }}>{albumKey === '.' ? 'Root' : albumKey}</h1>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{mainVideos.length} videos in this collection</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="toolbar-search">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input placeholder="Search subfolders & videos..." value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%' }} />
          </div>

          {/* Equipment filter removed from header; shown below as its own row */}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><path d="M21 10h-6"/><path d="M3 6h6"/><path d="M3 14h6"/><path d="M21 18h-6"/></svg>
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} style={{ border: 'none', background: 'transparent', outline: 'none' }}>
                <option value="alpha">Alphabetical A→Z</option>
                <option value="alpha_desc">Alphabetical Z→A</option>
              </select>
            </div>

            
          </div>
        </div>
      </div>

      {/* Banner */}
      <div style={{ display: 'flex', marginBottom: '2rem', gap: 20, alignItems: 'center' }}>
        <div onMouseEnter={() => setImgHover(true)} onMouseLeave={() => setImgHover(false)} style={{ position: 'relative', flex: '1 1 280px', maxWidth: 360 }}>
          {albumImage ? (
            <img src={albumImage} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 12 }} />
          ) : (
            <div style={{ width: '100%', height: 200, borderRadius: 12, background: 'var(--surface-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No image</div>
          )}

          <div style={{ position: 'absolute', right: 8, top: 8, display: 'flex', gap: 8, opacity: imgHover ? 1 : 0, transition: 'opacity 140ms' }}>
            <label title="Set album image" style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setImage(r.result as string); r.readAsDataURL(f); }} />
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/></svg>
            </label>
            <button title="Remove image" onClick={() => setImage(null)} style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(0,0,0,0.5)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>

          <div style={{ flex: 1 }} />
      </div>

      {/* Subfolders */}
      {subfolders.length > 0 && (
        <div style={{ marginBottom: '2.5rem' }}>
          <h3 style={{ marginBottom: 22 }}>Subfolders</h3>
          <div className="subfolder-grid">
            {subfolders.filter(s => !q.trim() || s.key.toLowerCase().includes(q.trim().toLowerCase())).map(s => (
              <div key={s.key} onClick={() => { const next = currentSub ? `${currentSub}/${s.key}` : s.key; navigate(`/library/${encodeURIComponent(toAlbumRouteParam(albumKey))}?path=${encodeURIComponent(next)}`); }} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--glass-border)', background: 'var(--surface-color)', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
                <div style={{ width: '100%', aspectRatio: '16/9', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {s.sample?.thumbnail_path ? <img src={`/thumbnails/${s.sample.thumbnail_path}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ padding: 20, color: 'var(--text-secondary)' }}>{s.count} items</div>}
                </div>
                <div style={{ padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.key}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{s.count}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Equipment filter section */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Filter by equipment</h3>
          <FilterMatchToggle mode={matchMode} onChange={setMatchMode} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <EquipmentPicker selected={selectedEquipment} onChange={setSelectedEquipment} />
        </div>
      </div>

      <div className="filter-columns" style={{ marginBottom: '1.5rem' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Training Type</label>
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
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Body Parts (click to toggle)</label>
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
          <label style={{ display: 'block', fontWeight: 700, marginBottom: 8 }}>Intensity</label>
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

      {/* All Videos header with view toggle */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, marginBottom: 26 }}>
          <h3 style={{ margin: 0 }}>All Videos</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--surface-hover)' }}>
              <button onClick={() => setViewMode('grid')} aria-label="Grid view" title="Grid view" style={{ width: 40, height: 36, borderRadius: 8, border: 'none', background: viewMode === 'grid' ? 'var(--accent-color)' : 'transparent', color: viewMode === 'grid' ? 'white' : 'var(--text-primary)', cursor: 'pointer' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              </button>
              <button onClick={() => setViewMode('list')} aria-label="List view" title="List view" style={{ width: 40, height: 36, borderRadius: 8, border: 'none', background: viewMode === 'list' ? 'var(--accent-color)' : 'transparent', color: viewMode === 'list' ? 'white' : 'var(--text-primary)', cursor: 'pointer' }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </button>
            </div>
          </div>
        </div>
        {shown.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No videos in this folder</p>
        ) : (
          viewMode === 'grid' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 320px))', gap: 28 }}>
              {shown.map(v => (
                <VideoCard key={v.id} video={v} viewMode="grid" onUpdate={updateVideo} />
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {shown.map(v => (
                <VideoCard key={v.id} video={v} viewMode="list" onUpdate={updateVideo} />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
