import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FolderOpen, HardDriveDownload, Loader, RotateCcw, Undo2 } from 'lucide-react';
import {
  backupNow, BackupInfo, BackupPrefs, formatBytes, inspectBackup, readBackupFile, reloadAsProfile, restoreMyBackup,
} from '../../lib/profiles';
import { confirmDialog } from '../../lib/confirm';
import { notify } from '../../lib/notify';

const SCHEDULES = [0, 1, 3, 7, 14];
const KEEP = [5, 10, 30];

/**
 * Settings › My profile › Backup: just this person's plans, progress, Log and
 * settings. The schedule goes through Settings' Save bar like everything else;
 * "Back up now", "Download" and "Restore" are actions, so they happen at once.
 */
export default function BackupSection({ info, prefs, onPrefs, onBackedUp, currentId }: {
  info: BackupInfo;
  prefs: BackupPrefs;
  onPrefs: (next: BackupPrefs) => void;
  onBackedUp: () => void;
  currentId: string;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState<'now' | 'restore' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canPick = info.canChooseFolder && Boolean(window.myFitnessPlan?.pickDirectory);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const runNow = async () => {
    setBusy('now');
    try {
      await backupNow();
      notify(t('backup.saved'), 'ok');
      onBackedUp();
    } catch {
      notify(t('backup.failed'));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    const data = await readBackupFile(file);
    if (!data) { notify(t('backup.not_a_backup')); return; }
    let summary;
    try {
      summary = await inspectBackup(data);
    } catch (err: any) {
      notify(t(err?.code === 'newer_version' ? 'backup.newer_version' : 'backup.not_a_backup'));
      return;
    }
    const mine = summary.profileId === currentId;
    // Replacing everything you have deserves the type-to-confirm; someone else's
    // backup gets a warning on top, but isn't refused — that's how a fresh
    // start or a new computer gets its data back.
    const ok = await confirmDialog({
      title: mine ? t('backup.restore_title') : t('backup.restore_other_title', { name: summary.profileName }),
      message: [
        mine ? '' : t('backup.restore_other_warning', { name: summary.profileName }),
        t('backup.restore_message', { date: when(summary.createdAt), plans: summary.plans, entries: summary.logEntries }),
      ].filter(Boolean).join('\n\n'),
      confirmLabel: t('backup.restore'),
      danger: true,
      typeToConfirm: t('profiles.confirm_word'),
    });
    if (!ok) return;
    setBusy('restore');
    try {
      await restoreMyBackup(data);
      // Every page reads its data on load: start over to see the restored set.
      reloadAsProfile();
    } catch {
      setBusy(null);
      notify(t('backup.restore_failed'));
    }
  };

  return (
    <section className="st-card">
      <header>
        <h2>{t('backup.heading')}</h2>
        <p>{t('backup.note')}</p>
      </header>

      <div className="bk-rows">
        <label className="bk-row">
          <span>{t('backup.automatic')}</span>
          <select className="bk-select" value={prefs.everyDays} onChange={e => onPrefs({ ...prefs, everyDays: Number(e.target.value) })}>
            {SCHEDULES.map(days => (
              <option key={days} value={days}>{days === 0 ? t('backup.off') : t('backup.every_days', { count: days })}</option>
            ))}
          </select>
        </label>

        {prefs.everyDays > 0 && (
          <label className="bk-row">
            <span>{t('backup.keep')}</span>
            <select className="bk-select" value={prefs.keep} onChange={e => onPrefs({ ...prefs, keep: Number(e.target.value) })}>
              {KEEP.map(n => <option key={n} value={n}>{t('backup.keep_n', { count: n })}</option>)}
            </select>
          </label>
        )}

        <div className="bk-row bk-row--folder">
          <span>{t('backup.folder')}</span>
          <code className="bk-path" title={prefs.dir || info.defaultFolder}>{prefs.dir || info.defaultFolder}</code>
          {canPick && (
            <div className="st-btns">
              <button type="button" className="st-btn" onClick={async () => {
                const picked = await window.myFitnessPlan?.pickDirectory();
                if (picked) onPrefs({ ...prefs, dir: picked });
              }}>
                <FolderOpen size={15} /> {t('backup.choose_folder')}
              </button>
              {prefs.dir && (
                <button type="button" className="st-btn" onClick={() => onPrefs({ ...prefs, dir: '' })}>
                  <Undo2 size={15} /> {t('backup.use_app_folder')}
                </button>
              )}
            </div>
          )}
        </div>
        {!info.canChooseFolder && <p className="pf-hint">{t('backup.elsewhere_note')}</p>}

        <p className="bk-last">
          {info.lastAt ? t('backup.last', { date: when(info.lastAt) }) : t('backup.never')}
          {info.files > 0 && <> · {t('backup.in_folder', { count: info.files, size: formatBytes(info.totalBytes) })}</>}
        </p>
        {info.overdue && <p className="bk-warn">{t('backup.overdue')}</p>}
        {info.canChooseFolder && window.myFitnessPlan?.openFolder && info.folderExists && (
          <div className="st-btns">
            <button type="button" className="st-btn" onClick={() => window.myFitnessPlan?.openFolder?.(info.folder)}>
              <FolderOpen size={15} /> {t('backup.open_folder')}
            </button>
          </div>
        )}
        {prefs.everyDays > 0 && <p className="pf-hint">{t('backup.prune_note', { count: prefs.keep })}</p>}
      </div>

      <div className="st-btns bk-actions">
        <button type="button" className="st-btn st-btn--primary" onClick={runNow} disabled={busy !== null}>
          {busy === 'now' ? <Loader size={15} className="st-spin" /> : <HardDriveDownload size={15} />}
          {' '}{info.canChooseFolder ? t('backup.now') : t('backup.now_on_computer')}
        </button>
        {/* On the computer with the app the folder already says where a backup
            goes; a download only adds something on a phone or the TV. */}
        {!info.canChooseFolder && (
          <a className="st-btn" href="/api/profiles/me/backup/download" download>
            <Download size={15} /> {t('backup.download')}
          </a>
        )}
        <button type="button" className="st-btn" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          {busy === 'restore' ? <Loader size={15} className="st-spin" /> : <RotateCcw size={15} />} {t('backup.restore_from')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) restore(file);
          }}
        />
      </div>
      <p className="pf-hint">{info.canChooseFolder ? t('backup.now_hint') : t('backup.buttons_hint')}</p>
    </section>
  );
}
