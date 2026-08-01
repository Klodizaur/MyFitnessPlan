import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ImportResult } from '../lib/externalImport';

type Props = {
  onClose: () => void;
  /** Called with the imported videos once the playlist has been read. */
  onImported: (result: ImportResult) => void;
};

/**
 * Playlist import dialog, shared by the Library page and the plan builder so
 * both entry points behave identically.
 */
export default function YouTubeImportModal({ onClose, onImported }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/external/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed })
      });
      const data = await res.json();

      if (!res.ok) {
        // The server sends a stable `code`; fall back to its raw message only
        // when this client has no translation for that code.
        const key = `import.error_${data?.code || 'failed'}`;
        const translated = t(key);
        setError(translated === key ? (data?.error || t('import.error_failed')) : translated);
        return;
      }

      onImported(data as ImportResult);
    } catch {
      setError(t('import.error_failed'));
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="wb-overlay wb-overlay-top" onClick={() => !loading && onClose()}>
      <div className="wb-import-modal" onClick={e => e.stopPropagation()}>
        <h3 className="wb-import-title">{t('import.title')}</h3>
        <p className="wb-import-intro">{t('import.intro')}</p>

        {/* The single most common failure is pointing this at a private
            playlist, which YouTube refuses with a bare 403. Say so up front
            rather than only in the error message. */}
        <div className="wb-import-warning">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{t('import.public_warning')}</span>
        </div>

        <input
          className="wb-input"
          value={url}
          onChange={e => { setUrl(e.target.value); setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="https://www.youtube.com/playlist?list=..."
          disabled={loading}
          autoFocus
        />

        <p className="wb-import-note">{t('import.note')}</p>

        {error && <div className="wb-import-error">{error}</div>}

        <div className="wb-actions">
          <button className="wb-btn wb-btn-ghost" onClick={onClose} disabled={loading}>
            {t('import.cancel')}
          </button>
          <button className="wb-btn wb-btn-primary" onClick={submit} disabled={loading || !url.trim()}>
            {loading ? t('import.loading') : t('import.confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
