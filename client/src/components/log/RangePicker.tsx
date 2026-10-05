import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Modal, { CloseButton } from '../modal/Modal';
import { toDateStr } from './logModel';

/** The period the Breakdown covers. `custom` carries its own dates (inclusive). */
export type RangeKind = 'week' | 'month' | 'year' | 'all' | 'custom';
export interface Range { kind: RangeKind; from?: string; to?: string }

const PRESETS: Exclude<RangeKind, 'custom'>[] = ['week', 'month', 'year', 'all'];

/** The first and last day a range covers (null = no limit). */
export function rangeBounds(range: Range, today = new Date()): { from: string | null; to: string | null } {
  if (range.kind === 'all') return { from: null, to: null };
  if (range.kind === 'custom') return { from: range.from ?? null, to: range.to ?? range.from ?? null };
  const days = range.kind === 'week' ? 7 : range.kind === 'month' ? 30 : 365;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: toDateStr(start), to: toDateStr(today) };
}

export const inRange = (date: string, bounds: { from: string | null; to: string | null }) =>
  (!bounds.from || date >= bounds.from) && (!bounds.to || date <= bounds.to);

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** "5 Mar – 2 Apr 2026", in the interface language. */
export function useRangeLabel() {
  const { t, i18n } = useTranslation();
  return (range: Range): string => {
    if (range.kind !== 'custom' || !range.from) return t(`profile.range_${range.kind === 'custom' ? 'custom' : range.kind}`);
    const from = parse(range.from);
    const to = parse(range.to ?? range.from);
    const sameYear = from.getFullYear() === to.getFullYear();
    const short = (d: Date, withYear: boolean) =>
      d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
    if (range.from === (range.to ?? range.from)) return short(from, true);
    return `${short(from, !sameYear)} – ${short(to, true)}`;
  };
}

/**
 * The Breakdown's period: the presets (last 7 / 30 / 365 days, all time) or a
 * custom range picked on a calendar.
 */
export default function RangePicker({ value, onChange, activeDates }: {
  value: Range;
  onChange: (range: Range) => void;
  /** Days with something logged, marked on the calendar. */
  activeDates: Set<string>;
}) {
  const { t } = useTranslation();
  const label = useRangeLabel();
  const [picking, setPicking] = useState(false);

  return (
    <>
      <label className="lg-range">
        <span>{label(value)}</span>
        <ChevronDown size={13} />
        <select
          value={value.kind}
          onChange={e => {
            const kind = e.target.value as RangeKind | 'pick';
            if (kind === 'pick') setPicking(true);
            else onChange({ kind });
          }}
          aria-label={t('profile.summary_heading')}
        >
          {PRESETS.map(r => <option key={r} value={r}>{t(`profile.range_${r}`)}</option>)}
          {/* Shown while a custom range is active, so the menu says what's picked. */}
          {value.kind === 'custom' && <option value="custom">{label(value)}</option>}
          <option value="pick">{t('profile.range_pick')}</option>
        </select>
      </label>
      {value.kind === 'custom' && (
        <button type="button" className="lg-range-edit" onClick={() => setPicking(true)} aria-label={t('profile.range_pick')} title={t('profile.range_pick')}>
          <CalendarRange size={15} />
        </button>
      )}
      {picking && (
        <RangeDialog
          initial={value.kind === 'custom' ? value : null}
          activeDates={activeDates}
          onClose={() => setPicking(false)}
          onApply={range => { onChange(range); setPicking(false); }}
        />
      )}
    </>
  );
}

function RangeDialog({ initial, activeDates, onClose, onApply }: {
  initial: Range | null;
  activeDates: Set<string>;
  onClose: () => void;
  onApply: (range: Range) => void;
}) {
  const { t, i18n } = useTranslation();
  const label = useRangeLabel();
  const today = toDateStr(new Date());
  const [from, setFrom] = useState<string | null>(initial?.from ?? null);
  const [to, setTo] = useState<string | null>(initial?.to ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const base = initial?.to ? parse(initial.to) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  // Weekday initials starting Monday, in the interface language.
  const weekdays = useMemo(() => {
    const monday = new Date(2024, 0, 1);
    return Array.from({ length: 7 }, (_, i) =>
      new Date(monday.getFullYear(), 0, 1 + i).toLocaleDateString(i18n.language, { weekday: 'narrow' }));
  }, [i18n.language]);

  const cells = useMemo(() => {
    const first = new Date(month);
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) out.push(toDateStr(new Date(month.getFullYear(), month.getMonth(), d)));
    return out;
  }, [month]);

  // While only the start is picked, the hovered day previews where it would end.
  const end = to ?? (from && hover && hover >= from ? hover : null);
  const pick = (day: string) => {
    if (!from || to) { setFrom(day); setTo(null); return; }
    if (day < from) { setTo(from); setFrom(day); } else setTo(day);
  };

  const quick = (key: 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'thisYear') => {
    const now = new Date();
    let a: Date, b: Date = now;
    if (key === 'last7') { a = new Date(now); a.setDate(a.getDate() - 6); }
    else if (key === 'last30') { a = new Date(now); a.setDate(a.getDate() - 29); }
    else if (key === 'thisMonth') a = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (key === 'lastMonth') { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
    else a = new Date(now.getFullYear(), 0, 1);
    setFrom(toDateStr(a));
    setTo(toDateStr(b));
    setMonth(new Date(b.getFullYear(), b.getMonth(), 1));
  };

  const monthTitle = month.toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });
  const canGoNext = new Date(month.getFullYear(), month.getMonth() + 1, 1) <= new Date();
  const chosen: Range | null = from ? { kind: 'custom', from, to: to ?? from } : null;

  return (
    <Modal width={420} onClose={onClose} label={t('profile.range_pick')}>
      <div className="md-head">
        <div className="md-head-text">
          <h2 className="md-title">{t('profile.range_pick')}</h2>
          <div className="md-sub">{chosen ? label(chosen) : t('profile.range_pick_hint')}</div>
        </div>
        <CloseButton onClick={onClose} />
      </div>
      <div className="md-body">
        <div className="lg-quick">
          {(['last7', 'last30', 'thisMonth', 'lastMonth', 'thisYear'] as const).map(key => (
            <button key={key} type="button" onClick={() => quick(key)}>{t(`profile.quick_${key}`)}</button>
          ))}
        </div>

        <div className="lg-rcal">
          <div className="lg-rcal-head">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t('profile.prev_month')}>
              <ChevronLeft size={18} />
            </button>
            <span>{monthTitle}</span>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={!canGoNext} aria-label={t('profile.next_month')}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="lg-rcal-grid" onMouseLeave={() => setHover(null)}>
            {weekdays.map((d, i) => <span key={`w${i}`} className="lg-rcal-dow">{d}</span>)}
            {cells.map((day, i) => {
              if (!day) return <span key={`e${i}`} />;
              const future = day > today;
              const isStart = day === from;
              const isEnd = day === end;
              const inside = from && end && day > from && day < end;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={future}
                  onClick={() => pick(day)}
                  onMouseEnter={() => setHover(day)}
                  className={[
                    'lg-rcal-day',
                    isStart || isEnd ? 'is-edge' : '',
                    inside ? 'is-in' : '',
                    isStart && end && end !== from ? 'is-start' : '',
                    isEnd && from && end !== from ? 'is-end' : '',
                    day === today ? 'is-today' : '',
                  ].filter(Boolean).join(' ')}
                  aria-pressed={Boolean(isStart || isEnd || inside)}
                  aria-label={parse(day).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}
                >
                  {Number(day.slice(8))}
                  {activeDates.has(day) && <i className="lg-rcal-dot" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="md-foot md-foot--line">
        <button type="button" className="md-btn" onClick={onClose}>{t('transfer.cancel')}</button>
        <button type="button" className="md-btn md-btn--primary" disabled={!chosen} onClick={() => chosen && onApply(chosen)}>
          {t('profile.range_apply')}
        </button>
      </div>
    </Modal>
  );
}
