import { useTranslation } from 'react-i18next';

/**
 * Marks content that streams from YouTube rather than playing from disk.
 *
 * Shared by video cards and album cards so an imported playlist reads the same
 * whether you're looking at the album or the videos inside it.
 */
export default function YouTubeBadge({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={`video-source-badge ${className}`.trim()} title={t('library.external_needs_internet')}>
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12s0-3.2-.4-4.8z" />
        <path d="M10 15.5v-7l6 3.5-6 3.5z" fill="#000" fillOpacity="0.75" />
      </svg>
      YouTube
    </span>
  );
}
