import { Routes, Route, NavLink } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Player from './pages/Player';
import Plans from './pages/Plans';
import About from './pages/About';
import Library from './pages/Library';
import Album from './pages/Album';
import LanguageSwitcher from './components/LanguageSwitcher';

function App() {
  const { t } = useTranslation();

  useEffect(() => {
    // Fetch settings to get the current theme
    fetch('http://localhost:3000/api/settings')
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
        <div className="nav-links">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.dashboard')}</NavLink>
          <NavLink to="/plans" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.plans')}</NavLink>
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.calendar')}</NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.settings')}</NavLink>
          <NavLink to="/about" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.about')}</NavLink>
          <NavLink to="/library" className={({ isActive }) => (isActive ? 'active' : '')}>{t('nav.library') || 'Library'}</NavLink>
          <LanguageSwitcher />
        </div>
      </nav>

      <main className="animate-fade-in">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="/library" element={<Library />} />
          <Route path="/library/:albumId" element={<Album />} />
          <Route path="/library/:albumId/:subId" element={<Album />} />
          <Route path="/player/:videoId/:workoutId" element={<Player />} />
          <Route path="/player/:videoId" element={<Player />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
