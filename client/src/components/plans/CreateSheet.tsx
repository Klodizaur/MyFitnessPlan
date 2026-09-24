import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download, HardDriveUpload, ListPlus, Sparkles } from 'lucide-react';

interface Props {
  aiAvailable: boolean;
  onUpload: () => void;
  onBuild: () => void;
  onAi: () => void;
  onImport: () => void;
  onBackup: () => void;
  onClose: () => void;
}

/** The phone's version of the desktop action row: one "+" opens all five. */
export default function CreateSheet(props: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const items = [
    { icon: ListPlus, label: t('plans.build_btn'), primary: true, run: props.onBuild },
    ...(props.aiAvailable ? [{ icon: Sparkles, label: t('ai.build_btn'), run: props.onAi }] : []),
    { icon: Download, label: t('plans.import_csv'), run: props.onUpload },
    { icon: Download, label: t('plans.import_json'), run: props.onImport, divider: true },
    { icon: HardDriveUpload, label: t('transfer.backup_all_btn'), run: props.onBackup },
  ] as { icon: typeof Download; label: string; note?: string; primary?: boolean; divider?: boolean; run: () => void }[];

  return createPortal(
    <>
      <div className="pl-backdrop" onClick={props.onClose} />
      <div className="pl-sheet pl-sheet--create" role="dialog" aria-modal="true">
        <div className="pl-sheet-grab" />
        {items.map(({ icon: Icon, label, note, primary, divider, run }) => (
          <button
            key={label}
            type="button"
            className={`pl-create-item${divider ? ' has-divider' : ''}`}
            onClick={() => { props.onClose(); run(); }}
          >
            <span className={`pl-create-icon${primary ? ' is-primary' : ''}`}><Icon size={18} /></span>
            <span>
              <span className="pl-create-label">{label}</span>
              {note && <span className="pl-create-note">{note}</span>}
            </span>
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
