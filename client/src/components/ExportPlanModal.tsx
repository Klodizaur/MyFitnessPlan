import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Check, Download, Info } from 'lucide-react';
import Modal, { CloseButton } from './modal/Modal';

type Props = {
  /** A single plan's id, or null to back up every plan. */
  planId: string | null;
  planName?: string;
  onClose: () => void;
};

interface ExportedVideo { source: string }
interface ExportFile {
  plans: { name: string; workouts: { videos: ExportedVideo[] }[] }[];
}

/** Strip anything a filesystem would object to, and keep it short. */
function safeFilename(name: string): string {
  return (name || 'plan').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'plan';
}

/**
 * Export dialog.
 *
 * The whole point of the note here is that the same file means two different
 * things depending on what's inside it, and nobody is going to read a manual to
 * find that out: a plan made only of YouTube videos is something you can hand to
 * another person, and one with your own files on disk is a backup for you. So the
 * file is fetched first and the message is chosen from what it actually
 * contains, rather than explaining both cases every time.
 */
export default function ExportPlanModal({ planId, planName, onClose }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<ExportFile | null>(null);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const url = planId ? `/api/plan/export?ids=${encodeURIComponent(planId)}` : '/api/plan/export';
    fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then(setFile)
      .catch(() => setError(t('transfer.export_failed')));
  }, [planId, t]);

  const videos = file ? file.plans.flatMap(p => p.workouts.flatMap(w => w.videos)) : [];
  const localCount = videos.filter(v => v.source === 'local').length;
  const externalCount = videos.length - localCount;
  const workoutCount = file ? file.plans.reduce((n, p) => n + p.workouts.length, 0) : 0;

  const download = () => {
    if (!file || downloaded) return;
    const stamp = new Date().toISOString().split('T')[0];
    const name = planId
      ? `${safeFilename(planName || file.plans[0]?.name || 'plan')}.mfp-plan.json`
      : `myfitnessplan-backup-${stamp}.json`;
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Freed on the next tick: revoking immediately can cancel the download.
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    setDownloaded(true);
  };

  const notes: string[] = [];
  if (externalCount > 0 && localCount === 0) notes.push(t('transfer.note_shareable'));
  if (localCount > 0 && externalCount > 0) notes.push(t('transfer.note_shareable_partial', { count: externalCount }));
  if (localCount > 0) notes.push(t('transfer.note_local', { count: localCount }));

  return (
    <Modal width={540} onClose={onClose} label={planId ? t('transfer.export_title') : t('transfer.export_all_title')}>
      <div className="md-head" style={{ paddingBottom: 8 }}>
        <div className="md-icon"><Archive size={24} /></div>
        <div style={{ flex: 1 }} />
        <CloseButton onClick={onClose} />
      </div>

      <div className="md-body">
        <div>
          <h2 className="md-title">{planId ? t('transfer.export_title') : t('transfer.export_all_title')}</h2>
          {file && planId && <p className="md-text">{file.plans[0]?.name}</p>}
        </div>

        {error && <div className="md-error" role="alert">{error}</div>}
        {!file && !error && <p className="md-text">{t('transfer.preparing')}</p>}

        {file && (
          <>
            <div className="md-stats">
              <div className="md-stat"><div className="md-stat-value">{file.plans.length}</div><div className="md-stat-label">{t('transfer.stat_plans', { count: file.plans.length })}</div></div>
              <div className="md-stat"><div className="md-stat-value">{workoutCount}</div><div className="md-stat-label">{t('transfer.stat_workouts_label', { count: workoutCount })}</div></div>
              <div className="md-stat"><div className="md-stat-value">{videos.length}</div><div className="md-stat-label">{t('transfer.stat_videos_label', { count: videos.length })}</div></div>
            </div>
            {notes.length > 0 && (
              <div className="md-note">
                {notes.map(text => <p key={text}><Info size={16} /><span>{text}</span></p>)}
              </div>
            )}
          </>
        )}
      </div>

      <div className="md-foot">
        <button type="button" className="md-btn" onClick={onClose}>{t('transfer.cancel')}</button>
        <button type="button" className={`md-btn ${downloaded ? 'md-btn--done' : 'md-btn--primary'}`} onClick={download} disabled={!file}>
          {downloaded ? <Check size={16} /> : <Download size={16} />}
          {downloaded ? t('transfer.downloaded') : t('transfer.download')}
        </button>
      </div>
    </Modal>
  );
}
