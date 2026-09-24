import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, ChevronDown, History, PieChart, Plus } from 'lucide-react';
import { useMetaLabels } from '../lib/labels';
import AddLogEntryModal from '../components/AddLogEntryModal';
import VideoMetadataEditor from '../components/VideoMetadataEditor';
import {
  ActivityCalendar, JournalGroup, MixChart, PlansPanel, RestGap, StatsBand,
} from '../components/log/LogParts';
import {
  FinishedPlan, LogEntry, LogGroup, PlanProgress, formatDuration, groupEntries, pad, toDateStr,
  videoLookup,
} from '../components/log/logModel';
import { Video } from '../types/video';
import { confirmDialog } from '../lib/confirm';
import '../styles/log.css';

const API = '';

type Range = 'week' | 'month' | 'year' | 'all';
type Dimension = 'type' | 'body' | 'equipment' | 'intensity';

export default function Profile() {
  const { t, i18n } = useTranslation();
  const labels = useMetaLabels();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  // Picking a day on the calendar narrows the history to it; null shows the month.
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [range, setRange] = useState<Range>('all');
  const [dimension, setDimension] = useState<Dimension>('type');
  const [chart, setChart] = useState<'bars' | 'pie'>('bars');
  // On a phone the page is two tabs rather than one long column.
  const [tab, setTab] = useState<'history' | 'breakdown'>('history');

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
        // Open on the month of the most recent activity (entries come newest-first).
        const [y, m] = list[0].completedDate.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Library videos, keyed by id, so a log entry's linked video can be opened in the
  // same metadata editor used on the Library page.
  useEffect(() => {
    fetch(`${API}/api/library/videos`)
      .then(r => r.json())
      .then((data: Video[]) => { if (Array.isArray(data)) setVideosById(videoLookup(data)); })
      .catch(() => {});
  }, []);

  const todayStr = toDateStr(new Date());

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
    // How many entries could contribute a runtime at all, so the label can say when
    // the total is partial (manual entries and un-probed videos have none).
    const timedEntries = entries.filter(e => e.durationSeconds).length;
    const activeDays = new Set(entries.map(e => e.completedDate));
    const workoutSet = new Set(entries.map(e => `${e.completedDate}|${e.workoutId || e.workoutName || e.id}`));
    return { workouts: workoutSet.size, activeDays: activeDays.size, totalSeconds, timedEntries, untimedEntries: entries.length - timedEntries };
  }, [entries]);

  const startedPlans = useMemo(() => {
    // Only plans you've actually touched are worth listing, and a finished one is
    // represented by its durable record instead, so it doesn't appear twice.
    const ratio = (p: PlanProgress) => (p.totalWorkouts ? p.completedWorkouts / p.totalWorkouts : 0);
    return planProgress.filter(p => p.completedWorkouts > 0 && !p.isFinished).sort((a, b) => ratio(b) - ratio(a));
  }, [planProgress]);

  const monthPrefix = `${viewYear}-${pad(viewMonth + 1)}`;
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(i18n.language, { month: 'long', year: 'numeric' }).toUpperCase();
  const monthActiveDays = useMemo(
    () => new Set(entries.filter(e => e.completedDate.startsWith(monthPrefix)).map(e => e.completedDate)).size,
    [entries, monthPrefix]
  );

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

  const gotoMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    // Never past the current month.
    if (delta > 0 && `${d.getFullYear()}-${pad(d.getMonth() + 1)}` > todayStr.slice(0, 7)) return;
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    setSelectedDate(null);
  };

  // The history under the calendar: the days of the month on screen, newest first —
  // or just the one day picked on the calendar.
  const journalDays = useMemo(() => {
    const days = selectedDate
      ? [selectedDate]
      : Array.from(entriesByDate.keys()).filter(d => d.startsWith(monthPrefix)).sort().reverse();
    return days.map(date => ({ date, groups: groupEntries(entriesByDate.get(date) || []) }));
  }, [selectedDate, entriesByDate, monthPrefix]);

  // --- "What you trained" ---------------------------------------------------------------------
  const rangeEntries = useMemo(() => {
    if (range === 'all') return entries;
    const days = range === 'week' ? 7 : range === 'month' ? 30 : 365;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return entries.filter(e => {
      const diff = Math.floor((today.getTime() - new Date(e.completedDate + 'T00:00:00').getTime()) / 86400000);
      return diff >= 0 && diff < days;
    });
  }, [entries, range]);

  const segments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of rangeEntries) {
      const values =
        dimension === 'type' ? e.trainingType || []
        : dimension === 'body' ? e.bodyParts || []
        : dimension === 'equipment' ? e.equipment || []
        : e.intensity ? [e.intensity] : [];
      for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    }
    const labelFor = (key: string) =>
      dimension === 'type' ? labels.trainingType(key)
        : dimension === 'body' ? labels.bodyPart(key)
        : dimension === 'equipment' ? labels.equipment(key)
        : labels.intensity(key);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ label: labelFor(key), value }));
  }, [rangeEntries, dimension, labels]);
  const totalTagged = segments.reduce((s, x) => s + x.value, 0);

  // --- Actions ----------------------------------------------------------------------------------
  const saveNotes = async (ids: string[], notes: string) => {
    try {
      const res = await fetch(`${API}/api/profile/history/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, notes }),
      });
      if (res.ok) await loadHistory();
    } catch (err) {
      console.error('Failed to save notes', err);
    }
  };

  const saveDate = async (ids: string[], completedDate: string) => {
    try {
      const res = await fetch(`${API}/api/profile/history/date`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, completedDate }),
      });
      if (res.ok) {
        await loadHistory();
        // Follow the moved workout to its new day.
        const [y, m] = completedDate.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
        setSelectedDate(null);
      }
    } catch (err) {
      console.error('Failed to update date', err);
    }
  };

  /**
   * Remove a logged workout, however it got here.
   *
   * A workout marked done inside a plan also clears the ✓ from that plan's
   * calendar, since the log and the plan are two records of the same event and
   * leaving one behind would have them disagree. The confirm says so.
   */
  const deleteGroup = async (group: LogGroup) => {
    const ok = await confirmDialog({
      title: t('profile.remove_workout_title'),
      message: t(group.isManual ? 'profile.delete_confirm' : 'profile.delete_planned_confirm'),
      confirmLabel: t('profile.delete_entry'),
      danger: true,
    });
    if (!ok) return;
    try {
      await fetch(`${API}/api/profile/history/${encodeURIComponent(group.key)}`, { method: 'DELETE' });
      await loadHistory();
    } catch (err) {
      console.error('Failed to delete log entry', err);
    }
  };

  const forgetFinished = async (id: string) => {
    const ok = await confirmDialog({
      title: t('profile.plans_forget'),
      message: t('profile.plans_forget_confirm'),
      confirmLabel: t('profile.delete_entry'),
      danger: true,
    });
    if (!ok) return;
    try {
      await fetch(`${API}/api/profile/plan-completions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadPlanProgress();
    } catch (err) {
      console.error('Failed to remove finished plan', err);
    }
  };

  // Portals into <body>, so where it sits doesn't matter. Reloads history and jumps
  // to the day that was just logged.
  const addModal = addDate ? (
    <AddLogEntryModal
      date={addDate}
      onClose={() => setAddDate(null)}
      onSaved={d => {
        setAddDate(null);
        loadHistory().then(() => {
          const [yy, mm] = d.split('-').map(Number);
          setViewYear(yy);
          setViewMonth(mm - 1);
          setSelectedDate(null);
        });
      }}
    />
  ) : null;

  if (loading) return null;

  if (entries.length === 0) {
    return (
      <div className="rx-wrap lg-page">
        <h1 className="rx-h1">{t('profile.title')}</h1>
        <p className="lg-lede">{t('profile.subtitle')}</p>
        <div className="lg-blank">
          <h2>{t('profile.empty_title')}</h2>
          <p>{t('profile.empty_msg')}</p>
          <div className="lg-blank-actions">
            <button type="button" className="rx-btn rx-btn--primary" onClick={() => navigate('/plans')}>{t('profile.empty_cta_plan')}</button>
            <button type="button" className="rx-btn" onClick={() => setAddDate(todayStr)}>{t('profile.empty_cta_manual')}</button>
            <button type="button" className="rx-btn" onClick={() => navigate('/')}>{t('profile.empty_cta_dashboard')}</button>
          </div>
        </div>
        {addModal}
      </div>
    );
  }

  const timeLabel = stats.timedEntries === 0
    ? t('profile.stats_total_time_none')
    : stats.untimedEntries > 0 ? t('profile.stats_total_time_partial') : t('profile.stats_total_time');
  const statTiles = [
    { value: String(stats.workouts), label: t('profile.stats_workouts') },
    { value: String(stats.activeDays), label: t('profile.stats_active_days') },
    { value: stats.timedEntries > 0 ? formatDuration(stats.totalSeconds) : '—', label: timeLabel },
    { value: String(finishedPlans.length), label: t('profile.stats_plans_finished') },
  ];

  const dimensions: { key: Dimension; label: string }[] = [
    { key: 'type', label: t('profile.dim_type') },
    { key: 'body', label: t('profile.dim_body') },
    { key: 'equipment', label: t('profile.dim_gear') },
    { key: 'intensity', label: t('profile.dim_intensity') },
  ];

  const history = (
    <>
      <ActivityCalendar
        cells={cells}
        monthLabel={monthLabel}
        activeDays={monthActiveDays}
        today={todayStr}
        selectedDate={selectedDate}
        countFor={d => (entriesByDate.get(d) || []).length}
        onPick={d => setSelectedDate(prev => (prev === d ? null : d))}
        onMonth={gotoMonth}
        canGoNext={`${viewYear}-${pad(viewMonth + 1)}` < todayStr.slice(0, 7)}
      />

      <section className="lg-journal">
        <div className="lg-journal-head">
          <h2>
            {selectedDate
              ? new Date(selectedDate + 'T12:00').toLocaleDateString(i18n.language, { day: 'numeric', month: 'long' })
              : t('profile.this_month')}
          </h2>
          {selectedDate && <button type="button" className="lg-link" onClick={() => setSelectedDate(null)}>{t('profile.show_month')}</button>}
          <button type="button" className="lg-add" onClick={() => setAddDate(selectedDate && selectedDate <= todayStr ? selectedDate : todayStr)}>
            <Plus size={14} />{t('profile.add.button')}
          </button>
        </div>

        {journalDays.length === 0 && <p className="lg-empty">{t('profile.no_workouts_month')}</p>}
        {journalDays.map(({ date, groups }, i) => {
          const prev = journalDays[i - 1];
          const gap = !selectedDate && prev
            ? Math.round((new Date(prev.date + 'T12:00').getTime() - new Date(date + 'T12:00').getTime()) / 864e5) - 1
            : 0;
          const d = new Date(date + 'T12:00');
          const isToday = date === todayStr;
          return (
            <div key={date}>
              {gap > 0 && <RestGap days={gap} />}
              <div className="lg-day-row">
                <div className="lg-day-date">
                  <div className={`lg-day-num${isToday ? ' is-today' : ''}`}>{d.getDate()}</div>
                  <div className="lg-day-dow">
                    {d.toLocaleDateString(i18n.language, { weekday: 'short' }).toUpperCase()}
                    {isToday && ` · ${t('calendar.today').toUpperCase()}`}
                  </div>
                </div>
                <div className={`lg-day-items${isToday ? ' is-today' : ''}`}>
                  {groups.length === 0 && <p className="lg-empty">{t('profile.no_workouts_day')}</p>}
                  {groups.map(group => (
                    <JournalGroup
                      key={group.key}
                      group={group}
                      date={date}
                      videosById={videosById}
                      onSaveNote={saveNotes}
                      onSaveDate={saveDate}
                      onDelete={deleteGroup}
                      onEditVideo={setEditingVideo}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </>
  );

  const breakdown = (
    <>
      <div className="lg-side-stats"><StatsBand stats={statTiles} /></div>

      <section className="lg-mix">
        <div className="lg-mix-head">
          <h2>{t('profile.what_you_trained')}</h2>
          <label className="lg-range">
            <span>{t(`profile.range_${range}`)}</span>
            <ChevronDown size={13} />
            <select value={range} onChange={e => setRange(e.target.value as Range)} aria-label={t('profile.summary_heading')}>
              {(['week', 'month', 'year', 'all'] as Range[]).map(r => <option key={r} value={r}>{t(`profile.range_${r}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="lg-mix-tools">
          <div className="lg-tabs">
            {dimensions.map(d => (
              <button key={d.key} type="button" className={dimension === d.key ? 'is-on' : ''} onClick={() => setDimension(d.key)}>{d.label}</button>
            ))}
          </div>
          <div className="rx-seg rx-seg--icons rx-seg--sm">
            <button type="button" className={chart === 'bars' ? 'is-on' : ''} aria-label={t('profile.chart_bar')} onClick={() => setChart('bars')}><BarChart3 size={14} /></button>
            <button type="button" className={chart === 'pie' ? 'is-on' : ''} aria-label={t('profile.chart_pie')} onClick={() => setChart('pie')}><PieChart size={14} /></button>
          </div>
        </div>
        <MixChart segments={segments} chart={chart} total={totalTagged} />
      </section>

      <PlansPanel started={startedPlans} finished={finishedPlans} onForget={forgetFinished} />
    </>
  );

  return (
    <div className="lg">
      <div className="rx-wrap lg-page">
        <header>
          <h1 className="rx-h1">{t('profile.title')}</h1>
          <p className="lg-lede">{t('profile.subtitle')}</p>
        </header>

        <div className="lg-mtabs rx-seg">
          <button type="button" className={tab === 'history' ? 'is-on' : ''} onClick={() => setTab('history')}><History size={15} />{t('profile.tab_history')}</button>
          <button type="button" className={tab === 'breakdown' ? 'is-on' : ''} onClick={() => setTab('breakdown')}><PieChart size={15} />{t('profile.tab_breakdown')}</button>
        </div>

        <div className={`lg-cols lg-show-${tab}`}>
          <div className="lg-left">{history}</div>
          <div className="lg-right">{breakdown}</div>
        </div>
      </div>

      {addModal}
      {editingVideo && (
        <VideoMetadataEditor
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={updated => {
            // Keep the local lookup fresh and reload history so the live-joined
            // tags/thumbnail on the log update right away.
            setVideosById(prev => videoLookup([...new Map([...prev.values()].map(v => [v.id, v.id === updated.id ? updated : v])).values()]));
            loadHistory();
          }}
        />
      )}
    </div>
  );
}
