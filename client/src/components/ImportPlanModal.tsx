import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type Props = {
  onClose: () => void;
  /** Called once plans have actually been created, so the page can refresh. */
  onImported: (planNames: string[]) => void;
};

interface ImportReport {
  name: string;
  importedAs: string;
  workoutCount: number;
  videoCount: number;
  matched: number;
  willCreate: number;
  missing: number;
  missingTitles: string[];
  playlists: { id: string; title: string | null }[];
}

/**
 * Import dialog.
 *
 * Everything is dry-run first: the file is analysed and the result shown before
 * anything is written, because "18 of 24 videos found" is the one thing worth
 * knowing and nobody will go looking for it afterwards.
 *
 * The playlist field is the same idea. A YouTube plan works without it — the
 * videos are recreated from the file — but adding the playlist brings the
 * thumbnails and files them in the Library as an album, and the moment to
 * mention that is here, not in a page of instructions.
 */
export default function ImportPlanModal({ onClose, onImported }: Props) {
  const { t } = useTranslation();
  const fileRef = useRef<any>(null);
  const [fileName, setFileName] = useState('');
  const [reports, setReports] = useState<ImportReport[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [playlistDone, setPlaylistDone] = useState('');

  const analyze = async (parsed: any) => {
    const res = await fetch('/api/plan/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: parsed, dryRun: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setReports(null);
      setError(t(`transfer.error_${data?.code || 'failed'}`));
      return;
    }
    setReports(data.reports);
  };

  const pickFile = async (selected: File) => {
    setError('');
    setReports(null);
    setPlaylistDone('');
    setFileName(selected.name);
    setBusy(true);
    try {
      const parsed = JSON.parse(await selected.text());
      fileRef.current = parsed;
      await analyze(parsed);
    } catch {
      fileRef.current = null;
      setError(t('transfer.error_not_a_plan_file'));
    } finally {
      setBusy(false);
    }
  };

  /** Import the playlist, then re-analyse: the numbers below change as a result. */
  const addPlaylist = async () => {
    const url = playlistUrl.trim();
    if (!url || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/external/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        const key = `import.error_${data?.code || 'failed'}`;
        const translated = t(key);
        setError(translated === key ? (data?.error || t('import.error_failed')) : translated);
        return;
      }
      setPlaylistDone(t('transfer.playlist_added', { count: data?.totalCount ?? 0, title: data?.playlistTitle || '' }));
      setPlaylistUrl('');
      if (fileRef.current) await analyze(fileRef.current);
    } catch {
      setError(t('import.error_failed'));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!fileRef.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/plan/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: fileRef.current }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(t(`transfer.error_${data?.code || 'failed'}`));
        return;
      }
      onImported((data.reports as ImportReport[]).map(r => r.importedAs));
    } catch {
      setError(t('transfer.error_failed'));
    } finally {
      setBusy(false);
    }
  };

  // Only missing local files make this an "anyway" decision. Videos that will
  // be created are the plan arriving intact, not a compromise.
  const totalMissing = reports?.reduce((n, r) => n + r.missing, 0) ?? 0;

  return createPortal(
    <div className="wb-overlay wb-overlay-top" onClick={() => !busy && onClose()}>
      <div className="wb-import-modal" onClick={e => e.stopPropagation()}>
        <h3 className="wb-import-title">{t('transfer.import_title')}</h3>
        <p className="wb-import-intro">{t('transfer.import_intro')}</p>

        <label className="pt-file">
          <span>{fileName || t('transfer.choose_file')}</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={e => {
              const selected = e.target.files?.[0];
              if (selected) pickFile(selected);
              e.target.value = '';
            }}
            style={{ display: 'none' }}
          />
        </label>

        {reports?.map(report => (
          <div className="pt-report" key={report.importedAs}>
            <div className="pt-report-name">{report.importedAs}</div>
            <div className="pt-stats">
              <span>{t('transfer.stat_workouts', { count: report.workoutCount })}</span>
              <span>{t('transfer.stat_found', { found: report.matched + report.willCreate, total: report.videoCount })}</span>
            </div>
            {report.willCreate > 0 && (
              <div className="pt-note pt-note-good">{t('transfer.will_add', { count: report.willCreate })}</div>
            )}
            {report.missing > 0 && (
              <div className="pt-note pt-note-warn">
                {t('transfer.missing_local', { count: report.missing })}
              </div>
            )}
          </div>
        ))}

        {/* Offered whenever a file is loaded, not only when something is
            missing — the plan may import cleanly and still be nicer with the
            playlist's thumbnails behind it. */}
        {reports && (
          <div className="pt-playlist">
            <div className="pt-playlist-q">{t('transfer.playlist_q')}</div>
            <p className="wb-import-note">{t('transfer.playlist_hint')}</p>
            <div className="pt-playlist-row">
              <input
                className="wb-input"
                value={playlistUrl}
                onChange={e => setPlaylistUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addPlaylist(); }}
                placeholder="https://www.youtube.com/playlist?list=..."
                disabled={busy}
              />
              <button
                className="wb-btn wb-btn-primary"
                onClick={addPlaylist}
                disabled={busy || !playlistUrl.trim()}
              >
                {t('transfer.playlist_add')}
              </button>
            </div>
            {playlistDone && <div className="pt-note pt-note-good">{playlistDone}</div>}
          </div>
        )}

        {error && <div className="wb-import-error">{error}</div>}

        <div className="wb-actions">
          <button className="wb-btn wb-btn-ghost" onClick={onClose} disabled={busy}>
            {t('transfer.cancel')}
          </button>
          <button className="wb-btn wb-btn-primary" onClick={doImport} disabled={busy || !reports}>
            {busy
              ? t('transfer.working')
              : totalMissing > 0
                ? t('transfer.import_anyway')
                : t('transfer.import_btn')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
