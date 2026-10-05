import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Lock, Plus, Settings as SettingsIcon, X } from 'lucide-react';
import {
  ProfileInfo, ProfilesState, reloadAsProfile, resetPin, selectProfile,
} from '../../lib/profiles';
import { confirmDialog } from '../../lib/confirm';
import PinPad from './PinPad';
import ConfirmHost from '../ConfirmHost';
import LanguageToggle from './LanguageToggle';
import AddProfileWizard from './AddProfileWizard';
import ProfileAvatar from './ProfileAvatar';
import { isTv } from '../../lib/tv';

/**
 * "Who's training?" — full screen when this device hasn't picked anyone yet,
 * or over the app as a switcher (`onClose` given).
 *
 * A forgotten PIN never locks anyone out: on the computer running the app,
 * "Forgot PIN?" removes it. Anywhere else it says where to go to do that.
 *
 * New people are added here too ("Add profile"), not in anyone's settings —
 * but not on the TV: there you only pick someone who already exists.
 */
export default function ProfilePicker({ state, onClose, onChanged }: {
  state: ProfilesState;
  onClose?: () => void;
  /** Re-read the profile list (after someone was added). */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const grid = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<ProfileInfo | null>(null);
  // Which message, not its text: shown in whatever language is current.
  const [error, setError] = useState<{ key: string; params?: Record<string, unknown> } | null>(null);
  const errorText = error ? String(t(error.key, error.params)) : null;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const current = state.profiles.find(p => p.id === state.currentId) || null;

  const choose = async (profile: ProfileInfo, pin?: string) => {
    if (profile.id === state.currentId && onClose) { onClose(); return; }
    if (profile.hasPin && pin === undefined) { setError(null); setAsking(profile); return; }
    // Cleared first so a second wrong PIN registers as new and clears the dots again.
    setError(null);
    setBusy(true);
    try {
      await selectProfile(profile.id, pin);
      reloadAsProfile();
    } catch (err: any) {
      setBusy(false);
      if (err?.status === 404) {
        // Removed since this list was shown (on another device, say): say so
        // and show the list as it is now.
        setAsking(null);
        setError({ key: 'profiles.gone', params: { name: profile.name } });
        onChanged();
        return;
      }
      setError({ key: err?.code === 'wrong_pin' ? 'profiles.pin_wrong' : 'profiles.failed' });
    }
  };

  const forgot = async (profile: ProfileInfo) => {
    const ok = await confirmDialog({
      title: t('profiles.forgot_title', { name: profile.name }),
      message: t('profiles.forgot_message'),
      confirmLabel: t('profiles.forgot_confirm'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await resetPin(profile.id);
      reloadAsProfile();
    } catch {
      setBusy(false);
      setError({ key: 'profiles.failed' });
    }
  };

  // The add dialog replaces the picker while it's open; closing it comes back
  // here, with the newly added person in the list.
  // With a remote, start on a person (whoever is in now) rather than nowhere.
  useEffect(() => {
    if (!isTv || asking) return;
    const tiles = grid.current?.querySelectorAll<HTMLElement>('.pf-person');
    (grid.current?.querySelector<HTMLElement>('.pf-person.is-current') ?? tiles?.[0])?.focus();
  }, [asking]);

  if (adding) {
    return (
      <AddProfileWizard
        takenAvatars={state.profiles.map(p => p.avatar)}
        current={current}
        onClose={() => { setAdding(false); onChanged(); }}
      />
    );
  }

  return createPortal(
    <div className={`pf-screen${onClose ? ' pf-screen--over' : ''}`} role="dialog" aria-modal="true" aria-label={t('profiles.who')}>
      {/* Full screen there's no header yet, so the language switch lives here. */}
      {!onClose && <LanguageToggle />}
      {onClose && !asking && (
        <button type="button" className="pf-corner" onClick={onClose} aria-label={t('library.close')}><X size={20} /></button>
      )}

      {asking ? (
        <div className="pf-panel">
          <button type="button" className="pf-corner pf-corner--left" onClick={() => setAsking(null)} aria-label={t('profiles.back')}>
            <ArrowLeft size={20} />
          </button>
          <ProfileAvatar avatar={asking.avatar} ownerName={asking.name} className="pf-avatar pf-avatar--lg" />
          <h1 className="pf-title">{asking.name}</h1>
          <p className="pf-lede">{t('profiles.enter_pin')}</p>
          <PinPad busy={busy} error={errorText} onComplete={pin => choose(asking, pin)} />
          {state.isLocal ? (
            <button type="button" className="pf-link" onClick={() => forgot(asking)} disabled={busy}>{t('profiles.forgot_pin')}</button>
          ) : (
            <p className="pf-hint">{t('profiles.forgot_elsewhere')}</p>
          )}
        </div>
      ) : (
        <div className="pf-panel">
          <h1 className="pf-title">{t('profiles.who')}</h1>
          <div className="pf-grid" ref={grid}>
            {state.profiles.map(profile => (
              <button
                key={profile.id}
                type="button"
                className={`pf-person${profile.id === state.currentId ? ' is-current' : ''}`}
                onClick={() => choose(profile)}
                disabled={busy}
              >
                <span className="pf-person-pic">
                  <ProfileAvatar avatar={profile.avatar} ownerName={profile.name} />
                  {profile.hasPin && <span className="pf-lock" aria-label={t('profiles.has_pin')}><Lock size={13} /></span>}
                </span>
                <span className="pf-person-name">{profile.name || t('profiles.unnamed')}</span>
              </button>
            ))}
            {!isTv && (
              <button type="button" className="pf-person pf-person--add" onClick={() => setAdding(true)} disabled={busy}>
                <span className="pf-person-pic"><Plus size={34} /></span>
                <span className="pf-person-name">{t('profiles.add')}</span>
              </button>
            )}
          </div>
          {error && <p className="pf-pin-error" role="alert">{errorText}</p>}
          {onClose && (
            <button type="button" className="pf-link" onClick={() => { onClose(); window.location.assign('/settings?tab=profiles'); }}>
              <SettingsIcon size={15} /> {t('profiles.my_settings')}
            </button>
          )}
        </div>
      )}
      {/* Full screen, the app (and the host it mounts) isn't there yet. */}
      {!onClose && <ConfirmHost />}
    </div>,
    document.body
  );
}
