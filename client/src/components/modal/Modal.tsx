import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import '../../styles/modals.css';

/**
 * The shell every dialog shares: a centred card on desktop, a bottom sheet with a
 * grab handle on a phone. Only the body scrolls; the header and footer stay put.
 */
export default function Modal({ width, onClose, busy = false, label, children }: {
  /** Desktop card width in px. */
  width: number;
  onClose: () => void;
  /** While something is in flight, backdrop clicks and Escape don't dismiss. */
  busy?: boolean;
  label?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return createPortal(
    <div className="md-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div
        className="md-card"
        style={{ ['--md-w' as string]: `${width}px` }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
      >
        <div className="md-grab"><span /></div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** The 40px soft close button every dialog carries. */
export function CloseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="md-close" onClick={onClick} disabled={disabled} aria-label={t('library.close')}>
      <X size={18} />
    </button>
  );
}
