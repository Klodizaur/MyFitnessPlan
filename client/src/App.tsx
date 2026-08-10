import { Routes, Route, NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Profile from './pages/Profile';
import Player from './pages/Player';
import Plans from './pages/Plans';
import Library from './pages/Library';
import Album from './pages/Album';
import LanguageSwitcher from './components/LanguageSwitcher';
import AiCleanupProgress from './components/ai/AiCleanupProgress';

function App() {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // Fetch settings to get the current theme
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.theme) {
          document.body.setAttribute('data-theme', data.theme);
        }
      })
      .catch(err => console.error('Failed to fetch theme:', err));
  }, []);

  return (
    <div className="app-container">
      <nav>
        <div className="logo">
          <NavLink to="/" className="logo-link">
            <img src="/logo.png" alt="Workout Planner" className="logo-img" />
            <span className="logo-text">MyFitnessPlan</span>
          </NavLink>
        </div>
        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(open => !open)}
        >
          {menuOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          )}
        </button>
        <div className={`nav-links${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)}>
          <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.dashboard')}</NavLink>
          <NavLink to="/plans" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.plans')}</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.calendar')}</NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.library') || 'Library'}</NavLink>
          <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.profile')}</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.settings')}</NavLink>
          <LanguageSwitcher />
        </div>
      </nav>

      <main className="animate-fade-in">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/:albumId" element={<Album />} />
          <Route path="/library/:albumId/:subId" element={<Album />} />
          <Route path="/player/:videoId/:workoutId" element={<Player />} />
          <Route path="/player/:videoId" element={<Player />} />
        </Routes>
      </main>

      {/* Renders nothing unless a bulk description clean-up is running, so a
          run started on an album keeps reporting across navigation. */}
      <AiCleanupProgress />
    </div>
  );
}

export default App;
