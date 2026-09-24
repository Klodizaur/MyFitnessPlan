import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleCheck, Download, Link as LinkIcon, LockOpen, Wifi } from 'lucide-react';
import { ImportResult } from '../lib/externalImport';
import YouTubeGlyph from './icons/YouTubeGlyph';
import Modal, { CloseButton } from './modal/Modal';

type Props = {
  onClose: () => void;
  /** Called with the imported videos once the playlist has been read. */
  onImported: (result: ImportResult) => void;
};

/** A playlist link always carries `list=`; until it does there is nothing to import. */
const looksLikePlaylist = (url: string) => /list=/.test(url);

/**
 * Playlist import dialog, shared by the Library page and the plan builder so
 * both entry points behave identically.
 */
export default function YouTubeImportModal({ onClose, onImported }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const ok = looksLikePlaylist(url);

  const submit = async () => {
    const trimmed = url.trim();
    if (!ok || loading) return;

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

  return (
    <Modal width={560} onClose={onClose} busy={loading} label={t('import.title')}>
      <div className="md-head" style={{ paddingBottom: 8 }}>
        <div className="md-icon"><YouTubeGlyph size={26} knockout="var(--t-tint)" /></div>
        <div style={{ flex: 1 }} />
        <CloseButton onClick={onClose} disabled={loading} />
      </div>

      <div className="md-body">
        <div>
          <h2 className="md-title">{t('import.title')}</h2>
          <p className="md-text">{t('import.intro')}</p>
        </div>

        <label className={`md-field${ok ? ' is-ok' : ''}`}>
          <LinkIcon size={17} />
          <input
            value={url}
            onChange={e => { setUrl(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
            placeholder="https://www.youtube.com/playlist?list=..."
            disabled={loading}
            autoFocus
          />
          {ok && <CircleCheck size={18} className="is-ok-icon" />}
        </label>

        {/* The single most common failure is pointing this at a private
            playlist, which YouTube refuses with a bare 403. Say so up front
            rather than only in the error message. */}
        <div className="md-note">
          <p><LockOpen size={16} /><b>{t('import.public_warning')}</b></p>
          <p><Wifi size={16} /><span>{t('import.note')}</span></p>
        </div>

        {error && <div className="md-error" role="alert">{error}</div>}
      </div>

      <div className="md-foot">
        <button type="button" className="md-btn" onClick={onClose} disabled={loading}>{t('import.cancel')}</button>
        <button type="button" className="md-btn md-btn--primary" onClick={submit} disabled={loading || !ok}>
          <Download size={16} />
          {loading ? t('import.loading') : t('import.confirm')}
        </button>
      </div>
    </Modal>
  );
}
