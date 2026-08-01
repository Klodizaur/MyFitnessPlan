import React from 'react';
import AlbumCard from './AlbumCard';

interface Album {
  key: string;
  title: string;
  cover?: string | null;
  count: number;
  isExternal?: boolean;
}

interface Props {
  albums: Album[];
  onOpen: (albumKey: string) => void;
  onImageChange: (albumKey: string, dataUrl: string | null) => void;
  /** Placeholder cards rendered after the albums, inside the same row flow. */
  children?: React.ReactNode;
}

export default function AlbumGrid({ albums, onOpen, onImageChange, children }: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px' }}>
      {albums.map(a => (
        <AlbumCard
          key={a.key}
          albumKey={a.key}
          title={a.title}
          cover={a.cover}
          count={a.count}
          isExternal={a.isExternal}
          onClick={() => onOpen(a.key)}
          onImageChange={(d) => onImageChange(a.key, d)}
        />
      ))}
      {children}
    </div>
  );
}
