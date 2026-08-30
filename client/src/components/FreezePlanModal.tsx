import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FREEZE_REASONS, FREEZE_REASON_EMOJI, FreezeReason } from '../lib/freeze';

const MAX_DAYS = 30;

type Props = {
  planName: string;
  saving: boolean;
  onConfirm: (reason: FreezeReason, days: number) => void;
  onClose: () => void;
  /** Today's card in the calendar: picking a reason freezes just that one day,
   *  immediately — no day count, since this is meant as a quick per-day toggle,
   *  not the plan-wide "block out the next N days" tool the header offers. */
  singleDay?: boolean;
};

/** Reason (+ day-count, unless `singleDay`) picker for freezing a plan starting today. */
export default function FreezePlanModal({ planName, saving, onConfirm, onClose, singleDay = false }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<FreezeReason | null>(null);
  const [days, setDays] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickReason = (r: FreezeReason) => {
    if (singleDay) {
      onConfirm(r, 1);
      return;
    }
    setReason(r);
  };

  const submit = () => {
    if (!reason) return;
    onConfirm(reason, days);
  };

  const jsx = (
    <div className="wb-overlay freeze-overlay" onClick={onClose}>
      <div className="wb-modal freeze-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t('calendar.freeze_modal_heading')}>
        <div className="wb-header">
          <div>
            <h2 className="wb-title">{t('calendar.freeze_modal_heading')}</h2>
            <p className="wb-subtitle wb-subtitle-sm">
              {t(singleDay ? 'calendar.freeze_modal_subtitle_day' : 'calendar.freeze_modal_subtitle', { plan: planName })}
            </p>
          </div>
          <button className="wb-close" onClick={onClose} aria-label={t('profile.cancel')} disabled={saving}>✕</button>
        </div>

        <div className="freeze-reason-grid">
          {FREEZE_REASONS.map(r => (
            <button
              key={r}
              type="button"
              className={`freeze-reason-card${reason === r ? ' selected' : ''}`}
              disabled={saving}
              onClick={() => pickReason(r)}
            >
              <span className="freeze-reason-emoji" aria-hidden="true">{FREEZE_REASON_EMOJI[r]}</span>
              <span className="freeze-reason-label">{t(`calendar.freeze_reason_${r}`)}</span>
            </button>
          ))}
        </div>

        {!singleDay && (
          <>
            <div className="freeze-days-row">
              <span className="wb-label">{t('calendar.freeze_days_label')}</span>
              <div className="freeze-days-stepper">
                <button
                  type="button"
                  className="freeze-days-btn"
                  disabled={saving || days <= 1}
                  onClick={() => setDays(d => Math.max(1, d - 1))}
                  aria-label={t('calendar.freeze_days_decrease')}
                >
                  −
                </button>
                <span className="freeze-days-count">{days}</span>
                <button
                  type="button"
                  className="freeze-days-btn"
                  disabled={saving || days >= MAX_DAYS}
                  onClick={() => setDays(d => Math.min(MAX_DAYS, d + 1))}
                  aria-label={t('calendar.freeze_days_increase')}
                >
                  +
                </button>
              </div>
            </div>

            <p className="wb-hint freeze-modal-hint">{t('calendar.freeze_modal_hint')}</p>

            <div className="wb-actions">
              <button className="wb-btn wb-btn-ghost" onClick={onClose} disabled={saving}>{t('profile.cancel')}</button>
              <button className="wb-btn wb-btn-primary" onClick={submit} disabled={saving || !reason}>
                {t('calendar.freeze_confirm', { count: days })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(jsx, document.body);
}
