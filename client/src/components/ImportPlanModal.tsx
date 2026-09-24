import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, FileJson, FileUp, Upload, X } from 'lucide-react';
import Modal, { CloseButton } from './modal/Modal';

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

  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const total = reports?.reduce((n, r) => n + r.workoutCount, 0) ?? 0;

  const clearFile = () => {
    fileRef.current = null;
    setFileName('');
    setReports(null);
    setError('');
    setPlaylistDone('');
  };

  return (
    <Modal width={520} onClose={onClose} busy={busy} label={t('transfer.import_title')}>
      <div className="md-head" style={{ paddingBottom: 8 }}>
        <div className="md-icon"><FileUp size={24} /></div>
        <div style={{ flex: 1 }} />
        <CloseButton onClick={onClose} disabled={busy} />
      </div>

      <div className="md-body">
        <div>
          <h2 className="md-title">{t('transfer.import_title')}</h2>
          <p className="md-text">{t('transfer.import_intro')}</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={e => {
            const selected = e.target.files?.[0];
            if (selected) pickFile(selected);
            e.target.value = '';
          }}
        />

        {!fileName ? (
          <div
            className={`md-drop${over ? ' is-over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => {
              e.preventDefault();
              setOver(false);
              const dropped = e.dataTransfer.files?.[0];
              if (dropped) pickFile(dropped);
            }}
          >
            <div className="md-drop-icon"><Upload size={20} /></div>
            <strong>{t('transfer.choose_file')}</strong>
            <span>{t('transfer.or_drop')}</span>
          </div>
        ) : (
          <div className="md-file">
            <div className="md-file-icon"><FileJson size={18} /></div>
            <div className="md-file-text">
              <div className="md-file-name">{fileName}</div>
              <div className="md-file-sub">
                {reports ? t('transfer.stat_workouts', { count: total }) : t('transfer.working')}
              </div>
            </div>
            <button type="button" className="md-file-x" onClick={clearFile} disabled={busy} aria-label={t('transfer.remove_file')}>
              <X size={16} />
            </button>
          </div>
        )}

        {reports?.map(report => (
          <div className="md-report" key={report.importedAs}>
            <div className="md-report-name">{report.importedAs}</div>
            <div className="md-report-stats">
              <span>{t('transfer.stat_workouts', { count: report.workoutCount })}</span>
              <span>{t('transfer.stat_found', { found: report.matched + report.willCreate, total: report.videoCount })}</span>
            </div>
            {report.willCreate > 0 && <div className="md-good"><Check size={14} />{t('transfer.will_add', { count: report.willCreate })}</div>}
            {report.missing > 0 && <div className="md-warn">{t('transfer.missing_local', { count: report.missing })}</div>}
          </div>
        ))}

        {/* Offered whenever a file is loaded, not only when something is
            missing — the plan may import cleanly and still be nicer with the
            playlist's thumbnails behind it. */}
        {reports && (
          <div className="md-playlist">
            <strong>{t('transfer.playlist_q')}</strong>
            <p>{t('transfer.playlist_hint')}</p>
            <div className="md-playlist-row">
              <label className="md-field">
                <input
                  value={playlistUrl}
                  onChange={e => setPlaylistUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addPlaylist(); }}
                  placeholder="https://www.youtube.com/playlist?list=..."
                  disabled={busy}
                />
              </label>
              <button type="button" className="md-btn" onClick={addPlaylist} disabled={busy || !playlistUrl.trim()}>
                {t('transfer.playlist_add')}
              </button>
            </div>
            {playlistDone && <div className="md-good"><Check size={14} />{playlistDone}</div>}
          </div>
        )}

        {error && <div className="md-error" role="alert">{error}</div>}
      </div>

      <div className="md-foot">
        <button type="button" className="md-btn" onClick={onClose} disabled={busy}>{t('transfer.cancel')}</button>
        {/* Always just "Import". The note above already says what won't come
            across; an "anyway" here would make a normal outcome sound like a
            decision to regret. */}
        <button type="button" className="md-btn md-btn--primary" onClick={doImport} disabled={busy || !reports}>
          <Download size={16} />
          {busy ? t('transfer.working') : t('transfer.import_btn')}
        </button>
      </div>
    </Modal>
  );
}
