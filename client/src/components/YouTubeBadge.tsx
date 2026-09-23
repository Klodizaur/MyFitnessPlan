import { useTranslation } from 'react-i18next';
import YouTubeGlyph from './icons/YouTubeGlyph';

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
      <YouTubeGlyph size={11} />
      YouTube
    </span>
  );
}
