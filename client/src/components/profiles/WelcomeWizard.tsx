import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { ProfileInfo, setupProfile, uploadMyPicture } from '../../lib/profiles';
import { PictureError, squarePicture } from '../../lib/imageResize';
import { notify } from '../../lib/notify';
import { AvatarChooser, EMPTY_PIN, PinChooser, pinResult, ThemeChooser } from './ProfileFields';
import LanguageToggle from './LanguageToggle';

/**
 * The first screen after installing — or after updating to the version with
 * profiles, when this profile already holds everything the app had. Either
 * way it only names the profile: nothing is moved or changed.
 *
 * A brand-new install has no videos yet, so it carries on to Settings to pick
 * the video folder.
 */
export default function WelcomeWizard({ profile, onDone }: { profile: ProfileInfo; onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(profile.avatar);
  const [pin, setPin] = useState(EMPTY_PIN);
  const [hasLibrary, setHasLibrary] = useState<boolean | null>(null);
  // The profile's theme, previewed across the screen as soon as it's tapped.
  const [theme, setTheme] = useState(() => document.body.getAttribute('data-theme') || 'midnight');
  // Which message, not its text: shown in whatever language is current.
  const [error, setError] = useState<{ key: string; params?: Record<string, unknown> } | null>(null);
  const errorText = error ? String(t(error.key, error.params)) : null;
  const [busy, setBusy] = useState(false);
  // Your own photo, shrunk and waiting to be uploaded with everything else.
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  const pickPhoto = async (file: File) => {
    setPreparingPhoto(true);
    setError(null);
    try {
      const blob = await squarePicture(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setAvatar('photo');
    } catch (err) {
      setError({ key: err instanceof PictureError && err.code === 'too_large' ? 'profiles.photo_too_large' : 'profiles.photo_not_image' });
    } finally {
      setPreparingPhoto(false);
    }
  };

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        setHasLibrary(Boolean(data?.video_directory));
        if (data?.theme) setTheme(data.theme);
      })
      .catch(() => setHasLibrary(true));
  }, []);

  const save = async (skip = false) => {
    const chosen = pinResult(pin);
    const finalName = skip ? t('profiles.default_name') : name.trim();
    if (!skip && !finalName) { setError({ key: 'profiles.name_required' }); return; }
    if (!skip && chosen.error) { setError({ key: `profiles.${chosen.error}` }); return; }
    setBusy(true);
    setError(null);
    try {
      const usePhoto = !skip && avatar === 'photo' && photo;
      await setupProfile({ name: finalName, avatar: usePhoto ? profile.avatar : avatar, pin: skip ? undefined : chosen.pin ?? undefined });
      // The photo goes up last. If it fails, setup has still happened — with a
      // built-in picture — and the photo can be tried again in My profile.
      let photoFailed = false;
      if (usePhoto) {
        try { await uploadMyPicture(photo.blob); } catch { photoFailed = true; }
      }
      if (photoFailed) window.setTimeout(() => notify(t('profiles.photo_failed_later')), 600);
      if (!skip) {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme }),
        }).catch(() => { /* the theme can be picked again in Settings */ });
      }
      if (hasLibrary === false) window.location.assign('/settings');
      else onDone();
    } catch {
      setBusy(false);
      setError({ key: 'profiles.failed' });
    }
  };

  return createPortal(
    <div className="pf-screen" role="dialog" aria-modal="true" aria-label={t('profiles.welcome_title')}>
      <LanguageToggle />
      <form className="pf-panel pf-panel--form" onSubmit={e => { e.preventDefault(); save(); }}>
        <img className="pf-logo" src="/logo.png" alt="" />
        <h1 className="pf-title">{t('profiles.welcome_title')}</h1>
        <p className="pf-lede">
          {hasLibrary === false ? t('profiles.welcome_new') : t('profiles.welcome_upgrade')}
        </p>

        <label className="pf-field">
          <span className="pf-label">{t('profiles.name')}</span>
          <input
            className="pf-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('profiles.name_placeholder')}
            maxLength={40}
            autoFocus
          />
        </label>

        <div className="pf-field">
          <span className="pf-label">{t('profiles.avatar')}</span>
          <AvatarChooser
            value={avatar}
            onChange={setAvatar}
            custom={photo ? { value: 'photo', url: photo.url } : null}
            onUpload={pickPhoto}
            uploading={preparingPhoto}
            onRemoveCustom={() => {
              setPhoto(null);
              if (avatar === 'photo') setAvatar(profile.avatar.startsWith('custom:') ? 'avatar-1' : profile.avatar);
            }}
          />
        </div>

        <div className="pf-field">
          <span className="pf-label">{t('profiles.theme')}</span>
          <ThemeChooser value={theme} onChange={next => { setTheme(next); document.body.setAttribute('data-theme', next); }} />
        </div>

        <PinChooser value={pin} onChange={setPin} />

        {error && <p className="pf-pin-error" role="alert">{errorText}</p>}

        <button type="submit" className="pf-primary" disabled={busy}>
          {hasLibrary === false ? t('profiles.continue_to_folder') : t('profiles.done')}
          <ArrowRight size={17} />
        </button>
        <button type="button" className="pf-link" onClick={() => save(true)} disabled={busy}>
          {t('profiles.skip')}
        </button>
      </form>
    </div>,
    document.body
  );
}
