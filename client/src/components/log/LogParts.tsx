import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, ChevronRight, Moon, NotebookPen, Pencil, Trash2, Trophy, X } from 'lucide-react';
import { useMetaLabels } from '../../lib/labels';
import { Video } from '../../types/video';
import { TagRow } from '../library/LibraryCards';
import { PlanMenu } from '../plans/PlanCards';
import '../../styles/plans.css';
import { findLoggedVideo, LogEntry, LogGroup, FinishedPlan, PlanProgress, entryTags, stripExt } from './logModel';

/* --- Stats ------------------------------------------------------------------------- */

export interface Stat { value: string; label: string }

/** A plain grid with 1px accent dividers between cells — no outer border, no background. */
export function StatsBand({ stats }: { stats: Stat[] }) {
  return (
    <div className="lg-stats">
      {stats.map(s => (
        <div key={s.label} className="lg-stat">
          <div className="lg-stat-value">{s.value}</div>
          <div className="lg-stat-label">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/* --- Activity calendar -------------------------------------------------------------- */

interface CalendarProps {
  cells: (string | null)[];
  monthLabel: string;
  activeDays: number;
  today: string;
  selectedDate: string | null;
  countFor: (date: string) => number;
  onPick: (date: string) => void;
  onMonth: (delta: number) => void;
  /** False once the month on screen is the current one: there's nothing to look at later. */
  canGoNext: boolean;
}

/** The month as flat squares: any day with a workout is one orange, however many it had. */
export function ActivityCalendar({ cells, monthLabel, activeDays, today, selectedDate, countFor, onPick, onMonth, canGoNext }: CalendarProps) {
  const { t } = useTranslation();
  const dows = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(k => t(`calendar.${k}`).charAt(0).toUpperCase());

  return (
    <div className="lg-cal">
      <div className="lg-cal-head">
        <div className="lg-cal-title">
          <div className="lg-eyebrow">{monthLabel}</div>
          <div className="lg-cal-count">{t('profile.active_days_count', { count: activeDays })}</div>
        </div>
        <button type="button" className="lg-circle" aria-label={t('profile.prev_month')} onClick={() => onMonth(-1)}><ChevronLeft size={16} /></button>
        <button type="button" className="lg-circle" aria-label={t('profile.next_month')} disabled={!canGoNext} onClick={() => onMonth(1)}><ChevronRight size={16} /></button>
      </div>

      <div className="lg-heat">
        {dows.map((d, i) => <div key={i} className="lg-heat-dow">{d}</div>)}
        {cells.map((date, i) => {
          if (!date) return <div key={i} className="lg-heat-pad" />;
          const n = countFor(date);
          const future = date > today;
          const cls = `lg-day${n > 0 ? ' is-active' : ''}${future ? ' is-future' : ''}${date === today ? ' is-today' : ''}${date === selectedDate ? ' is-sel' : ''}`;
          return (
            <button key={i} type="button" className={cls} disabled={n === 0} onClick={() => onPick(date)} aria-pressed={date === selectedDate}>
              {Number(date.slice(8))}
            </button>
          );
        })}
      </div>

      <div className="lg-legend">
        <span><i className="lg-legend-on" />{t('profile.you_moved')}</span>
        <span><i className="lg-legend-today" />{t('calendar.today')}</span>
      </div>
    </div>
  );
}

/* --- Journal ------------------------------------------------------------------------- */

interface GroupProps {
  group: LogGroup;
  date: string;
  videosById: Map<string, Video>;
  onSaveNote: (ids: string[], notes: string) => Promise<void>;
  onSaveDate: (ids: string[], date: string) => Promise<void>;
  onDelete: (group: LogGroup) => void;
  onEditVideo: (video: Video) => void;
}

/** One logged workout: its videos, the note, and the quiet text actions. */
export function JournalGroup({ group, date, videosById, onSaveNote, onSaveDate, onDelete, onEditVideo }: GroupProps) {
  const { t } = useTranslation();
  const labels = useMetaLabels();
  const ids = group.entries.map(e => e.id);
  const [mode, setMode] = useState<'view' | 'note' | 'date'>('view');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = async (run: () => Promise<void>) => {
    setBusy(true);
    try { await run(); } finally { setBusy(false); setMode('view'); }
  };

  // The tags and title come from each logged video; a manual entry with no video
  // shows the name it was logged under instead.
  const rows: { key: string; entry: LogEntry; title: string }[] = group.entries.map((entry, i) => ({
    key: entry.id,
    entry,
    title: entry.videoFilename ? stripExt(entry.videoFilename) : group.nameLines[i] || group.nameLines[0] || t('profile.untitled_workout'),
  }));

  const editable = rows.flatMap(({ entry, title }) => {
    const video = findLoggedVideo(videosById, entry);
    return video ? [{ video, title }] : [];
  });

  return (
    <div className="lg-group">
      {mode === 'view' && (
        <PlanMenu
          className="lg-menu"
          items={[
            { label: group.notes ? t('profile.notes_edit') : t('profile.notes_add'), icon: <NotebookPen size={16} />, run: () => { setDraft(group.notes); setMode('note'); } },
            { label: t('profile.edit_date'), icon: <CalendarDays size={16} />, run: () => { setDraft(date); setMode('date'); } },
            // One entry per video: a workout logged from several videos edits each on its own.
            ...editable.map(({ video, title }) => ({
              label: editable.length > 1 ? `${t('profile.edit_video')} · ${title}` : t('profile.edit_video'),
              icon: <Pencil size={16} />,
              run: () => onEditVideo(video),
            })),
            { label: t('profile.delete_entry'), icon: <Trash2 size={16} />, danger: true, run: () => onDelete(group) },
          ]}
        />
      )}
      {rows.map(({ key, entry, title }, i) => {
        return (
          <div key={key} className="lg-item">
            <div className="lg-thumb">{entry.thumbnail ? <img src={`/thumbnails/${entry.thumbnail}`} alt="" loading="lazy" /> : null}</div>
            <div className="lg-item-body">
              {i === 0 && group.planName && <span className="lg-plan">{group.planName}</span>}
              <div className="lg-item-title">
                {title}
                {entry.loopCount && entry.loopCount > 1 && (
                  <span className="lg-loop" title={t('profile.loop_badge_aria', { count: entry.loopCount })}>{entry.loopCount}×</span>
                )}
              </div>
              <TagRow tags={entryTags(entry, labels)} rows={2} />
            </div>
          </div>
        );
      })}

      {mode === 'note' ? (
        <div className="lg-edit">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('profile.notes_placeholder')}
            maxLength={2000}
            rows={3}
            autoFocus
          />
          <div className="lg-edit-actions">
            <button type="button" className="is-primary" disabled={busy} onClick={() => finish(() => onSaveNote(ids, draft))}>{t('profile.save_note')}</button>
            <button type="button" disabled={busy} onClick={() => setMode('view')}>{t('profile.cancel')}</button>
          </div>
        </div>
      ) : mode === 'date' ? (
        <div className="lg-edit lg-edit--date">
          <input type="date" value={draft} onChange={e => setDraft(e.target.value)} />
          <div className="lg-edit-actions">
            <button type="button" className="is-primary" disabled={busy || !draft} onClick={() => finish(() => onSaveDate(ids, draft))}>{t('profile.save')}</button>
            <button type="button" disabled={busy} onClick={() => setMode('view')}>{t('profile.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          {group.notes && <div className="lg-note">{group.notes}</div>}
        </>
      )}
    </div>
  );
}

/** "3 rest days" between two active days. */
export function RestGap({ days }: { days: number }) {
  const { t } = useTranslation();
  return (
    <div className="lg-gap"><Moon size={13} />{t('profile.rest_days', { count: days })}</div>
  );
}

/* --- What you trained ------------------------------------------------------------------ */

export interface Segment { label: string; value: number }

/** Colours for the shares, darkest first; they come from the theme so every theme reads. */
const shade = (i: number) => `var(--lg-s${i % 6})`;

export function MixChart({ segments, chart, total }: { segments: Segment[]; chart: 'bars' | 'pie'; total: number }) {
  const { t } = useTranslation();
  const max = segments.reduce((m, s) => Math.max(m, s.value), 0);
  const sum = segments.reduce((a, s) => a + s.value, 0);

  if (sum === 0) return <p className="lg-empty">{t('profile.no_tagged')}</p>;

  if (chart === 'pie') {
    let acc = 0;
    const stops = segments.map((s, i) => {
      const from = (acc / sum) * 100;
      acc += s.value;
      return `${shade(i)} ${from}% ${(acc / sum) * 100}%`;
    }).join(', ');
    return (
      <div className="lg-pie">
        <div className="lg-pie-ring" style={{ background: `conic-gradient(${stops})` }}>
          <div className="lg-pie-hole">
            <strong>{total}</strong>
            <span>{t('profile.total')}</span>
          </div>
        </div>
        <div className="lg-legend-list">
          {segments.map((s, i) => (
            <div key={s.label}>
              <i style={{ background: shade(i) }} />
              <span>{s.label}</span>
              <b>{s.value}</b>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lg-bars">
      {segments.map((s, i) => (
        <div key={s.label} className="lg-bar-row">
          <div className="lg-bar">
            <span className="lg-bar-fill" style={{ width: `${(s.value / max) * 100}%`, background: shade(i) }} />
            {/* Two copies of the label: the ink one over the empty track, and one in the
                fill's own contrasting colour clipped to the fill, so the text reads on
                both halves wherever the bar happens to end. */}
            <span className="lg-bar-label">{s.label}</span>
            <span
              className="lg-bar-label lg-bar-label--fill"
              aria-hidden="true"
              style={{ clipPath: `inset(0 ${100 - (s.value / max) * 100}% 0 0)`, color: `var(--lg-on${i % 6})` }}
            >
              {s.label}
            </span>
          </div>
          <b>{s.value}</b>
        </div>
      ))}
    </div>
  );
}

/* --- Plans ----------------------------------------------------------------------------- */

export function PlansPanel({ started, finished, onForget }: { started: PlanProgress[]; finished: FinishedPlan[]; onForget: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  if (started.length === 0 && finished.length === 0) return null;

  return (
    <div className="lg-plans">
      <h2>{t('profile.plans_heading')}</h2>
      {started.map(plan => {
        const pct = plan.totalWorkouts ? Math.round((plan.completedWorkouts / plan.totalWorkouts) * 100) : 0;
        return (
          <div key={plan.id} className="lg-plan-row">
            <div className="lg-ring" style={{ background: `conic-gradient(var(--t-accent) 0 ${pct}%, var(--t-tint) ${pct}% 100%)` }}>
              <span>{plan.completedWorkouts}/{plan.totalWorkouts}</span>
            </div>
            <div className="lg-plan-text">
              <div className="lg-plan-name">{plan.name}</div>
              <div className="lg-plan-sub">
                {plan.slot ? `${t(plan.slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')} · ` : ''}{t('profile.in_progress')}
              </div>
            </div>
          </div>
        );
      })}
      {finished.map(plan => (
        <div key={plan.id} className="lg-plan-row">
          <div className="lg-trophy"><Trophy size={20} /></div>
          <div className="lg-plan-text">
            <div className="lg-plan-name">{plan.planName}</div>
            <div className="lg-plan-sub">
              {t('profile.plans_finished_on', {
                date: new Date(plan.finishedOn + 'T00:00:00').toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }),
              })}
              {plan.daysTaken ? ` · ${t('profile.plans_took_days', { count: plan.daysTaken })}` : ''}
              {plan.workoutCount ? ` · ${t('plans.workout_count', { count: plan.workoutCount })}` : ''}
            </div>
          </div>
          <button type="button" className="lg-icon-quiet" title={t('profile.plans_forget')} aria-label={t('profile.plans_forget')} onClick={() => onForget(plan.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
      <p className="lg-plans-note">{t('profile.plans_hint')}</p>
    </div>
  );
}
