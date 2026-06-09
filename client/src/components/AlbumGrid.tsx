import React from 'react';
import AlbumCard from './AlbumCard';

interface Album {
  key: string;
  title: string;
  cover?: string | null;
  count: number;
}

interface Props {
  albums: Album[];
  onOpen: (albumKey: string) => void;
  onImageChange: (albumKey: string, dataUrl: string | null) => void;
}

export default function AlbumGrid({ albums, onOpen, onImageChange }: Props) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
      {albums.map(a => (
        <AlbumCard
          key={a.key}
          albumKey={a.key}
          title={a.title}
          cover={a.cover}
          count={a.count}
          onClick={() => onOpen(a.key)}
          onImageChange={(d) => onImageChange(a.key, d)}
        />
      ))}
    </div>
  );
}
