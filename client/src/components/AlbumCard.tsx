import React, { useRef, useState } from 'react';

interface Props {
  albumKey: string;
  title: string;
  cover?: string | null;
  count: number;
  onClick?: () => void;
  onImageChange?: (dataUrl: string | null) => void;
}

export default function AlbumCard({ albumKey, title, cover, count, onClick, onImageChange }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [hover, setHover] = useState(false);

  const handleChoose = () => fileRef.current?.click();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      onImageChange && onImageChange(dataUrl);
    };
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ width: 220, margin: '8px' }}>
      <div
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{ cursor: 'pointer', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--glass-border)', boxShadow: '0 6px 24px rgba(0,0,0,0.12)' }}
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {cover ? (
            <img src={cover} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <div style={{ color: '#999' }}>{count} videos</div>
          )}

          {/* count badge */}
          <div style={{ position: 'absolute', left: 8, top: 8, background: 'rgba(0,0,0,0.6)', color: 'white', padding: '4px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 700 }}>
            {count}
          </div>

          {/* hover edit icon */}
          <div style={{ position: 'absolute', right: 8, top: 8, opacity: hover ? 1 : 0, transition: 'opacity 120ms', pointerEvents: hover ? 'auto' : 'none' }}>
            <button onClick={(e) => { e.stopPropagation(); handleChoose(); }} title="Set album image" style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.5)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/></svg>
            </button>
          </div>
        </div>

        <div style={{ padding: '10px 12px', background: 'var(--surface-color)' }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
    </div>
  );
}
