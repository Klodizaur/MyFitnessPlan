import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import VideoCard from '../components/VideoCard';
import EquipmentPicker from '../components/EquipmentPicker';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon, TRAINING_TYPES, BODY_PARTS } from '../lib/metadata';
import { matchesTags, matchesQuery, useFilterMatchMode, FilterMatchToggle } from '../lib/filters';
import { useMetaLabels } from '../lib/labels';
import { fromAlbumRouteParam, toAlbumRouteParam, toPosixPath, isExternalVideo, isExternalAlbumKey, playlistIdFromAlbumKey } from '../lib/paths';
import { useAiAvailable } from '../lib/useAiAvailable';
import { Video } from '../types/video';

const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export default function Album() {
  const { albumId } = useParams();
  const [videos, setVideos] = useState<Video[]>([]);
  const [albumKey, setAlbumKey] = useState<string>('');
  // User-picked cover, or null to fall back to the first video's thumbnail.
  const [customImage, setCustomImage] = useState<string | null>(null);
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

  // Videos with no file on disk have an empty relative_path, which would match
  // the library-root prefix and show them alongside real files. Folder views
  // consider local videos only.
  const localVideos = videos.filter(v => !isExternalVideo(v));

  // Build subfolder map and mainVideos under current base
  const subMap = new Map<string, { key: string; count: number; sample?: Video }>();
  const mainVideos = isExternalAlbum
    ? videos.filter(v => isExternalVideo(v) && (v.external_playlist_id || 'unknown') === playlistId)
    : localVideos.filter(v => isUnderBase(v.relative_path || ''));
  // apply filters to mainVideos later when showing
  for (const v of isExternalAlbum ? [] : localVideos) {
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

  // Held in state, not read from localStorage during render: writing to storage
  // alone doesn't re-render, so a newly picked cover wouldn't appear until the
  // page was navigated away from and back.
  const albumImage = customImage ?? (mainVideos[0]?.thumbnail_path ? `/thumbnails/${mainVideos[0].thumbnail_path}` : null);
  const setImage = (d: string | null) => {
    if (d) localStorage.setItem(`albumImage:${albumKey}`, d);
    else localStorage.removeItem(`albumImage:${albumKey}`);
    setCustomImage(d);
  };

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

    if (!window.confirm(`${t('library.delete_playlist_confirm', { name: playlistTitle })}${warning}`)) return;

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
      window.alert(t('ai.cleanup_none'));
      return;
    }
    if (!window.confirm(t('ai.cleanup_confirm', { count: withDescriptions.length }))) return;

    try {
      const res = await fetch('/api/ai/clean-descriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoIds: withDescriptions.map(v => v.id),
          label: isExternalAlbum ? playlistTitle : albumKey === '.' ? 'Root' : albumKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) window.alert(data?.error || t('ai.error_generic'));
    } catch {
      window.alert(t('ai.error_unreachable'));
    }
  };

  return (
    <div className="page-root">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} aria-label="Back" title="Back" style={{ width: 40, height: 40, borderRadius: 10, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div className="album-heading">
            {/* Playlist names run long, so the actions get their own row below
                rather than trailing the title and being pushed off. */}
            <h1 className="album-heading-title">
              {isExternalAlbum ? playlistTitle : albumKey === '.' ? 'Root' : albumKey}
            </h1>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {mainVideos.length} videos in this collection
              {isExternalAlbum && ` — ${t('library.external_album_hint')}`}
            </div>
            {(isExternalAlbum || aiAvailable) && (
              <div className="album-actions">
                {isExternalAlbum && (
                <>
                <button
                  type="button"
                  className="album-action-btn"
                  onClick={handleRenamePlaylist}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
                  {t('library.rename_playlist')}
                </button>
                <button
                  type="button"
                  className="album-action-btn album-action-danger"
                  onClick={handleDeletePlaylist}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v2" /></svg>
                  {t('library.delete_playlist')}
                </button>
                </>
                )}
                {aiAvailable && (
                  <button
                    type="button"
                    className="album-action-btn"
                    onClick={handleCleanDescriptions}
                    title={t('ai.cleanup_album_hint')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h6" /><path d="m17 15 2 2 4-4" /></svg>
                    {t('ai.cleanup_album')}
                  </button>
                )}
              </div>
            )}
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
