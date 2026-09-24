import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Profile from './pages/Profile';
import Player from './pages/Player';
import Plans from './pages/Plans';
import Library from './pages/Library';
import Album from './pages/Album';
import AiCleanupProgress from './components/ai/AiCleanupProgress';
import AppShell from './components/AppShell';
import './styles/tokens.css';
import './styles/shell.css';

function App() {

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
    <AppShell>
      <main className="animate-fade-in">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {/* Not yet redesigned: still wrapped in the old page container so
              their existing layout holds until each one is migrated. */}
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
    </AppShell>
  );
}

export default App;
