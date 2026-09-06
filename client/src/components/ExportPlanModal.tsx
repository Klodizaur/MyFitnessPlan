import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

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
 * The whole point of the disclaimer here is that the same file means two
 * different things depending on what's inside it, and nobody is going to read a
 * manual to find that out: a plan made only of YouTube videos is something you
 * can hand to another person, and one with your own files on disk is a backup
 * for you. So the file is fetched first and the message is chosen from what it
 * actually contains, rather than explaining both cases every time.
 */
export default function ExportPlanModal({ planId, planName, onClose }: Props) {
  const { t } = useTranslation();
  const [file, setFile] = useState<ExportFile | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = planId ? `/api/plan/export?ids=${encodeURIComponent(planId)}` : '/api/plan/export';
    fetch(url)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('failed'))))
      .then(setFile)
      .catch(() => setError(t('transfer.export_failed')));
  }, [planId, t]);

  const videos = file
    ? file.plans.flatMap(p => p.workouts.flatMap(w => w.videos))
    : [];
  const localCount = videos.filter(v => v.source === 'local').length;
  const externalCount = videos.length - localCount;
  const workoutCount = file ? file.plans.reduce((n, p) => n + p.workouts.length, 0) : 0;

  const download = () => {
    if (!file) return;
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
    onClose();
  };

  return createPortal(
    <div className="wb-overlay wb-overlay-top" onClick={onClose}>
      <div className="wb-import-modal" onClick={e => e.stopPropagation()}>
        <h3 className="wb-import-title">
          {planId ? t('transfer.export_title') : t('transfer.export_all_title')}
        </h3>

        {error && <div className="wb-import-error">{error}</div>}

        {!file && !error && <p className="wb-import-intro">{t('transfer.preparing')}</p>}

        {file && (
          <>
            <p className="wb-import-intro">
              {planId
                ? file.plans[0]?.name
                : t('transfer.export_all_summary', { plans: file.plans.length })}
            </p>
            <div className="pt-stats">
              <span>{t('transfer.stat_workouts', { count: workoutCount })}</span>
              <span>{t('transfer.stat_videos', { count: videos.length })}</span>
            </div>

            {/* Only the case that applies. Both are shown for a mixed plan,
                because both are true of it. */}
            {externalCount > 0 && localCount === 0 && (
              <div className="pt-note pt-note-good">{t('transfer.note_shareable')}</div>
            )}
            {localCount > 0 && externalCount === 0 && (
              <div className="pt-note">{t('transfer.note_local', { count: localCount })}</div>
            )}
            {localCount > 0 && externalCount > 0 && (
              <>
                <div className="pt-note pt-note-good">{t('transfer.note_shareable_partial', { count: externalCount })}</div>
                <div className="pt-note">{t('transfer.note_local', { count: localCount })}</div>
              </>
            )}
          </>
        )}

        <div className="wb-actions">
          <button className="wb-btn wb-btn-ghost" onClick={onClose}>{t('transfer.cancel')}</button>
          <button className="wb-btn wb-btn-primary" onClick={download} disabled={!file}>
            {t('transfer.download')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
