import { ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Loader, X } from 'lucide-react';
import { AVATARS } from '../../lib/profiles';
import ProfileAvatar, { useAvatarDescription } from './ProfileAvatar';
import { THEMES } from '../../lib/themes';
import { isTv } from '../../lib/tv';
import '../../styles/settings.css';

/** An uploaded photo offered as a choice: its avatar value and where to show it from. */
export interface CustomPicture { value: string; url: string }

/**
 * The six built-in pictures, plus — where `onUpload` is given — your own photo:
 * an "Upload photo" tile, and the photo itself as a tile once there is one, so
 * you can switch away from it and back before saving.
 */
export function AvatarChooser({ value, onChange, custom, onUpload: uploadHandler, uploading, onRemoveCustom }: {
  value: string;
  onChange: (avatar: string) => void;
  custom?: CustomPicture | null;
  onUpload?: (file: File) => void;
  uploading?: boolean;
  /** Shows a small × on your photo, to stop using (and delete) it. */
  onRemoveCustom?: () => void;
}) {
  // The TV app's WebView has no file picker, so no photo upload there.
  const onUpload = isTv ? undefined : uploadHandler;
  const { t } = useTranslation();
  const describe = useAvatarDescription();
  const input = useRef<HTMLInputElement>(null);
  const tile = (key: string, selected: boolean, label: string, onClick: () => void, picture: ReactNode) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      className={`pf-avatar-pick${selected ? ' is-on' : ''}`}
      onClick={onClick}
    >
      {picture}
      {selected && <span className="pf-avatar-check"><Check size={14} strokeWidth={3} /></span>}
    </button>
  );
  return (
    <div className={`pf-avatars${onUpload ? ' pf-avatars--upload' : ''}`} role="radiogroup" aria-label={t('profiles.avatar')}>
      {custom && (
        // A wrapper, so the × can sit on the tile without being a button inside a button.
        <span className="pf-avatar-custom">
          {tile('custom', value === custom.value, t('profiles.your_photo'), () => onChange(custom.value),
            <ProfileAvatar src={custom.url} />)}
          {onRemoveCustom && (
            <button
              type="button"
              className="pf-avatar-remove"
              onClick={onRemoveCustom}
              aria-label={t('profiles.remove_photo')}
              title={t('profiles.remove_photo')}
            >
              <X size={12} strokeWidth={3} />
            </button>
          )}
        </span>
      )}
      {AVATARS.map(avatar => tile(avatar, value === avatar, describe(avatar), () => onChange(avatar),
        <ProfileAvatar avatar={avatar} />))}
      {onUpload && (
        <>
          <button
            type="button"
            className="pf-avatar-pick pf-avatar-upload"
            onClick={() => input.current?.click()}
            disabled={uploading}
            aria-label={t('profiles.upload_photo')}
            title={t('profiles.upload_photo')}
          >
            {uploading ? <Loader size={20} className="st-spin" /> : <Camera size={20} />}
          </button>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={e => {
              const file = e.target.files?.[0];
              // Cleared so picking the same file again still counts as a change.
              e.target.value = '';
              if (file) onUpload(file);
            }}
          />
        </>
      )}
    </div>
  );
}

export interface PinChoice {
  enabled: boolean;
  pin: string;
  confirm: string;
}

export const EMPTY_PIN: PinChoice = { enabled: false, pin: '', confirm: '' };

/** The PIN to save, or null; `error` explains why it can't be saved yet. */
export function pinResult(choice: PinChoice): { pin: string | null; error: 'pin_short' | 'pin_mismatch' | null } {
  if (!choice.enabled) return { pin: null, error: null };
  if (!/^\d{4}$/.test(choice.pin)) return { pin: null, error: 'pin_short' };
  if (choice.pin !== choice.confirm) return { pin: null, error: 'pin_mismatch' };
  return { pin: choice.pin, error: null };
}

/** "Protect with a PIN", with the PIN typed twice. */
export function PinChooser({ value, onChange }: { value: PinChoice; onChange: (next: PinChoice) => void }) {
  const { t } = useTranslation();
  const digits = (raw: string) => raw.replace(/\D/g, '').slice(0, 4);
  return (
    <div className="pf-pin-choice">
      <label className="pf-check">
        <input type="checkbox" checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} />
        <span>{t('profiles.use_pin')}</span>
      </label>
      {value.enabled && (
        <>
          <div className="pf-pin-fields">
            <input
              className="pf-input pf-input--pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder={t('profiles.pin')}
              value={value.pin}
              onChange={e => onChange({ ...value, pin: digits(e.target.value) })}
              aria-label={t('profiles.pin')}
            />
            <input
              className="pf-input pf-input--pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              placeholder={t('profiles.pin_again')}
              value={value.confirm}
              onChange={e => onChange({ ...value, confirm: digits(e.target.value) })}
              aria-label={t('profiles.pin_again')}
            />
          </div>
          <p className="pf-hint">{t('profiles.pin_hint')}</p>
        </>
      )}
    </div>
  );
}

/** The colour themes, drawn the way Settings › Appearance draws them. */
export function ThemeChooser({ value, onChange }: { value: string; onChange: (theme: string) => void }) {
  const { t } = useTranslation();
  return (
    <div className="st-themes pf-themes">
      {THEMES.map(th => (
        <button
          key={th.id}
          type="button"
          className={`st-theme${value === th.id ? ' is-on' : ''}`}
          style={{ background: th.bg, color: th.fg }}
          onClick={() => onChange(th.id)}
          aria-pressed={value === th.id}
        >
          <span className="st-theme-dots">
            <i style={{ background: th.accent }} />
            <i style={{ background: th.surface, border: '1px solid rgba(0,0,0,0.08)' }} />
          </span>
          <span className="st-theme-name">{t(`settings.themes.${th.id}`)}</span>
          {value === th.id && <span className="st-theme-check"><Check size={13} /></span>}
        </button>
      ))}
    </div>
  );
}
