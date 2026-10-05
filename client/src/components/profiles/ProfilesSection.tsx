import { ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, LockOpen, Trash2 } from 'lucide-react';
import {
  deleteProfile, ProfileInfo, reloadAsProfile, setMyPin,
} from '../../lib/profiles';
import { confirmDialog } from '../../lib/confirm';
import { notify } from '../../lib/notify';
import { useProfiles } from './ProfileGate';
import { AvatarChooser, CustomPicture, EMPTY_PIN, PinChooser, pinResult } from './ProfileFields';
import ProfileAvatar from './ProfileAvatar';

/**
 * Settings › My profile: your name, picture and PIN, and deleting your own
 * profile. Other people — switching to them, adding someone — live on the
 * "Who's training?" screen, not in anyone's settings.
 */
export default function ProfilesSection({ name, onName, avatar, onAvatar, customPicture, onUpload, uploading, onRemovePhoto, backup }: {
  /** Name and picture are edited here but saved by Settings' shared Save bar. */
  name: string;
  onName: (value: string) => void;
  avatar: string;
  onAvatar: (value: string) => void;
  /** Your own photo (saved, or picked and waiting for Save). */
  customPicture: CustomPicture | null;
  onUpload: (file: File) => void;
  uploading: boolean;
  onRemovePhoto: () => void;
  /** The Backup card, placed before "Delete my profile". */
  backup?: ReactNode;
}) {
  const { t } = useTranslation();
  const ctx = useProfiles();
  const [pinEditing, setPinEditing] = useState(false);
  const [pin, setPin] = useState({ ...EMPTY_PIN, enabled: true });
  const [busy, setBusy] = useState(false);

  if (!ctx?.current) return null;
  const { current, profiles, refresh } = ctx;

  const savePin = async () => {
    const chosen = pinResult(pin);
    if (chosen.error || !chosen.pin) { notify(t(`profiles.${chosen.error || 'pin_short'}`)); return; }
    setBusy(true);
    try {
      await setMyPin(chosen.pin);
      await refresh();
      setPinEditing(false);
      setPin({ ...EMPTY_PIN, enabled: true });
      notify(t('profiles.pin_saved'), 'ok');
    } catch {
      notify(t('profiles.failed'));
    } finally {
      setBusy(false);
    }
  };

  const removePin = async () => {
    const ok = await confirmDialog({
      title: t('profiles.remove_pin_title'),
      message: t('profiles.remove_pin_message'),
      confirmLabel: t('profiles.remove_pin'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await setMyPin(null);
      await refresh();
    } catch {
      notify(t('profiles.failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (profile: ProfileInfo) => {
    const ok = await confirmDialog({
      title: t('profiles.delete_title', { name: profile.name }),
      message: t('profiles.delete_message_self'),
      confirmLabel: t('profiles.delete'),
      danger: true,
      // Everything of theirs goes: make it impossible to do by a stray tap.
      typeToConfirm: t('profiles.confirm_word'),
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteProfile(profile.id);
      // This device has no profile any more: back to "Who's training?".
      reloadAsProfile();
    } catch {
      notify(t('profiles.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-stack">
      <section className="st-card">
        <header>
          <h2>{t('profiles.you')}</h2>
          <p>{t('profiles.you_note')}</p>
        </header>
        <div className="pf-me">
          {customPicture && avatar === customPicture.value
            ? <ProfileAvatar className="pf-avatar pf-avatar--md" src={customPicture.url} />
            : <ProfileAvatar className="pf-avatar pf-avatar--md" avatar={avatar} />}
          <label className="pf-field pf-field--grow">
            <span className="pf-label">{t('profiles.name')}</span>
            <input className="pf-input" value={name} onChange={e => onName(e.target.value)} maxLength={40} />
          </label>
        </div>
        <AvatarChooser
          value={avatar}
          onChange={onAvatar}
          custom={customPicture}
          onUpload={onUpload}
          uploading={uploading}
          onRemoveCustom={onRemovePhoto}
        />
        <p className="pf-hint">{t('profiles.photo_hint')}</p>
      </section>

      <section className="st-card">
        <header>
          <h2>{t('profiles.pin_heading')}</h2>
          <p>{current.hasPin ? t('profiles.pin_on_note') : t('profiles.pin_off_note')}</p>
        </header>
        {pinEditing ? (
          <>
            <PinChooser value={pin} onChange={next => setPin({ ...next, enabled: true })} />
            <div className="st-btns">
              <button type="button" className="st-btn" onClick={() => setPinEditing(false)} disabled={busy}>{t('profiles.cancel')}</button>
              <button type="button" className="st-btn st-btn--primary" onClick={savePin} disabled={busy}>{t('profiles.save_pin')}</button>
            </div>
          </>
        ) : (
          <div className="st-btns">
            <button type="button" className="st-btn st-btn--primary" onClick={() => setPinEditing(true)} disabled={busy}>
              <Lock size={15} /> {current.hasPin ? t('profiles.change_pin') : t('profiles.set_pin')}
            </button>
            {current.hasPin && (
              <button type="button" className="st-btn" onClick={removePin} disabled={busy}>
                <LockOpen size={15} /> {t('profiles.remove_pin')}
              </button>
            )}
          </div>
        )}
      </section>

      {backup}

      {/* Only your own profile, and only while someone else would remain: the
          last profile can't go. Other people's profiles aren't managed here. */}
      {profiles.length > 1 && (
        <section className="st-card">
          <header>
            <h2>{t('profiles.delete_mine')}</h2>
            <p>{t('profiles.delete_mine_note')}</p>
          </header>
          <div className="st-btns">
            <button type="button" className="st-btn pf-danger" onClick={() => remove(current)} disabled={busy}>
              <Trash2 size={15} /> {t('profiles.delete_mine')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
