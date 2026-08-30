import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMetaLabels } from '../lib/labels';
import AddLogEntryModal from '../components/AddLogEntryModal';
import VideoMetadataEditor from '../components/VideoMetadataEditor';
import { Video } from '../types/video';

type LogEntry = {
  id: string;
  workoutId: string | null;
  videoId: string | null;
  planName: string | null;
  workoutName: string | null;
  videoFilename: string | null;
  thumbnail: string | null;
  completedDate: string;
  completedAt: string;
  isManual: boolean;
  notes: string;
  /** Times through the video, when it was looped in the player; null otherwise. */
  loopCount: number | null;
  durationSeconds: number | null;
  trainingType: string[];
  bodyParts: string[];
  intensity: string | null;
  equipment: string[];
};

const API = '';

// Distinct, theme-agnostic colors for the pie/donut segments.
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#eab308',
];

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Workout names can be multi-line TSV blobs like "Week 1 - Day 1\nFull Body (30 min)".
// Trim the "Week X - Day Y" prefix and "(NN min)" suffixes and return each video
// title as its own line, so multi-video days are never rendered as one merged clump.
function workoutNameLines(name: string | null): string[] {
  if (!name) return [];
  return name
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((line, i) => !(i === 0 && /^week\s*\d+\s*-\s*day\s*\d+/i.test(line)))
    .map(line => line.replace(/\s*\(\d+\s*min\)\s*/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function cleanWorkoutName(name: string | null): string {
  if (!name) return '';
  const lines = workoutNameLines(name);
  return lines.length ? lines.join(' - ') : name;
}

// Drop the file extension so "Full Body HIIT.mp4" displays as "Full Body HIIT".
function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}

// One display title per completed video (falling back to the workout name lines),
// so a day with several videos lists each one separately.
function entryTitles(e: LogEntry): string[] {
  if (e.videoFilename) return [stripExt(e.videoFilename)];
  const lines = workoutNameLines(e.workoutName);
  return lines.length ? lines : [];
}

// "18h 45m", or "45m" under an hour. Rounded down to whole minutes.
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** A plan carried to the end. Kept even after the plan is edited or deleted. */
interface FinishedPlan {
  id: string;
  planId: string | null;
  planName: string;
  workoutCount: number;
  startedOn: string | null;
  finishedOn: string;
  daysTaken: number | null;
}

/** How far through each plan the user is, from the plan's own completion marks. */
interface PlanProgress {
  id: string;
  name: string;
  slot: 'main' | 'extra' | null;
  totalWorkouts: number;
  completedWorkouts: number;
  isFinished: boolean;
}

function StatCard({ value, label, icon }: { value: number | string; label: string; icon: string }) {
  return (
    <div className="glass-card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '1.4rem' }}>{icon}</span>
      <span style={{ fontSize: '1.9rem', fontWeight: 800, color: 'var(--accent-color)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}

function Tag({ text }: { text: string }) {
  return (
    <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: 12, background: 'var(--surface-hover)', color: 'var(--text-primary)' }}>
      {text}
    </span>
  );
}

function Donut({
  segments,
  centerLabel,
  centerSub,
  size = 190,
  thickness = 26,
}: {
  segments: { label: string; value: number; color: string }[];
  centerLabel: string;
  centerSub: string;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--progress-bg)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s, i) => {
            const len = (s.value / total) * circumference;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-acc}
              />
            );
            acc += len;
            return el;
          })}
      </g>
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--text-primary)', fontSize: '1.9rem', fontWeight: 800 }}>
        {centerLabel}
      </text>
      <text x="50%" y="61%" textAnchor="middle" dominantBaseline="middle" style={{ fill: 'var(--text-secondary)', fontSize: '0.7rem', letterSpacing: '1px' }}>
        {centerSub.toUpperCase()}
      </text>
    </svg>
  );
}

export default function Profile() {
  const { t, i18n } = useTranslation();
  const labels = useMetaLabels();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRange] = useState<'week' | 'month' | 'year' | 'all'>('month');
  const [dimension, setDimension] = useState<'type' | 'body' | 'equipment' | 'intensity'>('type');
  const [chartType, setChartType] = useState<'pie' | 'bar'>('pie');

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDateValue, setEditDateValue] = useState('');
  const [savingDate, setSavingDate] = useState(false);
  const [notesKey, setNotesKey] = useState<string | null>(null);
  const [notesValue, setNotesValue] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [addDate, setAddDate] = useState<string | null>(null);
  const [videosById, setVideosById] = useState<Map<string, Video>>(new Map());
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);

  const [planProgress, setPlanProgress] = useState<PlanProgress[]>([]);
  const [finishedPlans, setFinishedPlans] = useState<FinishedPlan[]>([]);

  // Reloaded alongside history, since removing a completion changes both.
  const loadPlanProgress = async () => {
    try {
      const res = await fetch(`${API}/api/profile/plan-progress`);
      const data = await res.json();
      setPlanProgress(data.plans || []);
      setFinishedPlans(data.finished || []);
    } catch {
      setPlanProgress([]);
      setFinishedPlans([]);
    }
  };

  const handleDeleteFinished = async (id: string) => {
    if (!window.confirm(t('profile.plans_forget_confirm'))) return;
    try {
      await fetch(`${API}/api/profile/plan-completions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadPlanProgress();
    } catch (err) {
      console.error('Failed to remove finished plan', err);
    }
  };

  const loadHistory = async (): Promise<LogEntry[]> => {
    try {
      const res = await fetch(`${API}/api/profile/history`);
      const data = await res.json();
      const list: LogEntry[] = data.entries || [];
      setEntries(list);
      loadPlanProgress();
      return list;
    } catch {
      setEntries([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory().then(list => {
      if (list.length) {
        // Jump to the most recent activity (entries are returned newest-first).
        const recent = list[0].completedDate;
        const [y, m] = recent.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
        setSelectedDate(recent);
      }
    });
  }, []);

  // Library videos, keyed by id, so a log entry's linked video can be opened in the
  // same metadata editor used on the Library page. The log reads video tags live, so
  // reloading history after a save reflects the edits immediately.
  useEffect(() => {
    fetch(`${API}/api/library/videos`)
      .then(r => r.json())
      .then((data: Video[]) => {
        if (Array.isArray(data)) setVideosById(new Map(data.map(v => [v.id, v])));
      })
      .catch(() => {});
  }, []);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, LogEntry[]>();
    for (const e of entries) {
      const arr = map.get(e.completedDate) || [];
      arr.push(e);
      map.set(e.completedDate, arr);
    }
    return map;
  }, [entries]);

  const stats = useMemo(() => {
    const totalSeconds = entries.reduce((sum, e) => sum + (e.durationSeconds || 0), 0);
    // How many entries could contribute a runtime at all, so the UI can say when
    // the total is partial (manual entries and un-probed videos have none).
    const timedEntries = entries.filter(e => e.durationSeconds).length;
    const activeDays = new Set(entries.map(e => e.completedDate));
    const workoutSet = new Set(entries.map(e => `${e.completedDate}|${e.workoutId || e.workoutName || e.id}`));
    // Days you trained in the month on screen, not workouts logged — two
    // sessions in a day is still one day you showed up. This one follows the
    // calendar below as you page through months; every other tile is all-time
    // and deliberately stays put.
    const monthPrefix = `${viewYear}-${pad(viewMonth + 1)}`;
    const viewMonthSet = new Set(
      entries.filter(e => e.completedDate.startsWith(monthPrefix)).map(e => e.completedDate)
    );
    return {
      workouts: workoutSet.size,
      activeDays: activeDays.size,
      viewMonthDays: viewMonthSet.size,
      totalSeconds,
      timedEntries,
      untimedEntries: entries.length - timedEntries,
    };
  }, [entries, viewYear, viewMonth]);

  const planStats = useMemo(() => {
    // In-progress plans that aren't finished. A finished one is represented by
    // its durable record below instead, so it doesn't appear twice.
    const started = planProgress.filter(p => p.completedWorkouts > 0 && !p.isFinished);
    return {
      // All-time, from the durable record — not a count of plans that happen to
      // still exist and still hold their marks.
      finished: finishedPlans.length,
      // Only plans you've actually touched are worth listing; a library of
      // untouched plans would bury the ones you're working through.
      started: started.sort((a, b) => {
        const ratio = (p: PlanProgress) => (p.totalWorkouts ? p.completedWorkouts / p.totalWorkouts : 0);
        return ratio(b) - ratio(a);
      }),
    };
  }, [planProgress, finishedPlans]);

  const rangeEntries = useMemo(() => {
    if (range === 'all') return entries;
    const days = range === 'week' ? 7 : range === 'month' ? 30 : 365;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return entries.filter(e => {
      const d = new Date(e.completedDate + 'T00:00:00');
      const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
      return diff >= 0 && diff < days;
    });
  }, [entries, range]);

  const segments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of rangeEntries) {
      let values: string[] = [];
      if (dimension === 'type') values = e.trainingType || [];
      else if (dimension === 'body') values = e.bodyParts || [];
      else if (dimension === 'equipment') values = e.equipment || [];
      else values = e.intensity ? [e.intensity] : [];
      for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const labelFor = (key: string) =>
      dimension === 'type' ? labels.trainingType(key)
        : dimension === 'body' ? labels.bodyPart(key)
        : dimension === 'equipment' ? labels.equipment(key)
        : labels.intensity(key);
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value)
      .map((s, i) => ({ label: labelFor(s.key), value: s.value, color: PALETTE[i % PALETTE.length] }));
  }, [rangeEntries, dimension, labels]);

  const totalTagged = segments.reduce((s, x) => s + x.value, 0);
  const maxSegmentValue = segments.reduce((m, x) => Math.max(m, x.value), 0);

  const cells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const arr: (string | null)[] = [];
    for (let i = 0; i < startOffset; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(`${viewYear}-${pad(viewMonth + 1)}-${pad(d)}`);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [viewYear, viewMonth]);

  const todayStr = toDateStr(new Date());
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' });

  const gotoMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  // One name per completed video, so multi-video days list each video separately
  // in the calendar cell instead of a single merged clump of titles.
  const workoutNamesForDay = (dateStr: string): string[] => {
    const dayEntries = entriesByDate.get(dateStr) || [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const e of dayEntries) {
      const titles = entryTitles(e);
      if (titles.length === 0) titles.push(t('profile.untitled_workout'));
      for (const title of titles) {
        const key = `${e.workoutId || e.id}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        names.push(title);
      }
    }
    return names;
  };

  const selectedGroups = useMemo(() => {
    if (!selectedDate) return [];
    const dayEntries = entriesByDate.get(selectedDate) || [];
    const groups = new Map<string, { key: string; name: string; nameLines: string[]; planName: string | null; isManual: boolean; entries: LogEntry[] }>();
    for (const e of dayEntries) {
      const key = e.workoutId || e.workoutName || e.id;
      const g = groups.get(key) || { key, name: cleanWorkoutName(e.workoutName), nameLines: [], planName: e.planName, isManual: false, entries: [] };
      g.isManual = g.isManual || e.isManual;
      g.entries.push(e);
      groups.set(key, g);
    }
    // `workout_name` on a plan day is a blob listing EVERY video scheduled that day,
    // so it must never be used as a title when the entries carry their own videos —
    // only the videos actually marked done are shown, one row each. Name lines are
    // kept solely for entries with no linked video (manually logged workouts).
    return Array.from(groups.values()).map(g => ({
      ...g,
      nameLines: g.entries.every(e => e.videoFilename) ? [] : workoutNameLines(g.entries[0].workoutName),
      // The note is mirrored across the workout's rows; take the first one set.
      notes: g.entries.find(e => e.notes)?.notes || '',
    }));
  }, [selectedDate, entriesByDate]);

  const saveEditDate = async (ids: string[]) => {
    if (!editDateValue || savingDate) return;
    setSavingDate(true);
    try {
      const res = await fetch(`${API}/api/profile/history/date`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, completedDate: editDateValue }),
      });
      if (res.ok) {
        const newDate = editDateValue;
        await loadHistory();
        // Follow the moved workout to its new day.
        const [y, m] = newDate.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
        setSelectedDate(newDate);
      }
    } catch (err) {
      console.error('Failed to update date', err);
    } finally {
      setSavingDate(false);
      setEditingKey(null);
      setEditDateValue('');
    }
  };

  const saveNotes = async (ids: string[]) => {
    if (savingNotes) return;
    setSavingNotes(true);
    try {
      const res = await fetch(`${API}/api/profile/history/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, notes: notesValue }),
      });
      if (res.ok) await loadHistory();
    } catch (err) {
      console.error('Failed to save notes', err);
    } finally {
      setSavingNotes(false);
      setNotesKey(null);
      setNotesValue('');
    }
  };

  /**
   * Remove a logged workout, however it got here.
   *
   * A workout marked done inside a plan also clears the ✓ from that plan's
   * calendar, since the log and the plan are two records of the same event and
   * leaving one behind would have them disagree. The confirm says so.
   */
  const handleDeleteEntry = async (workoutKey: string, isManual: boolean) => {
    if (!window.confirm(t(isManual ? 'profile.delete_confirm' : 'profile.delete_planned_confirm'))) return;
    try {
      await fetch(`${API}/api/profile/history/${encodeURIComponent(workoutKey)}`, { method: 'DELETE' });
      await loadHistory();
    } catch (err) {
      console.error('Failed to delete log entry', err);
    }
  };

  // Rendered from whichever return path is active; it portals into <body>, so its
  // placement in the tree doesn't matter. Reloads history and jumps to the day
  // that was just logged.
  const addModal = addDate ? (
    <AddLogEntryModal
      date={addDate}
      onClose={() => setAddDate(null)}
      onSaved={(d) => {
        setAddDate(null);
        loadHistory().then(() => {
          const [yy, mm] = d.split('-').map(Number);
          setViewYear(yy);
          setViewMonth(mm - 1);
          setSelectedDate(d);
        });
      }}
    />
  ) : null;

  if (loading) {
    return (
      <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
        {t('profile.loading')}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="animate-fade-in">
        <h1 style={{ marginBottom: '0.5rem' }}>{t('profile.title')}</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{t('profile.subtitle')}</p>
        <div className="glass-card" style={{ padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div style={{ fontSize: '3rem' }}>📆</div>
          <h2 style={{ margin: 0 }}>{t('profile.empty_title')}</h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: 460 }}>{t('profile.empty_msg')}</p>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn" onClick={() => navigate('/plans')}>{t('profile.empty_cta_plan')}</button>
            <button className="btn btn-secondary" onClick={() => setAddDate(todayStr)}>{t('profile.empty_cta_manual')}</button>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>{t('profile.empty_cta_dashboard')}</button>
          </div>
        </div>
        {addModal}
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <h1 style={{ marginBottom: '0.5rem' }}>{t('profile.title')}</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>{t('profile.subtitle')}</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <StatCard value={stats.workouts} label={t('profile.stats_workouts')} icon="🏋️" />
        <StatCard value={stats.activeDays} label={t('profile.stats_active_days')} icon="📅" />
        <StatCard
          value={stats.viewMonthDays}
          label={t('profile.stats_active_days_in', { month: monthLabel })}
          icon="🗓️"
        />
        <StatCard
          value={stats.timedEntries > 0 ? formatDuration(stats.totalSeconds) : '—'}
          label={stats.timedEntries === 0
            ? t('profile.stats_total_time_none')
            : stats.untimedEntries > 0
            ? t('profile.stats_total_time_partial')
            : t('profile.stats_total_time')}
          icon="⏱️"
        />
        <StatCard value={planStats.finished} label={t('profile.stats_plans_finished')} icon="🏆" />
      </div>

      {/* Activity calendar */}
      <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>{t('profile.calendar_heading')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '1.1rem' }} onClick={() => gotoMonth(-1)} aria-label="previous month">‹</button>
            <span style={{ minWidth: 150, textAlign: 'center', fontWeight: 700, textTransform: 'capitalize' }}>{monthLabel}</span>
            <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '1.1rem' }} onClick={() => gotoMonth(1)} aria-label="next month">›</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {WEEKDAY_KEYS.map(k => (
            <div key={k} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', paddingBottom: 4 }}>
              {t(`calendar.${k}`)}
            </div>
          ))}
          {cells.map((dateStr, idx) => {
            if (!dateStr) return <div key={idx} />;
            const names = workoutNamesForDay(dateStr);
            const has = names.length > 0;
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const dayNum = Number(dateStr.split('-')[2]);
            return (
              <div
                key={idx}
                className="log-day"
                onClick={() => has && setSelectedDate(dateStr)}
                style={{
                  position: 'relative',
                  minHeight: 84,
                  borderRadius: 10,
                  padding: 6,
                  background: isSelected ? 'var(--surface-hover)' : 'var(--surface-color)',
                  border: isToday
                    ? '2px solid var(--accent-color)'
                    : isSelected
                    ? '1px solid var(--accent-color)'
                    : '1px solid var(--glass-border)',
                  cursor: has ? 'pointer' : 'default',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  overflow: 'hidden',
                  opacity: has ? 1 : 0.55,
                }}
              >
                {dateStr <= todayStr && (
                  <button
                    type="button"
                    className="log-day-add"
                    title={t('profile.add.button')}
                    aria-label={t('profile.add.button')}
                    onClick={e => { e.stopPropagation(); setAddDate(dateStr); }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  </button>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: isToday ? 'var(--accent-color)' : 'var(--text-secondary)' }}>{dayNum}</span>
                  {has && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />}
                </div>
                {names.slice(0, 2).map((nm, i) => (
                  <div
                    key={i}
                    title={nm}
                    style={{ fontSize: '0.62rem', lineHeight: 1.2, background: 'rgba(16,185,129,0.15)', color: 'var(--text-primary)', borderRadius: 5, padding: '2px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {nm}
                  </div>
                ))}
                {names.length > 2 && <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>{t('profile.more_count', { count: names.length - 2 })}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDate && (
        <div className="glass-card" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', textTransform: 'capitalize' }}>
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString(i18n.language, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </h3>
          {selectedGroups.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('profile.no_workouts_day')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {selectedGroups.map(group => {
                const ids = group.entries.map(e => e.id);
                const isEditing = editingKey === group.key;
                const tset = new Set<string>();
                const bset = new Set<string>();
                let intensity: string | null = null;
                for (const e of group.entries) {
                  (e.trainingType || []).forEach(x => tset.add(x));
                  (e.bodyParts || []).forEach(x => bset.add(x));
                  if (e.intensity) intensity = e.intensity;
                }
                // When the group's entries are actual videos, the chips below already
                // name each completed video — repeating the plan day's full title
                // blob (every video of that day) as a header would be wrong.
                const hasVideoEntries = group.entries.some(e => e.videoFilename);
                return (
                  <div key={group.key} style={{ border: '1px solid var(--glass-border)', borderRadius: 12, padding: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        {!hasVideoEntries && (
                          <div style={{ fontWeight: 700, marginBottom: group.planName ? 6 : 0 }}>
                            {group.nameLines.length > 1
                              ? group.nameLines.map((line, i) => <div key={i}>{line}</div>)
                              : (group.name || t('profile.untitled_workout'))}
                          </div>
                        )}
                        {group.planName && (
                          <span className="log-plan-badge">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                            {t('profile.from_plan', { plan: group.planName })}
                          </span>
                        )}
                      </div>
                      {!isEditing ? (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                            onClick={() => {
                              setEditingKey(group.key);
                              setEditDateValue(selectedDate);
                            }}
                          >
                            {t('profile.edit_date')}
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                            onClick={() => {
                              setNotesKey(group.key);
                              setNotesValue(group.notes);
                            }}
                          >
                            {group.notes ? t('profile.notes_edit') : t('profile.notes_add')}
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.78rem', padding: '6px 12px', color: '#ef4444', borderColor: '#ef4444' }}
                            onClick={() => handleDeleteEntry(group.key, group.isManual)}
                          >
                            {t('profile.delete_entry')}
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            type="date"
                            value={editDateValue}
                            onChange={e => setEditDateValue(e.target.value)}
                            style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--glass-border)', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
                          />
                          <button className="btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }} disabled={savingDate} onClick={() => saveEditDate(ids)}>
                            {t('profile.save')}
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                            disabled={savingDate}
                            onClick={() => {
                              setEditingKey(null);
                              setEditDateValue('');
                            }}
                          >
                            {t('profile.cancel')}
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                      {group.entries.map(e => {
                        const editableVideo = e.videoId ? videosById.get(e.videoId) : undefined;
                        return (
                        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--surface-color)', borderRadius: 8, padding: '4px 10px 4px 4px' }}>
                          <div style={{ width: 52, height: 34, borderRadius: 5, overflow: 'hidden', background: 'var(--surface-hover)', flexShrink: 0 }}>
                            {e.thumbnail && <img src={`${API}/thumbnails/${e.thumbnail}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          </div>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.videoFilename ? stripExt(e.videoFilename) : t('profile.untitled_workout')}
                          </span>
                          {e.loopCount && e.loopCount > 1 && (
                            <span className="log-loop-badge" title={t('profile.loop_badge_aria', { count: e.loopCount })}>
                              {e.loopCount}×
                            </span>
                          )}
                          {editableVideo && (
                            <button
                              type="button"
                              title={t('profile.edit_video')}
                              aria-label={t('profile.edit_video')}
                              onClick={() => setEditingVideo(editableVideo)}
                              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, marginLeft: 2, borderRadius: 6, border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                            </button>
                          )}
                        </div>
                        );
                      })}
                    </div>

                    {notesKey === group.key ? (
                      <div style={{ marginTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <textarea
                          value={notesValue}
                          onChange={e => setNotesValue(e.target.value)}
                          placeholder={t('profile.notes_placeholder')}
                          maxLength={2000}
                          rows={3}
                          autoFocus
                          style={{
                            width: '100%', resize: 'vertical', padding: '10px 12px', borderRadius: 10,
                            border: '1px solid var(--glass-border)', background: 'var(--surface-color)',
                            color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5,
                          }}
                        />
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button className="btn" style={{ fontSize: '0.78rem', padding: '6px 12px' }} disabled={savingNotes} onClick={() => saveNotes(ids)}>
                            {t('profile.save')}
                          </button>
                          <button
                            className="btn btn-secondary"
                            style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                            disabled={savingNotes}
                            onClick={() => { setNotesKey(null); setNotesValue(''); }}
                          >
                            {t('profile.cancel')}
                          </button>
                        </div>
                      </div>
                    ) : group.notes ? (
                      <div className="log-note">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
                        <p>{group.notes}</p>
                      </div>
                    ) : null}

                    {(tset.size > 0 || bset.size > 0 || intensity) && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.75rem' }}>
                        {Array.from(tset).map(x => <Tag key={'t' + x} text={labels.trainingType(x)} />)}
                        {Array.from(bset).map(x => <Tag key={'b' + x} text={labels.bodyPart(x)} />)}
                        {intensity && <Tag text={labels.intensity(intensity)} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Activity summary, paired with plan progress: one says how you've been
          training, the other what you're working through. */}
      <div className="log-summary-row">
      <div className="glass-card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0 }}>{t('profile.summary_heading')}</h3>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(['week', 'month', 'year', 'all'] as const).map(r => (
              <button key={r} className={range === r ? 'btn' : 'btn btn-secondary'} style={{ fontSize: '0.78rem', padding: '6px 12px' }} onClick={() => setRange(r)}>
                {t(`profile.range_${r}`)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(['type', 'body', 'equipment', 'intensity'] as const).map(dim => (
              <button key={dim} className={dimension === dim ? 'btn' : 'btn btn-secondary'} style={{ fontSize: '0.75rem', padding: '5px 10px' }} onClick={() => setDimension(dim)}>
                {t(`profile.dimension_${dim}`)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {(['pie', 'bar'] as const).map(ct => (
              <button key={ct} className={chartType === ct ? 'btn' : 'btn btn-secondary'} style={{ fontSize: '0.75rem', padding: '5px 10px' }} onClick={() => setChartType(ct)}>
                {t(`profile.chart_${ct}`)}
              </button>
            ))}
          </div>
        </div>

        {totalTagged === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>{t('profile.no_tagged')}</p>
        ) : chartType === 'pie' ? (
          <div style={{ display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <Donut segments={segments} centerLabel={String(totalTagged)} centerSub={t('profile.total')} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1, minWidth: 220 }}>
              {segments.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                  <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{s.value}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', width: 42, textAlign: 'right' }}>{Math.round((s.value / totalTagged) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {segments.map((s, i) => {
              const pct = Math.round((s.value / totalTagged) * 100);
              const widthPct = maxSegmentValue > 0 ? (s.value / maxSegmentValue) * 100 : 0;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', fontSize: '0.85rem' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                    <span style={{ flexShrink: 0, color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)' }}>{s.value}</strong> · {pct}%
                    </span>
                  </div>
                  <div style={{ height: 12, background: 'var(--progress-bg)', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${widthPct}%`, height: '100%', background: s.color, borderRadius: 6, transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Plans you've made a start on, and how far through each one you are. */}
      {(planStats.started.length > 0 || finishedPlans.length > 0) && (
        <div className="glass-card" style={{ padding: '1.5rem' }}>
          <h3 style={{ margin: '0 0 0.35rem' }}>{t('profile.plans_heading')}</h3>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t('profile.plans_hint')}
          </p>

          {finishedPlans.length > 0 && (
            <div style={{ marginBottom: planStats.started.length > 0 ? '1.5rem' : 0 }}>
              <div className="log-plans-subheading">{t('profile.plans_finished_heading')}</div>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                {finishedPlans.map(plan => (
                  <div key={plan.id} className="log-finished-plan">
                    <span aria-hidden="true">🏆</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="log-finished-plan-name">{plan.planName}</div>
                      <div className="log-finished-plan-meta">
                        {t('profile.plans_finished_on', {
                          date: new Date(plan.finishedOn + 'T00:00:00').toLocaleDateString(i18n.language, {
                            year: 'numeric', month: 'short', day: 'numeric',
                          }),
                        })}
                        {plan.daysTaken ? ` · ${t('profile.plans_took_days', { count: plan.daysTaken })}` : ''}
                        {plan.workoutCount ? ` · ${t('plans.workout_count', { count: plan.workoutCount })}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="log-finished-plan-forget"
                      title={t('profile.plans_forget')}
                      aria-label={t('profile.plans_forget')}
                      onClick={() => handleDeleteFinished(plan.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {planStats.started.length > 0 && finishedPlans.length > 0 && (
            <div className="log-plans-subheading">{t('profile.plans_progress_heading')}</div>
          )}
          <div style={{ display: 'grid', gap: '1rem' }}>
            {planStats.started.map(plan => {
              const percent = plan.totalWorkouts
                ? Math.round((plan.completedWorkouts / plan.totalWorkouts) * 100)
                : 0;
              return (
                <div key={plan.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem', marginBottom: 6 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {plan.name}
                      </span>
                      {plan.slot && (
                        <span className="log-plan-slot">
                          {t(plan.slot === 'extra' ? 'plans.slot_extra' : 'plans.slot_main')}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {plan.completedWorkouts} / {plan.totalWorkouts}
                    </span>
                  </div>
                  <div style={{ width: '100%', height: 8, background: 'var(--progress-bg)', borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${percent}%`,
                        height: '100%',
                        background: plan.isFinished ? '#10b981' : 'var(--accent-color)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      </div>

      {addModal}
      {editingVideo && (
        <VideoMetadataEditor
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={(updated) => {
            // Keep the local lookup fresh and reload history so the live-joined
            // tags/thumbnail on the log update right away.
            setVideosById(prev => new Map(prev).set(updated.id, updated));
            loadHistory();
          }}
        />
      )}
    </div>
  );
}
