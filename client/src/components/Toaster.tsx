import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, X } from 'lucide-react';
import { NOTIFY_EVENT, Notice } from '../lib/notify';

const SHOW_MS = 6000;

/** Shows notices from `notify()` as a dark pop-up above the tab bar, like Settings' unsaved-changes bar. */
export default function Toaster() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    const onNotice = (e: Event) => {
      const notice = (e as CustomEvent<Notice>).detail;
      setNotices(prev => [...prev.slice(-2), notice]);
      window.setTimeout(() => setNotices(prev => prev.filter(n => n.id !== notice.id)), SHOW_MS);
    };
    window.addEventListener(NOTIFY_EVENT, onNotice);
    return () => window.removeEventListener(NOTIFY_EVENT, onNotice);
  }, []);

  if (notices.length === 0) return null;

  return createPortal(
    <div className="toaster" role="status" aria-live="polite">
      {notices.map(n => (
        <div key={n.id} className={`toast toast--${n.kind}`}>
          {n.kind === 'error' ? <CircleAlert size={18} /> : <Check size={18} />}
          <span>{n.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotices(prev => prev.filter(x => x.id !== n.id))}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
