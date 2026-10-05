import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Delete } from 'lucide-react';

const LENGTH = 4;

/**
 * A 4-digit PIN: big keys for phones and the TV remote, and the keyboard works
 * on a computer. Submits on the fourth digit. `error` shakes the dots and
 * clears them, ready for another go — there is never a lockout.
 */
export default function PinPad({ onComplete, error, busy }: {
  onComplete: (pin: string) => void;
  error?: string | null;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);

  useEffect(() => {
    if (!error) return;
    setPin('');
    setShake(n => n + 1);
  }, [error]);

  const press = (digit: string) => {
    if (busy || pin.length >= LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === LENGTH) onComplete(next);
  };
  const back = () => { if (!busy) setPin(prev => prev.slice(0, -1)); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="pf-pin">
      <div key={shake} className={`pf-pin-dots${shake ? ' is-wrong' : ''}`} aria-label={t('profiles.pin_entered', { count: pin.length })}>
        {Array.from({ length: LENGTH }, (_, i) => <span key={i} className={i < pin.length ? 'is-on' : ''} />)}
      </div>
      <div className="pf-pin-error" role="alert">{error || ''}</div>
      <div className="pf-pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
          <button key={d} type="button" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" onClick={back} disabled={busy || !pin} aria-label={t('profiles.pin_delete')}><Delete size={22} /></button>
      </div>
    </div>
  );
}
