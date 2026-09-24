import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Download } from 'lucide-react';

/** One quiet "Import" button that asks which file format on click. Desktop only. */
export default function ImportMenu({ onCsv, onJson }: { onCsv: () => void; onJson: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (run: () => void) => () => {
    setOpen(false);
    run();
  };

  return (
    <div className="pl-import" ref={ref}>
      <button type="button" className="pl-quiet" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Download size={16} />
        {t('plans.import')}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="pl-menu-pop" role="menu">
          <button type="button" role="menuitem" onClick={pick(onCsv)}>
            <Download size={16} />{t('plans.import_csv')}
          </button>
          <button type="button" role="menuitem" onClick={pick(onJson)}>
            <Download size={16} />{t('plans.import_json')}
          </button>
        </div>
      )}
    </div>
  );
}
