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

  // Keyed per request, so a word typed for one dialog never carries into the next.
  return <ConfirmDialog key={queue.length + current.title} request={current} onAnswer={answer} cancelText={t('transfer.cancel')} />;
}

function ConfirmDialog({ request, onAnswer, cancelText }: {
  request: ConfirmRequest;
  onAnswer: (ok: boolean) => void;
  cancelText: string;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const word = request.typeToConfirm;
  const unlocked = !word || typed.trim().toLowerCase() === word.toLowerCase();

  return (
    <Modal width={440} onClose={() => onAnswer(false)} label={request.title}>
      <div className="md-head" style={{ paddingBottom: 8 }}>
        <div className={`md-icon${request.danger ? ' md-icon--danger' : ''}`}>
          {request.danger ? <Trash2 size={24} /> : <TriangleAlert size={24} />}
        </div>
      </div>
      <div className="md-body">
        <div>
          <h2 className="md-title" style={{ fontSize: 22 }}>{request.title}</h2>
          {request.message && <p className="md-text" style={{ whiteSpace: 'pre-line' }}>{request.message}</p>}
        </div>
        {word && (
          <label className="md-confirm-word">
            <span>{t('confirm.type_word', { word })}</span>
            <input
              className="md-confirm-input"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && unlocked) onAnswer(true); }}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
            />
          </label>
        )}
      </div>
      <div className="md-foot">
        <button type="button" className="md-btn" onClick={() => onAnswer(false)} autoFocus={!word}>
          {request.cancelLabel || cancelText}
        </button>
        <button
          type="button"
          className={`md-btn ${request.danger ? 'md-btn--danger' : 'md-btn--primary'}`}
          onClick={() => onAnswer(true)}
          disabled={!unlocked}
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
