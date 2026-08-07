import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import AiSettingsSection from '../components/ai/AiSettingsSection';
import '../styles/About.css';

const THEMES = [
  { id: 'midnight', primary: '#3b82f6', bg: '#0f172a' },
  { id: 'sunset', primary: '#f97316', bg: '#2d1b36' },
  { id: 'forest', primary: '#10b981', bg: '#064e3b' },
  { id: 'pastel-orange', primary: '#fdba74', bg: '#fff7ed' },
  { id: 'pastel-pink', primary: '#f9a8d4', bg: '#fdf2f8' },
  { id: 'sky-blue', primary: '#7dd3fc', bg: '#f0f9ff' },
  { id: 'watermelon', primary: '#d81b45', bg: '#e8f8ea' },
];

type ScanProgress = {
  active: boolean;
  phase: 'idle' | 'discovering' | 'processing' | 'done';
  processed: number;
  total: number;
  currentFile: string;
};

export default function Settings() {
  const { t, i18n } = useTranslation();
  const [directory, setDirectory] = useState('');
  const [pattern, setPattern] = useState<number[]>([1, 1, 1, 1, 1, 0]);
  const [excludePaths, setExcludePaths] = useState<string[]>([]);
  const [newExclude, setNewExclude] = useState('');
  const [theme, setTheme] = useState('midnight');
  const [calendarView, setCalendarView] = useState('list');
  const [status, setStatus] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [appVersion, setAppVersion] = useState('');
  const canBrowseFolders = typeof window !== 'undefined' && !!window.myFitnessPlan?.pickDirectory;

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.video_directory) setDirectory(data.video_directory);
        if (data.workout_pattern) setPattern(data.workout_pattern);
        if (data.exclude_paths) setExcludePaths(data.exclude_paths);
        if (data.theme) setTheme(data.theme);
        if (data.calendar_view) setCalendarView(data.calendar_view);
      });
  }, []);

  useEffect(() => {
    fetch('/api/version')
      .then(res => res.json())
      .then(data => { if (data.version) setAppVersion(data.version); })
      .catch(() => {});
  }, []);

  const handleBrowseDirectory = async () => {
    const picked = await window.myFitnessPlan?.pickDirectory();
    if (picked) setDirectory(picked);
  };

  const handleBrowseExclude = async () => {
    const picked = await window.myFitnessPlan?.pickDirectory();
    if (!picked) return;
    setExcludePaths((prev) => (prev.includes(picked) ? prev : [...prev, picked]));
    setNewExclude('');
  };

  const handleSetDirectory = async () => {
    setStatus(t('settings.scanning_status'));
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
      if (data.error) setStatus(`Error: ${data.error}`);
      else setStatus(t('settings.found_videos', { count: data.count }));
    } catch (err) {
      setStatus(t('settings.failed_connect'));
    } finally {
      window.clearInterval(poll);
      setScanning(false);
      setScanProgress(null);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workout_pattern: pattern, 
          exclude_paths: excludePaths,
          theme: theme,
          calendar_view: calendarView
        })
      });
      setStatus(t('settings.settings_saved'));
      document.body.setAttribute('data-theme', theme);
    } catch (err) {
      setStatus(t('settings.failed_save'));
    }
  };

  const handleAddExclude = () => {
    if (newExclude.trim()) {
      const trimmed = newExclude.trim();
      if (!excludePaths.includes(trimmed)) {
        setExcludePaths([...excludePaths, trimmed]);
      }
      setNewExclude('');
    }
  };

  const handleRemoveExclude = (p: string) => {
    setExcludePaths(excludePaths.filter(path => path !== p));
  };

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const toggleDay = (index: number) => {
    const newPattern = [...pattern];
    newPattern[index] = newPattern[index] === 1 ? 0 : 1;
    setPattern(newPattern);
  };

  const addDay = () => {
    setPattern([...pattern, 1]);
  };

  const removeDay = () => {
    if (pattern.length > 1) {
      setPattern(pattern.slice(0, -1));
    }
  };

  return (
    <>
    <div className="glass-card" style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1>{t('nav.settings')}</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <h2>{t('settings.appearance')}</h2>
        <p style={{ marginBottom: '1rem' }}>{t('settings.appearance_msg')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
          {THEMES.map(theTheme => (
            <div 
              key={theTheme.id}
              onClick={() => setTheme(theTheme.id)}
              style={{ 
                cursor: 'pointer',
                padding: '12px',
                borderRadius: '12px',
                border: `2px solid ${theme === theTheme.id ? 'var(--accent-color)' : 'var(--glass-border)'}`,
                background: theTheme.bg,
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                transition: 'all 0.2s',
                boxShadow: theme === theTheme.id ? '0 4px 15px rgba(0,0,0,0.05)' : 'none'
              }}
            >
              <div style={{ display: 'flex', gap: '4px' }}>
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: theTheme.primary }} />
                <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: theTheme.bg, border: '1px solid rgba(0,0,0,0.1)' }} />
              </div>
              <span style={{ 
                fontSize: '0.85rem', 
                fontWeight: 600, 
                color: ['midnight', 'sunset', 'forest'].includes(theTheme.id) ? '#f8fafc' : '#1e293b' 
              }}>
                {t(`settings.themes.${theTheme.id}`)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2>{t('settings.language')}</h2>
        <p style={{ marginBottom: '1rem' }}>{t('settings.select_language')}</p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            className={`btn ${i18n.language.startsWith('en') ? '' : 'btn-secondary'}`}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={() => changeLanguage('en')}
          >
            <span>🇬🇧</span> English
          </button>
          <button 
            className={`btn ${i18n.language.startsWith('pl') ? '' : 'btn-secondary'}`}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
            onClick={() => changeLanguage('pl')}
          >
            <span>🇵🇱</span> Polski
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2>{t('settings.calendar_layout')}</h2>
        <p style={{ marginBottom: '1rem' }}>{t('settings.calendar_layout_msg')}</p>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            className={`btn ${calendarView === 'list' ? '' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setCalendarView('list')}
          >
            {t('settings.classic_list')}
          </button>
          <button 
            className={`btn ${calendarView === 'slider' ? '' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setCalendarView('slider')}
          >
            {t('settings.modern_slider')}
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2>{t('settings.video_library_path')}</h2>
        <p style={{ marginBottom: '1rem' }}>{t('settings.video_library_path_msg')}</p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input 
            type="text" 
            value={directory} 
            onChange={e => setDirectory(e.target.value)}
            style={{ flex: 1, minWidth: '200px', padding: '10px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
          />
          {canBrowseFolders && (
            <button className="btn btn-secondary" type="button" onClick={handleBrowseDirectory}>
              {t('settings.browse')}
            </button>
          )}
          <button className="btn" onClick={handleSetDirectory} disabled={scanning}>
            {scanning ? t('settings.scanning') : t('settings.scan')}
          </button>
        </div>

        {scanning && (
          <div className="scan-progress">
            <div className="scan-progress-head">
              <span>
                {scanProgress && scanProgress.phase === 'processing' && scanProgress.total > 0
                  ? t('settings.scan_progress', { processed: scanProgress.processed, total: scanProgress.total })
                  : t('settings.scan_discovering')}
              </span>
              {scanProgress && scanProgress.total > 0 && (
                <strong>{Math.round((scanProgress.processed / scanProgress.total) * 100)}%</strong>
              )}
            </div>
            <div className="scan-progress-track">
              {/* Before the file list is known there is no percentage to show, so
                  the bar runs as an indeterminate sweep instead. */}
              <div
                className={`scan-progress-fill${scanProgress && scanProgress.total > 0 ? '' : ' indeterminate'}`}
                style={scanProgress && scanProgress.total > 0
                  ? { width: `${(scanProgress.processed / scanProgress.total) * 100}%` }
                  : undefined}
              />
            </div>
            {scanProgress?.currentFile && (
              <div className="scan-progress-file" title={scanProgress.currentFile}>{scanProgress.currentFile}</div>
            )}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2>{t('settings.exclude_folders')}</h2>
        <p style={{ marginBottom: '1rem' }}>{t('settings.exclude_folders_msg')}</p>
        
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input 
            type="text" 
            placeholder={t('settings.path_placeholder')}
            value={newExclude} 
            onChange={e => setNewExclude(e.target.value)}
            style={{ flex: 1, minWidth: '200px', padding: '10px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--bg-color)', color: 'var(--text-primary)' }}
          />
          {canBrowseFolders && (
            <button className="btn btn-secondary" type="button" onClick={handleBrowseExclude}>
              {t('settings.browse')}
            </button>
          )}
          <button className="btn btn-secondary" onClick={handleAddExclude}>{t('settings.add')}</button>
        </div>

        {excludePaths.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(0,0,0,0.05)', padding: '1rem', borderRadius: '8px' }}>
            {excludePaths.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem' }}>
                <span style={{ wordBreak: 'break-all' }}>{p}</span>
                <button 
                  onClick={() => handleRemoveExclude(p)}
                  style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px 8px' }}
                >
                  {t('settings.remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2>{t('settings.schedule_pattern')}</h2>
        <p style={{ marginBottom: '1rem' }}>{t('settings.schedule_pattern_msg')}</p>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', 
          gap: '0.75rem',
          marginBottom: '1.5rem' 
        }}>
          {pattern.map((isWorkout, idx) => (
            <div 
              key={idx}
              onClick={() => toggleDay(idx)}
              style={{
                cursor: 'pointer',
                padding: '1rem',
                borderRadius: '12px',
                textAlign: 'center',
                background: isWorkout ? 'var(--accent-color)' : 'var(--surface-color)',
                border: `2px solid ${isWorkout ? 'var(--accent-hover)' : 'var(--glass-border)'}`,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                boxShadow: isWorkout ? '0 4px 12px rgba(59, 130, 246, 0.3)' : 'none',
                transform: 'translateY(0)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
            >
              <span style={{ fontSize: '0.7rem', fontWeight: 700, opacity: 0.8, color: isWorkout ? 'white' : 'var(--text-secondary)' }}>
                {t('settings.day_n', { n: idx + 1 })}
              </span>
              <span style={{ fontSize: '1.5rem' }}>
                {isWorkout ? '💪' : '🧘'}
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isWorkout ? 'white' : 'var(--text-primary)' }}>
                {isWorkout ? t('settings.workout') : t('settings.rest')}
              </span>
            </div>
          ))}
          
          <button 
            onClick={addDay}
            className="btn btn-secondary"
            style={{ 
              height: '100%', 
              minHeight: '85px',
              borderStyle: 'dashed',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              fontSize: '0.85rem'
            }}
          >
            <span style={{ fontSize: '1.5rem', marginBottom: '4px' }}>+</span>
            {t('settings.add_day')}
          </button>
        </div>

        {pattern.length > 1 && (
          <button 
            onClick={removeDay}
            className="btn btn-secondary"
            style={{ 
              width: '100%', 
              color: '#ef4444', 
              borderColor: '#ef4444',
              background: 'transparent',
              fontSize: '0.9rem'
            }}
          >
            {t('settings.remove_day')}
          </button>
        )}
      </div>

      {/* Optional AI integration. Saves through its own endpoint, so it is
          unaffected by (and does not affect) the Save button below. */}
      <AiSettingsSection />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
        <button className="btn" onClick={handleSaveSettings} style={{ width: '100%' }}>{t('settings.save_settings')}</button>
      </div>

      {status && (
        <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--surface-hover)', borderRadius: '8px', color: 'var(--accent-color)', textAlign: 'center' }}>
          {status}
        </div>
      )}
    </div>

    <div className="about-card" style={{ maxWidth: '800px', margin: '2rem auto' }}>
      <h1>MyFitnessPlan</h1>

      <div className="about-section">
        <h2>{t('about.version')}</h2>
        <p>{appVersion || '\u2014'}</p>
      </div>

      <div className="about-section">
        <h2>{t('about.website')}</h2>
        <p>
          <a
            href="https://myfitnessplan.bigdeckit.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
            myfitnessplan.bigdeckit.com
          </a>
        </p>
      </div>

      <div className="about-section">
        <h2>{t('about.created_by')}</h2>
        <p>
          <strong>Klaudia Krzos</strong>
          <br />
          <a
            href="https://www.linkedin.com/in/klaudiacreativestuff/"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
            {t('about.linkedin')}
          </a>
          <br />
          <a
            href="https://github.com/Klodizaur"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
            {t('about.github')}
          </a>
          <br />
          <em>{t('about.role')}</em>
        </p>
      </div>

      <div className="about-section">
        <h2>{t('about.description')}</h2>
        <p>
          {t('about.description_text')}
        </p>
      </div>

      <div className="about-section">
        <h2>{t('about.license')}</h2>
        <p>{t('about.license_text')}</p>
        <p className="about-highlight">
          {t('about.non_commercial')}
          <a
            href="https://github.com/Klodizaur/MyFitnessPlan"
            target="_blank"
            rel="noopener noreferrer"
            className="about-link"
          >
          {t('about.contribute')}
          </a>
        </p>
      </div>
    </div>
    </>
  );
}
