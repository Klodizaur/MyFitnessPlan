import Toaster from './Toaster';
import ConfirmHost from './ConfirmHost';
import { NavLink, useNavigate } from 'react-router-dom';
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

/**
 * The redesign's app shell.
 *
 * Desktop is a floating nav card at the top of the page. Mobile is a slim
 * header plus a fixed bottom tab bar — which is why Settings is a gear in the
 * header there rather than a sixth tab: five is as many as the bar can hold
 * without the labels colliding.
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

  const isEnglish = i18n.language.startsWith('en');
  const toggleLanguage = () => i18n.changeLanguage(isEnglish ? 'pl' : 'en');

  const brand = (
    <NavLink to="/" className="rx-brand">
      <img src="/logo.png" alt="" />
      <span className="rx-brand-text">MYFITNESSPLAN</span>
    </NavLink>
  );

  return (
    <div className={`rx${isMobile ? ' rx-has-tabs' : ''}`}>
      {isMobile ? (
        <div className="rx-mobile-head">
          {brand}
          <button
            type="button"
            className="rx-head-icon"
            aria-label={t('nav.settings')}
            onClick={() => navigate('/settings')}
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

      {children}
      <Toaster />
      <ConfirmHost />

      {isMobile && (
        <nav className="rx-tabs">
          {TABS.map(({ to, key, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={21} />
              {t(key)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
