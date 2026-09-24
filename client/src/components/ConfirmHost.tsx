import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, TriangleAlert } from 'lucide-react';
import { CONFIRM_EVENT, ConfirmRequest } from '../lib/confirm';
import Modal from './modal/Modal';

/** Shows the dialog for `confirmDialog()`. One is enough; a second request queues behind the first. */
export default function ConfirmHost() {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);

  useEffect(() => {
    const onRequest = (e: Event) => setQueue(prev => [...prev, (e as CustomEvent<ConfirmRequest>).detail]);
    window.addEventListener(CONFIRM_EVENT, onRequest);
    return () => window.removeEventListener(CONFIRM_EVENT, onRequest);
  }, []);

  const current = queue[0];
  if (!current) return null;

  const answer = (ok: boolean) => {
    current.resolve(ok);
    setQueue(prev => prev.slice(1));
  };

  return (
    <Modal width={440} onClose={() => answer(false)} label={current.title}>
      <div className="md-head" style={{ paddingBottom: 8 }}>
        <div className={`md-icon${current.danger ? ' md-icon--danger' : ''}`}>
          {current.danger ? <Trash2 size={24} /> : <TriangleAlert size={24} />}
        </div>
      </div>
      <div className="md-body">
        <div>
          <h2 className="md-title" style={{ fontSize: 22 }}>{current.title}</h2>
          {current.message && <p className="md-text" style={{ whiteSpace: 'pre-line' }}>{current.message}</p>}
        </div>
      </div>
      <div className="md-foot">
        <button type="button" className="md-btn" onClick={() => answer(false)} autoFocus>
          {current.cancelLabel || t('transfer.cancel')}
        </button>
        <button type="button" className={`md-btn ${current.danger ? 'md-btn--danger' : 'md-btn--primary'}`} onClick={() => answer(true)}>
          {current.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
