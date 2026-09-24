import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import FreezePlanModal from '../components/FreezePlanModal';
import { FreezeReason } from '../lib/freeze';
import { useToday } from '../lib/dates';
import TapeView from '../components/calendar/TapeView';
import WeekView from '../components/calendar/WeekView';
import GridView from '../components/calendar/GridView';
import DayDetails from '../components/calendar/DayDetails';
import { PlanSchedule, addDays, unionDates } from '../components/calendar/calendarModel';
import '../styles/calendar.css';

export default function Calendar() {
  const { t } = useTranslation();
  const [planSchedules, setPlanSchedules] = useState<PlanSchedule[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<CalendarViewKey | null>(null);
  // "all" shows every active plan together; otherwise a single plan's id.
  const [planFilter, setPlanFilter] = useState<string>('all');
  // What the freeze sheet is about: which plan, from which day. `single` is the
  // legacy grid card's own toggle, which only ever covers exactly one day.
  const [freezeTarget, setFreezeTarget] = useState<{ planId: string; date: string; single: boolean } | null>(null);
  const [freezeSaving, setFreezeSaving] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tapeDate, setTapeDate] = useState<string | null>(null);
  // The day whose details popup is open (Week and Grid).
  const [detailsDate, setDetailsDate] = useState<string | null>(null);
  const today = useToday();
  const navigate = useNavigate();

  const loadSchedule = () =>
    fetch('/api/schedule')
      .then(res => res.json())
      .then(data => setPlanSchedules(data.schedules || []))
      .finally(() => setLoaded(true));

  useEffect(() => {
    // The default view comes from Settings. Older installs stored "list" or
    // "slider", which read as Grid.
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setView(prev => prev ?? (data.calendar_view === 'tape' || data.calendar_view === 'week' ? data.calendar_view : 'grid')))
      .catch(() => setView(prev => prev ?? 'tape'));
    loadSchedule();
  }, []);

  // Switching view here also becomes the default, the same setting Settings
  // edits, so it is still what you chose after a refresh.
  const chooseView = (next: CalendarViewKey) => {
    setView(next);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendar_view: next }),
    }).catch(() => { /* the view still changed on screen; it just won't be remembered */ });
  };

  const shown = planFilter === 'all'
    ? planSchedules
    : planSchedules.filter(p => p.planId === planFilter);
  // A plan that was deactivated while its chip was selected falls back to all.
  const effectiveShown = shown.length > 0 ? shown : planSchedules;

  const dates = useMemo(() => unionDates(effectiveShown), [effectiveShown]);

  // Open on today when the schedule reaches it; otherwise the next scheduled
  // day, or the last one. Re-picked whenever the chosen date drops out of range
  // (switching plan chips, or the schedule loading in).
  useEffect(() => {
    if (dates.length === 0) return;
    if (tapeDate && dates.includes(tapeDate)) return;
    setTapeDate(dates.includes(today) ? today : dates.find(d => d >= today) ?? dates[dates.length - 1]);
  }, [dates, today, tapeDate]);

  if (loaded && planSchedules.length === 0) {
    return (
      <div className="rx-wrap cal-empty-page">
        <h1 className="rx-h1">{t('nav.calendar')}</h1>
        <div className="cal-none">
          <strong>{t('calendar.no_active_schedule')}</strong>
          <div>{t('calendar.upload_in_settings')}</div>
        </div>
      </div>
    );
  }
  if (!loaded || view === null) return null;

  const handleFreeze = async (reason: FreezeReason, days: number) => {
    if (!freezeTarget) return;
    setFreezeSaving(true);
    try {
      const res = await fetch('/api/schedule/freeze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: freezeTarget.planId, reason, days, startDate: freezeTarget.date }),
      });
      if (res.ok) {
        setFreezeTarget(null);
        loadSchedule();
      }
    } finally {
      setFreezeSaving(false);
    }
  };

  const handleUnfreeze = async (planId: string, date: string) => {
    setBusyKey(`${planId}:${date}`);
    try {
      const res = await fetch(`/api/schedule/freeze/${encodeURIComponent(planId)}/${encodeURIComponent(date)}`, { method: 'DELETE' });
      if (res.ok) loadSchedule();
    } finally {
      setBusyKey(null);
    }
  };

  const freezePlan = planSchedules.find(p => p.planId === freezeTarget?.planId);

  return (
    <div className="cal">
      <div className="rx-wrap cal-head">
        <div className="cal-title-row">
          <h1 className="rx-h1">{t('nav.calendar')}</h1>
          <div className="rx-seg">
            {(['tape', 'week', 'grid'] as CalendarViewKey[]).map(key => (
              <button key={key} type="button" className={view === key ? 'is-on' : ''} onClick={() => chooseView(key)}>
                {t(`calendar.view_${key}`)}
              </button>
            ))}
          </div>
        </div>

        {planSchedules.length > 1 && (
          <div className="cal-chips">
            <PlanChip selected={planFilter === 'all'} onClick={() => setPlanFilter('all')} eyebrow={t('calendar.show')} name={t('calendar.all_plans')} />
            {planSchedules.map(plan => (
              <PlanChip
                key={plan.planId}
                selected={planFilter === plan.planId}
                onClick={() => setPlanFilter(plan.planId)}
                slot={plan.slot}
                image={plan.backgroundImage}
                name={plan.planName}
              />
            ))}
          </div>
        )}
      </div>

      {view === 'tape' ? (
        <div className="rx-wrap cal-body">
          {tapeDate && (
            <TapeView
              plans={effectiveShown}
              selectedDate={tapeDate}
              onSelect={setTapeDate}
              today={today}
              onOpen={(videoId, workoutId) => navigate(`/player/${videoId}/${workoutId}`)}
              onFreeze={(planId, date) => setFreezeTarget({ planId, date, single: false })}
              onUnfreeze={handleUnfreeze}
              busyKey={busyKey}
            />
          )}
        </div>
      ) : view === 'week' ? (
        <div className="rx-wrap cal-body">
          <WeekView
            plans={effectiveShown}
            today={today}
            onOpen={(videoId, workoutId) => navigate(`/player/${videoId}/${workoutId}`)}
            onDetails={setDetailsDate}
          />
        </div>
      ) : (
        <div className="rx-wrap cal-body">
          <GridView
            plans={effectiveShown}
            today={today}
            onOpen={(videoId, workoutId) => navigate(`/player/${videoId}/${workoutId}`)}
            onDetails={setDetailsDate}
          />
        </div>
      )}

      {detailsDate && (
        <DayDetails
          date={detailsDate}
          plans={effectiveShown}
          today={today}
          onClose={() => setDetailsDate(null)}
          onOpen={(videoId, workoutId) => navigate(`/player/${videoId}/${workoutId}`)}
          onFreeze={(planId, date) => { setDetailsDate(null); setFreezeTarget({ planId, date, single: false }); }}
          onUnfreeze={handleUnfreeze}
          busyKey={busyKey}
        />
      )}

      {freezeTarget && freezePlan && (
        <FreezePlanModal
          planName={freezePlan.planName}
          saving={freezeSaving}
          singleDay={freezeTarget.single}
          startDate={freezeTarget.date}
          // Rhythm dates don't move when days are frozen, so the first workout day
          // on or after the end of the freeze is when things pick up again.
          resumeFor={days => {
            const end = addDays(freezeTarget.date, days);
            return freezePlan.schedule.find(d => d.date >= end && d.isWorkoutDay)?.date ?? null;
          }}
          onConfirm={handleFreeze}
          onClose={() => setFreezeTarget(null)}
        />
      )}
    </div>
  );
}

type CalendarViewKey = 'tape' | 'week' | 'grid';

/** A plan filter chip: the plan's cover, its MAIN/EXTRA badge and its name. */
function PlanChip({ selected, onClick, eyebrow, slot, image, name }: {
  selected: boolean; onClick: () => void; eyebrow?: string; slot?: 'main' | 'extra'; image?: string | null; name: string;
}) {
  const { t } = useTranslation();
  return (
    <button type="button" className={`cal-chip${selected ? ' is-on' : ''}${slot ? ' has-img' : ''}`} onClick={onClick} aria-pressed={selected}>
      {slot && (
        <span className={`cal-chip-img${image ? '' : ' is-empty'}`}>
          <img src={image || '/logo.png'} alt="" />
        </span>
      )}
      <span className="cal-chip-text">
        {slot
          ? <span className={`rx-badge rx-badge--${slot}`}>{t(slot === 'main' ? 'calendar.plan_main' : 'calendar.plan_extra')}</span>
          : <span className="cal-chip-eyebrow">{eyebrow}</span>}
        <span className="cal-chip-name">{name}</span>
      </span>
    </button>
  );
}
