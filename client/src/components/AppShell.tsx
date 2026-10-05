import Toaster from './Toaster';
import ConfirmHost from './ConfirmHost';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  House,
  ListChecks,
  Calendar as CalendarIcon,
  Library as LibraryIcon,
  NotebookPen,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useIsMobile } from '../lib/useIsMobile';
import { SETTINGS_SAVED_EVENT } from '../lib/settingsEvents';
import Settings from '../pages/Settings';
import { useProfiles } from './profiles/ProfileGate';
import ProfileAvatar from './profiles/ProfileAvatar';

/**
 * The redesign's app shell.
 *
 * Desktop is a floating nav card at the top of the page. Mobile is a slim
 * header plus a fixed bottom tab bar — which is why Settings is a gear in the
 * header there rather than a sixth tab: five is as many as the bar can hold
 * without the labels colliding.
 *
 * On mobile the gear opens Settings as a layer over the current page instead of
 * navigating away, and tapping it again closes the layer: the page underneath
 * never unmounts, so you're back exactly where you were — same scroll, same
 * search, same open folder. The one exception is after Settings saved something
 * that page reads (the rhythm, the library folder): then it's reloaded on close
 * rather than left showing stale data.
 */

const NAV = [
  { to: '/', key: 'nav.dashboard', end: true },
  { to: '/plans', key: 'nav.plans' },
  { to: '/calendar', key: 'nav.calendar' },
  { to: '/library', key: 'nav.library' },
  { to: '/profile', key: 'nav.profile' },
  { to: '/settings', key: 'nav.settings' },
];

const TABS = [
  { to: '/', key: 'nav.home', Icon: House, end: true },
  { to: '/plans', key: 'nav.plans', Icon: ListChecks },
  { to: '/calendar', key: 'nav.calendar', Icon: CalendarIcon },
  { to: '/library', key: 'nav.library', Icon: LibraryIcon },
  { to: '/profile', key: 'nav.profile', Icon: NotebookPen },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const location = useLocation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped to remount the page under Settings when a save made its data stale.
  const [pageKey, setPageKey] = useState(0);
  const savedWhileOpen = useRef(false);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    if (savedWhileOpen.current) setPageKey(k => k + 1);
    savedWhileOpen.current = false;
  }, []);

  const toggleSettings = () => {
    // Landed on the Settings page itself (a link, or a window that was wide):
    // the gear still means "take me back".
    if (location.pathname === '/settings') {
      if (window.history.state?.idx > 0) navigate(-1);
      else navigate('/');
      return;
    }
    if (settingsOpen) closeSettings();
    else {
      savedWhileOpen.current = false;
      setSettingsOpen(true);
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const onSaved = () => { savedWhileOpen.current = true; };
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    // The page underneath isn't scroll-locked: an overflow lock moves the
    // sticky header (body hides sideways overflow, so locking <html> makes
    // <body> its scroll container) and hides the scrollbar, shifting the gear.
    // The layer contains its own scrolling instead, and the header and tab bar
    // ignore swipes while it's open (see .rx-settings-open in shell.css).
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
  }, [settingsOpen]);

  // Going somewhere else (a tab, a link inside Settings) closes the layer.
  useEffect(() => { closeSettings(); }, [location.pathname, closeSettings]);
  // Widening past phone size drops the layer; desktop has Settings in its nav.
  useEffect(() => { if (!isMobile) closeSettings(); }, [isMobile, closeSettings]);

  const profiles = useProfiles();
  // Who's using this device; tap to switch (or reach Settings › Profiles).
  const profileButton = profiles?.current ? (
    <button
      type="button"
      className="rx-profile"
      onClick={profiles.openSwitcher}
      aria-label={t('profiles.switch_from', { name: profiles.current.name })}
      title={profiles.current.name}
    >
      <ProfileAvatar avatar={profiles.current.avatar} ownerName={profiles.current.name} className="" />
    </button>
  ) : null;

  const isEnglish = i18n.language.startsWith('en');
  const toggleLanguage = () => i18n.changeLanguage(isEnglish ? 'pl' : 'en');

  const brand = (
    <NavLink to="/" className="rx-brand" onClick={closeSettings}>
      <img src="/logo.png" alt="" />
      <span className="rx-brand-text">MYFITNESSPLAN</span>
    </NavLink>
  );

  return (
    <div className={`rx${isMobile ? ' rx-has-tabs' : ''}${isMobile && settingsOpen ? ' rx-settings-open' : ''}`}>
      {isMobile ? (
        <div className="rx-mobile-head">
          {brand}
          {profileButton}
          <button
            type="button"
            className={`rx-head-icon${settingsOpen || location.pathname === '/settings' ? ' is-on' : ''}`}
            aria-label={t('nav.settings')}
            aria-pressed={settingsOpen}
            onClick={toggleSettings}
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      ) : (
        <div className="rx-wrap">
          <nav className="rx-nav">
            {brand}
            <div className="rx-nav-links">
              {NAV.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  {t(item.key)}
                </NavLink>
              ))}
            </div>
            {profileButton}
            <button
              type="button"
              className="rx-lang"
              onClick={toggleLanguage}
              title={isEnglish ? 'Zmień na polski' : 'Switch to English'}
            >
              {isEnglish ? 'EN' : 'PL'}
            </button>
          </nav>
        </div>
      )}

      <Fragment key={pageKey}>{children}</Fragment>
      {isMobile && settingsOpen && (
        <div className="rx-settings-layer" role="dialog" aria-label={t('nav.settings')}>
          <Settings />
        </div>
      )}
      <Toaster />
      <ConfirmHost />

      {isMobile && (
        <nav className="rx-tabs">
          {TABS.map(({ to, key, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              // The current page's own tab closes Settings too (no route change to do it).
              onClick={closeSettings}
              className={({ isActive }) => (isActive && !settingsOpen ? 'active' : '')}
            >
              <Icon size={21} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
