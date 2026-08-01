import React from 'react';

interface Props {
  title: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** Tints the card in the accent colour to make it read as the primary action. */
  accent?: boolean;
}

/**
 * An empty album slot that acts as a call to action.
 *
 * Sized to match AlbumCard so it sits inline with real albums instead of
 * looking like a stray button, and stays visible once the library has content —
 * adding another playlist should feel like adding another album.
 */
export default function AlbumPlaceholderCard({ title, hint, icon, onClick, accent }: Props) {
  return (
    <div style={{ width: 220, margin: '12px' }}>
      <button
        type="button"
        onClick={onClick}
        className={`album-placeholder${accent ? ' accent' : ''}`}
      >
        <span className="album-placeholder-icon">{icon}</span>
        <span className="album-placeholder-title">{title}</span>
        <span className="album-placeholder-hint">{hint}</span>
      </button>
    </div>
  );
}
