import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Droplet, Minus, Plus, Snowflake, Thermometer } from 'lucide-react';
import { FREEZE_REASONS, FreezeReason } from '../lib/freeze';
import { addDays } from './calendar/calendarModel';
import Modal, { CloseButton } from './modal/Modal';

const MAX_DAYS = 30;

const REASON_ICONS = { unwell: Thermometer, period: Droplet, freeze: Snowflake } as const;
/** Fixed colours: each reason keeps its meaning in every theme. */
const REASON_COLORS: Record<FreezeReason, string> = { unwell: '#C2410C', period: '#B3261E', freeze: '#2F6D9A' };

type Props = {
  planName: string;
  saving: boolean;
  onConfirm: (reason: FreezeReason, days: number) => void;
  onClose: () => void;
  /** Today's card in the calendar: picking a reason freezes just that one day,
   *  immediately — no day count, since this is meant as a quick per-day toggle,
   *  not the plan-wide "block out the next N days" tool the header offers. */
  singleDay?: boolean;
  /** The first day frozen, as YYYY-MM-DD, when it isn't today. */
  startDate?: string;
  /** The first workout day after freezing `days` days, so the sheet can say when things resume. */
  resumeFor?: (days: number) => string | null;
};

/** Reason and day count for freezing a plan from a given day. */
export default function FreezePlanModal({ planName, saving, onConfirm, onClose, singleDay = false, startDate, resumeFor }: Props) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState<FreezeReason | null>(null);
  const [days, setDays] = useState(1);

  const pickReason = (r: FreezeReason) => {
    if (singleDay) {
      onConfirm(r, 1);
      return;
    }
    setReason(r);
  };

  const fmt = (iso: string, options: Intl.DateTimeFormatOptions) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString(i18n.language, options);
  const todayIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const when = !startDate || startDate === todayIso
    ? t('calendar.freeze_from_today')
    : fmt(startDate, { weekday: 'short', day: 'numeric', month: 'short' });
  const resume = resumeFor?.(days);

  return (
    <Modal width={520} onClose={onClose} busy={saving} label={t('calendar.freeze_modal_heading')}>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title" style={{ fontSize: 22 }}>{t('calendar.freeze_modal_heading')}</h2>
          <div className="md-text" style={{ marginTop: 4 }}>
            {t(singleDay ? 'calendar.freeze_modal_subtitle_day' : 'calendar.freeze_modal_subtitle_from', { plan: planName, when })}
          </div>
        </div>
        <CloseButton onClick={onClose} disabled={saving} />
      </div>

      <div className="md-body" style={{ gap: 18 }}>
        <div className="md-reasons">
          {FREEZE_REASONS.map(r => {
            const Icon = REASON_ICONS[r];
            return (
              <button key={r} type="button" className={reason === r ? 'is-on' : ''} disabled={saving} aria-pressed={reason === r} onClick={() => pickReason(r)}>
                <Icon size={22} style={{ color: REASON_COLORS[r] }} />
                <span>{t(`calendar.freeze_reason_${r}`)}</span>
              </button>
            );
          })}
        </div>

        {!singleDay && (
          <>
            <div className="md-days">
              <span>{t('calendar.freeze_days_label')}</span>
              <button type="button" disabled={saving || days <= 1} onClick={() => setDays(d => Math.max(1, d - 1))} aria-label={t('calendar.freeze_days_decrease')}>
                <Minus size={18} />
              </button>
              <strong>{days}</strong>
              <button type="button" disabled={saving || days >= MAX_DAYS} onClick={() => setDays(d => Math.min(MAX_DAYS, d + 1))} aria-label={t('calendar.freeze_days_increase')}>
                <Plus size={18} />
              </button>
            </div>

            <div className="md-resume">
              <CalendarClock size={18} />
              <div>
                <b>{t('calendar.freeze_through', { date: fmt(addDays(startDate ?? todayIso, days - 1), { weekday: 'short', day: 'numeric', month: 'short' }) })}</b>
                {resume && <b>{t('calendar.freeze_resumes', { date: fmt(resume, { weekday: 'long', day: 'numeric', month: 'long' }) })}</b>}
                <span>{t('calendar.freeze_modal_hint')}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {!singleDay && (
        <div className="md-foot">
          <button type="button" className="md-btn" onClick={onClose} disabled={saving}>{t('profile.cancel')}</button>
          <button type="button" className="md-btn md-btn--primary" onClick={() => reason && onConfirm(reason, days)} disabled={saving || !reason} style={{ flex: 2 }}>
            {t('calendar.freeze_confirm', { count: days })}
          </button>
        </div>
      )}
    </Modal>
  );
}
