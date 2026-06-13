import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AlbumGrid from '../components/AlbumGrid';
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
  const navigate = useNavigate();

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
      const rel = v.relative_path || '';
      const top = rel.includes('/') ? rel.split('/')[0] : '.';
      const arr = map.get(top) || [];
      arr.push(v);
      map.set(top, arr);
    }

    const result = Array.from(map.entries()).map(([key, vids]) => {
      const stored = localStorage.getItem(`albumImage:${key}`);
      const cover = stored || (vids[0]?.thumbnail_path ? `http://localhost:3000/thumbnails/${vids[0].thumbnail_path}` : null);
      return { key, title: key === '.' ? 'Root' : key, cover, count: vids.length };
    });
    // apply natural sort for numbered folder titles
    if (sort === 'alpha') result.sort((a, b) => naturalCompare(a.title, b.title));
    else result.sort((a, b) => naturalCompare(b.title, a.title));
    setAlbums(result);
  }, [videos, sort]);

  const visibleAlbums = albums.filter(a => a.title.toLowerCase().includes(query.trim().toLowerCase()));

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
      <h1>Library</h1>
      <p style={{ color: 'var(--text-secondary)' }}>Browse scanned videos grouped by top-level folders.</p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', padding: '8px 12px', borderRadius: 10, border: '1px solid var(--glass-border)', width: 360 }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input placeholder="Search folders..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--surface-hover)', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--glass-border)' }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><path d="M21 10h-6"/><path d="M3 6h6"/><path d="M3 14h6"/><path d="M21 18h-6"/></svg>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} style={{ border: 'none', background: 'transparent', outline: 'none' }}>
            <option value="alpha">Alphabetical A→Z</option>
            <option value="alpha_desc">Alphabetical Z→A</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: '1rem' }}>
        <AlbumGrid albums={visibleAlbums} onOpen={openAlbum} onImageChange={setAlbumImage} />
      </div>
    </div>
  );
}
