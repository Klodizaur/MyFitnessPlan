import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  Check, CircleCheck, Dumbbell, Folder, FolderX, Info, Loader, Minus, Moon, Palette, Plus, RefreshCw, Sparkles, X,
} from 'lucide-react';
import AiSettingsSection from '../components/ai/AiSettingsSection';
import '../styles/settings.css';

/**
 * Themes as the settings card draws them: the page colour behind the tile, its
 * accent, the text colour that reads on it and a surface swatch.
 */
const THEMES = [
  { id: 'midnight', bg: '#111A2E', accent: '#3B82F6', fg: '#FFFFFF', surface: '#111A2E' },
  { id: 'sunset', bg: '#2E1A33', accent: '#F97316', fg: '#FFFFFF', surface: '#2E1A33' },
  { id: 'forest', bg: '#08503E', accent: '#10B981', fg: '#FFFFFF', surface: '#08503E' },
  { id: 'pastel-orange', bg: '#FFF5EC', accent: '#F9B27A', fg: '#6B2410', surface: '#FFFFFF' },
  { id: 'pastel-pink', bg: '#FDF0F6', accent: '#F59AC6', fg: '#5A1E3A', surface: '#FFFFFF' },
  { id: 'sky-blue', bg: '#EEF6FD', accent: '#7CCBF2', fg: '#153A5A', surface: '#FFFFFF' },
  { id: 'watermelon', bg: '#EAF6EC', accent: '#DC2F4B', fg: '#4A1520', surface: '#FFFFFF' },
];

/**
 * Settings tabs, in the order they're shown.
 *
 * Workouts leads because it holds the things a new install has to set before
 * anything works — where the videos are, and the training pattern.
 */
const SETTINGS_TABS = [
  { id: 'workouts', Icon: Dumbbell },
  { id: 'appearance', Icon: Palette },
  { id: 'ai', Icon: Sparkles },
  { id: 'about', Icon: Info },
] as const;
type SettingsTab = typeof SETTINGS_TABS[number]['id'];

/** The calendar views a person can open by default. Older installs stored 'list' or 'slider'; both read as Grid. */
const LAYOUTS = ['tape', 'week', 'grid'] as const;
type Layout = typeof LAYOUTS[number];
const asLayout = (value: string): Layout => (value === 'tape' || value === 'week' ? value : 'grid');

const MAX_CYCLE = 14;

type ScanProgress = {
  active: boolean;
  phase: 'idle' | 'discovering' | 'processing' | 'done';
  processed: number;
  total: number;
  currentFile: string;
};

/** What the shared Save button writes. */
interface Saved {
  pattern: number[];
  excludePaths: string[];
  theme: string;
  calendarView: Layout;
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const [directory, setDirectory] = useState('');
  const [pattern, setPattern] = useState<number[]>([1, 1, 1, 1, 1, 0]);
  const [excludePaths, setExcludePaths] = useState<string[]>([]);
  const [newExclude, setNewExclude] = useState('');
  const [theme, setTheme] = useState('midnight');
  const [calendarView, setCalendarView] = useState<Layout>('grid');
  const [saved, setSaved] = useState<Saved | null>(null);
  const [tab, setTab] = useState<SettingsTab>('workouts');
  const [scanNote, setScanNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | undefined>(undefined);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const canBrowseFolders = typeof window !== 'undefined' && !!window.myFitnessPlan?.pickDirectory;

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        const next: Saved = {
          pattern: Array.isArray(data.workout_pattern) && data.workout_pattern.length ? data.workout_pattern : [1, 1, 1, 1, 1, 0],
          excludePaths: Array.isArray(data.exclude_paths) ? data.exclude_paths : [],
          theme: data.theme || 'midnight',
          calendarView: asLayout(data.calendar_view || ''),
        };
        if (data.video_directory) setDirectory(data.video_directory);
        setPattern(next.pattern);
        setExcludePaths(next.excludePaths);
        setTheme(next.theme);
        setCalendarView(next.calendarView);
        setSaved(next);
      });
  }, []);

  useEffect(() => {
    fetch('/api/version')
      .then(res => res.json())
      .then(data => { if (data.version) setAppVersion(data.version); })
      .catch(() => {});
    return () => window.clearTimeout(toastTimer.current);
  }, []);

  const flash = (text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(''), 1800);
  };

  // Picking a theme previews it across the whole app straight away; Save keeps
  // it, and Discard — or leaving without saving — puts the saved one back.
  const pickTheme = (id: string) => {
    setTheme(id);
    document.body.setAttribute('data-theme', id);
  };
  const savedThemeRef = useRef<string | null>(null);
  savedThemeRef.current = saved?.theme ?? null;
  useEffect(() => () => {
    if (savedThemeRef.current) document.body.setAttribute('data-theme', savedThemeRef.current);
  }, []);

  const dirty = useMemo(
    () => saved !== null && JSON.stringify({ pattern, excludePaths, theme, calendarView }) !== JSON.stringify(saved),
    [saved, pattern, excludePaths, theme, calendarView]
  );

  const handleBrowseDirectory = async () => {
    const picked = await window.myFitnessPlan?.pickDirectory();
    if (picked) setDirectory(picked);
  };

  const handleBrowseExclude = async () => {
    const picked = await window.myFitnessPlan?.pickDirectory();
    if (!picked) return;
    setExcludePaths(prev => (prev.includes(picked) ? prev : [...prev, picked]));
    setNewExclude('');
  };

  const handleSetDirectory = async () => {
    setScanNote(null);
    setScanning(true);
    setScanProgress(null);

    // The scan request stays open for the whole run (one ffmpeg pass per video),
    // so progress is polled from a separate endpoint while it is in flight.
    const poll = window.setInterval(() => {
      fetch('/api/library/scan-progress')
        .then(res => res.json())
        .then((data: ScanProgress) => { if (data.active) setScanProgress(data); })
        .catch(() => {});
    }, 400);

    try {
      const res = await fetch('/api/library/set-directory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory })
      });
      const data = await res.json();
      if (data.error) setScanNote({ text: `Error: ${data.error}`, ok: false });
      else if (data.skippedCleanup) {
        // The scan couldn't see the whole folder, so nothing was removed from
        // the library. Say so — a silent "found 0 videos" looks like success.
        setScanNote({ text: `${t('settings.found_videos', { count: data.count })} ${t('settings.scan_incomplete')}`, ok: false });
      } else setScanNote({ text: t('settings.found_videos', { count: data.count }), ok: true });
    } catch {
      setScanNote({ text: t('settings.failed_connect'), ok: false });
    } finally {
      window.clearInterval(poll);
      setScanning(false);
      setScanProgress(null);
    }
  };

  const handleSaveSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workout_pattern: pattern,
          exclude_paths: excludePaths,
          theme: theme,
          calendar_view: calendarView
        })
      });
      if (!res.ok) throw new Error('failed');
      setSaved({ pattern, excludePaths, theme, calendarView });
      document.body.setAttribute('data-theme', theme);
      flash(t('settings.settings_saved'));
    } catch {
      flash(t('settings.failed_save'));
    }
  };

  const handleDiscard = () => {
    if (!saved) return;
    setPattern(saved.pattern);
    setExcludePaths(saved.excludePaths);
    setTheme(saved.theme);
    document.body.setAttribute('data-theme', saved.theme);
    setCalendarView(saved.calendarView);
  };

  const handleAddExclude = () => {
    const trimmed = newExclude.trim();
    if (!trimmed) return;
    if (!excludePaths.includes(trimmed)) setExcludePaths([...excludePaths, trimmed]);
    setNewExclude('');
  };

  const toggleDay = (index: number) => setPattern(pattern.map((v, i) => (i === index ? (v === 1 ? 0 : 1) : v)));
  const addDay = () => { if (pattern.length < MAX_CYCLE) setPattern([...pattern, 1]); };
  const removeDay = () => { if (pattern.length > 1) setPattern(pattern.slice(0, -1)); };

  const workoutDays = pattern.filter(v => v === 1).length;
  const scanPct = scanProgress && scanProgress.total > 0 ? (scanProgress.processed / scanProgress.total) * 100 : null;

  return (
    <div className="st">
      <div className="rx-wrap st-wrap">
        <h1 className="rx-h1 st-title">{t('nav.settings')}</h1>

        {/* Grouping only — every field keeps the behaviour it had, including the
            shared Save, which writes the pattern, exclusions, theme and calendar
            layout together whichever tab is open. */}
        <div className="st-tabs-wrap">
          <div className="st-tabs" role="tablist">
            {SETTINGS_TABS.map(({ id, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'is-on' : ''}
                onClick={() => setTab(id)}
              >
                <Icon size={15} />
                {t(`settings.tab_${id}`)}
              </button>
            ))}
          </div>
        </div>

        {tab === 'workouts' && (
          <div className="st-stack">
            <section className="st-card">
              <header>
                <h2>{t('settings.video_library_path')}</h2>
                <p>{t('settings.video_library_path_msg')}</p>
              </header>
              <div className="st-row">
                <label className="st-field st-field--mono">
                  <Folder size={17} />
                  <input type="text" value={directory} onChange={e => setDirectory(e.target.value)} spellCheck={false} />
                </label>
                <div className="st-btns">
                  {canBrowseFolders && (
                    <button type="button" className="st-btn" onClick={handleBrowseDirectory}>{t('settings.browse')}</button>
                  )}
                  <button type="button" className="st-btn st-btn--primary" onClick={handleSetDirectory} disabled={scanning}>
                    {scanning ? <Loader size={15} className="st-spin" /> : <RefreshCw size={15} />}
                    {scanning ? t('settings.scanning') : t('settings.scan')}
                  </button>
                </div>
              </div>

              {scanning && (
                <div className="st-scan">
                  <div className="st-scan-head">
                    <span>
                      {scanProgress && scanProgress.phase === 'processing' && scanProgress.total > 0
                        ? t('settings.scan_progress', { processed: scanProgress.processed, total: scanProgress.total })
                        : t('settings.scan_discovering')}
                    </span>
                    {scanPct !== null && <strong>{Math.round(scanPct)}%</strong>}
                  </div>
                  {/* Before the file list is known there is no percentage to show,
                      so the bar runs as an indeterminate sweep instead. */}
                  <div className={`rx-progress st-scan-bar${scanPct === null ? ' is-indeterminate' : ''}`}>
                    <span style={scanPct !== null ? { width: `${scanPct}%` } : undefined} />
                  </div>
                  {scanProgress?.currentFile && <div className="st-scan-file" title={scanProgress.currentFile}>{scanProgress.currentFile}</div>}
                </div>
              )}

              {scanNote && !scanning && (
                <div className={`st-note ${scanNote.ok ? 'is-ok' : 'is-bad'}`}>
                  <CircleCheck size={15} />
                  {scanNote.text}
                </div>
              )}
            </section>

            <section className="st-card">
              <header>
                <h2>{t('settings.exclude_folders')}</h2>
                <p>{t('settings.exclude_folders_msg')}</p>
              </header>
              <div className="st-row">
                <input
                  className="st-input st-input--mono"
                  type="text"
                  placeholder={t('settings.path_placeholder')}
                  value={newExclude}
                  onChange={e => setNewExclude(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddExclude(); }}
                  spellCheck={false}
                />
                <div className="st-btns">
                  {canBrowseFolders && (
                    <button type="button" className="st-btn" onClick={handleBrowseExclude}>{t('settings.browse')}</button>
                  )}
                  <button type="button" className="st-btn st-btn--soft" onClick={handleAddExclude}>{t('settings.add')}</button>
                </div>
              </div>
              {excludePaths.length > 0 && (
                <ul className="st-list">
                  {excludePaths.map(p => (
                    <li key={p}>
                      <FolderX size={16} />
                      <span title={p}>{p}</span>
                      <button type="button" aria-label={t('settings.remove')} title={t('settings.remove')} onClick={() => setExcludePaths(excludePaths.filter(x => x !== p))}>
                        <X size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="st-card">
              <header>
                <h2>{t('settings.schedule_pattern')}</h2>
                <p>{t('settings.schedule_pattern_msg')}</p>
              </header>
              <div className="st-days" style={{ ['--cols' as string]: Math.max(7, pattern.length) }}>
                {pattern.map((isWorkout, idx) => (
                  <button key={idx} type="button" className={`st-day${isWorkout ? ' is-work' : ''}`} onClick={() => toggleDay(idx)} aria-pressed={isWorkout === 1}>
                    <span>{t('settings.day_n', { n: idx + 1 })}</span>
                    {isWorkout ? <Dumbbell size={19} /> : <Moon size={19} />}
                    <span>{isWorkout ? t('settings.workout') : t('settings.rest')}</span>
                  </button>
                ))}
              </div>
              <div className="st-cycle">
                <span>{t('settings.workout_days_in_every', { count: workoutDays })}</span>
                <div className="st-stepper">
                  <button type="button" onClick={removeDay} disabled={pattern.length <= 1} aria-label={t('settings.remove_day')}><Minus size={15} /></button>
                  <span>{pattern.length}</span>
                  <button type="button" onClick={addDay} disabled={pattern.length >= MAX_CYCLE} aria-label={t('settings.add_day')}><Plus size={15} /></button>
                </div>
                <span>{t('settings.days_unit')}</span>
              </div>
            </section>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="st-stack">
            <section className="st-card">
              <header>
                <h2>{t('settings.appearance')}</h2>
                <p>{t('settings.appearance_msg')}</p>
              </header>
              <div className="st-themes">
                {THEMES.map(th => (
                  <button
                    key={th.id}
                    type="button"
                    className={`st-theme${theme === th.id ? ' is-on' : ''}`}
                    style={{ background: th.bg, color: th.fg }}
                    onClick={() => pickTheme(th.id)}
                    aria-pressed={theme === th.id}
                  >
                    <span className="st-theme-dots">
                      <i style={{ background: th.accent }} />
                      <i style={{ background: th.surface, border: '1px solid rgba(0,0,0,0.08)' }} />
                    </span>
                    <span className="st-theme-name">{t(`settings.themes.${th.id}`)}</span>
                    {theme === th.id && <span className="st-theme-check"><Check size={13} /></span>}
                  </button>
                ))}
              </div>
            </section>

            <section className="st-card st-card--inline">
              <header>
                <h2>{t('settings.language')}</h2>
                <p>{t('settings.select_language')}</p>
              </header>
              <div className="rx-seg">
                <button type="button" className={i18n.language.startsWith('en') ? 'is-on' : ''} onClick={() => i18n.changeLanguage('en')}>English</button>
                <button type="button" className={i18n.language.startsWith('pl') ? 'is-on' : ''} onClick={() => i18n.changeLanguage('pl')}>Polski</button>
              </div>
            </section>

            <section className="st-card">
              <header>
                <h2>{t('settings.calendar_layout')}</h2>
                <p>{t('settings.calendar_layout_msg')}</p>
              </header>
              <div className="st-layouts">
                {LAYOUTS.map(key => (
                  <button key={key} type="button" className={`st-layout${calendarView === key ? ' is-on' : ''}`} onClick={() => setCalendarView(key)} aria-pressed={calendarView === key}>
                    <span className={`st-layout-art st-layout-art--${key}`}>
                      {Array.from({ length: key === 'grid' ? 3 : 7 }).map((_, i) => <i key={i} className={key === 'tape' && i === 2 ? 'is-sel' : ''} />)}
                    </span>
                    <span className="st-layout-label">{t(`settings.layout_${key}`)}</span>
                    <span className="st-layout-note">{t(`settings.layout_${key}_note`)}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        {/* Optional AI integration. Saves through its own endpoint, so it is
            unaffected by (and does not affect) the shared Save. */}
        {tab === 'ai' && <AiSettingsSection />}

        {tab === 'about' && (
          <div className="st-stack">
            <section className="st-card st-about-logo">
              <img src="/logo.png" alt="" />
              <div className="st-about-name">MYFITNESSPLAN</div>
              <div className="st-about-version">{t('about.version')} {appVersion || '—'}</div>
            </section>

            <section className="st-card">
              <div className="st-about-item">
                <h3>{t('about.description')}</h3>
                <p>{t('about.description_text')}</p>
              </div>
              <div className="st-about-item">
                <h3>{t('about.website')}</h3>
                <p><a href="https://myfitnessplan.bigdeckit.com/" target="_blank" rel="noopener noreferrer">myfitnessplan.bigdeckit.com</a></p>
              </div>
              <div className="st-about-item">
                <h3>{t('about.created_by')}</h3>
                <p>
                  <strong>Klaudia Krzos</strong>
                  <br />
                  <a href="https://www.linkedin.com/in/klaudiacreativestuff/" target="_blank" rel="noopener noreferrer">{t('about.linkedin')}</a>
                  {' · '}
                  <a href="https://github.com/Klodizaur" target="_blank" rel="noopener noreferrer">{t('about.github')}</a>
                </p>
              </div>
              <div className="st-about-item">
                <h3>{t('about.license')}</h3>
                <p>{t('about.license_text')}</p>
                <p>
                  {t('about.non_commercial')}
                  <a href="https://github.com/Klodizaur/MyFitnessPlan" target="_blank" rel="noopener noreferrer">{t('about.contribute')}</a>
                </p>
              </div>
            </section>
          </div>
        )}
      </div>

      {createPortal(
        <>
      {dirty && !toast && (
        <div className="st-bar" role="region" aria-label={t('settings.unsaved_changes')}>
          <span>{t('settings.unsaved_changes')}</span>
          <button type="button" className="st-bar-discard" onClick={handleDiscard}>{t('settings.discard')}</button>
          <button type="button" className="st-bar-save" onClick={handleSaveSettings}>{t('settings.save')}</button>
        </div>
      )}
      {toast && (
        <div className="st-toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
        </>,
        document.body
      )}
    </div>
  );
}
