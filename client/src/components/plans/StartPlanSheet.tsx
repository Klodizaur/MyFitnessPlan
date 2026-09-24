import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CirclePlus, Star, X } from 'lucide-react';
import { PlanCardData } from './PlanCards';

export type Slot = 'main' | 'extra';

interface Props {
  plan: PlanCardData;
  /** Names of the plans currently in each slot, for the "Replaces …" note. */
  occupied: Record<Slot, string | null>;
  defaultSlot: Slot;
  defaultDate: string;
  onConfirm: (slot: Slot, date: string) => void;
  onClose: () => void;
}

/** Where the start date lives now: picked when a plan is started, not built in. */
export default function StartPlanSheet({ plan, occupied, defaultSlot, defaultDate, onConfirm, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [slot, setSlot] = useState<Slot>(defaultSlot);
  const [date, setDate] = useState(defaultDate);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const formatted = date
    ? new Date(`${date}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })
    : '';

  const options: { key: Slot; label: string; icon: typeof Star; note: string }[] = [
    {
      key: 'main',
      label: t('plans.slot_main'),
      icon: Star,
      note: occupied.main ? t('plans.replaces', { name: occupied.main }) : t('plans.slot_main_note'),
    },
    {
      key: 'extra',
      label: t('plans.slot_extra'),
      icon: CirclePlus,
      note: occupied.extra ? t('plans.replaces', { name: occupied.extra }) : t('plans.slot_extra_note'),
    },
  ];

  return createPortal(
    <>
      <div className="pl-backdrop" onClick={onClose} />
      <div className="pl-sheet" role="dialog" aria-modal="true">
        <div className="pl-sheet-grab" />
        <div className="pl-sheet-head">
          <div className={`pl-sheet-thumb${plan.cover ? '' : ' is-empty'}`}>
            <img src={plan.cover || '/logo.png'} alt="" />
          </div>
          <div className="pl-sheet-title">
            <div className="pl-sheet-eyebrow">{t('plans.start_plan_caps')}</div>
            <div className="pl-sheet-name">{plan.name}</div>
            <div className="pl-sheet-sub">{t('plans.workout_count', { count: plan.workoutCount })}</div>
          </div>
          <button type="button" className="pl-sheet-close" onClick={onClose} aria-label={t('plans.close')}>
            <X size={20} />
          </button>
        </div>

        <div className="pl-sheet-body">
          <div>
            <div className="pl-sheet-label">{t('plans.start_date')}</div>
            <input
              className="pl-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div>
            <div className="pl-sheet-label">{t('plans.activate_as')}</div>
            <div className="pl-kinds">
              {options.map(({ key, label, icon: Icon, note }) => (
                <button
                  key={key}
                  type="button"
                  className={`pl-kind${slot === key ? ' is-on' : ''}`}
                  onClick={() => setSlot(key)}
                >
                  <span className="pl-kind-label"><Icon size={17} />{label}</span>
                  <span className="pl-kind-note">{note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pl-sheet-foot">
          <button
            type="button"
            className="rx-btn rx-btn--primary pl-confirm"
            disabled={!date}
            onClick={() => onConfirm(slot, date)}
          >
            {t('plans.start_on', { date: formatted })}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
