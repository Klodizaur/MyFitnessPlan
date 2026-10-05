import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { fetchProfiles, PROFILE_REQUIRED_EVENT, ProfileInfo, ProfilesState } from '../../lib/profiles';
import ProfilePicker from './ProfilePicker';
import WelcomeWizard from './WelcomeWizard';
import { isTv } from '../../lib/tv';
import '../../styles/profiles.css';

interface ProfileContextValue extends ProfilesState {
  current: ProfileInfo | null;
  /** Re-read the profile list (after a rename, a new PIN, a new profile…). */
  refresh: () => Promise<void>;
  /** Show the picker over the app, to switch to someone else. */
  openSwitcher: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

/** The profile context, or null when the app is running without one (server unreachable). */
export function useProfiles(): ProfileContextValue | null {
  return useContext(ProfileContext);
}

/**
 * Decides what this device sees:
 * - no profile chosen here yet (or signed out by a PIN change) → the picker;
 * - a profile that hasn't been named yet → the welcome wizard (on an upgrade,
 *   that's the profile holding all the existing data);
 * - otherwise the app, with the picker available as a switcher.
 */
export default function ProfileGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [failed, setFailed] = useState(false);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await fetchProfiles());
      setFailed(false);
    } catch {
      // A failed re-read keeps what we already knew; only a first read that
      // fails leaves the app without a profile (and retries, below).
      setFailed(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Never got the list (the server was restarting, or still starting up): the
  // app is shown without a profile, so keep asking until it answers instead of
  // leaving the header's avatar missing until a reload.
  useEffect(() => {
    if (!failed || state) return;
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [failed, state, refresh]);

  // Any API call can learn the device has been signed out (someone set a PIN on
  // this profile from another device): re-read, which lands on the picker.
  useEffect(() => {
    const onRequired = () => { refresh(); };
    window.addEventListener(PROFILE_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(PROFILE_REQUIRED_EVENT, onRequired);
  }, [refresh]);

  // A server that can't be reached shouldn't hide the app behind a blank
  // screen: render it, and let its own pages report the connection problem.
  if (!state) return failed ? <>{children}</> : null;

  const current = state.profiles.find(p => p.id === state.currentId) || null;

  if (!current) return <ProfilePicker state={state} onChanged={refresh} />;
  // The welcome is done on the computer; the TV just uses the profile as it is.
  if (!current.setupDone && !isTv) return <WelcomeWizard profile={current} onDone={refresh} />;

  return (
    <ProfileContext.Provider value={{ ...state, current, refresh, openSwitcher: () => setSwitching(true) }}>
      {children}
      {switching && <ProfilePicker state={state} onClose={() => setSwitching(false)} onChanged={refresh} />}
    </ProfileContext.Provider>
  );
}
