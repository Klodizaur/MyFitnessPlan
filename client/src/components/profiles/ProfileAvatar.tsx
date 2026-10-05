import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AVATARS, avatarUrl } from '../../lib/profiles';

const FALLBACK = '/avatars/avatar-1.png';

/** What a built-in picture shows, for alt text and labels ("Cat stretching"). */
export function useAvatarDescription() {
  const { t } = useTranslation();
  return (avatar: string, ownerName?: string): string => {
    if (AVATARS.includes(avatar)) return t(`profiles.avatar_desc.${avatar}`);
    // An uploaded photo: nothing to describe but whose it is.
    return ownerName ? t('profiles.photo_of', { name: ownerName }) : t('profiles.your_photo');
  };
}

/**
 * A profile's picture, with alt text describing it. If an uploaded photo can't
 * be loaded (its file was removed, or the server didn't answer), it quietly
 * shows a built-in picture instead of a broken image.
 */
export default function ProfileAvatar({ avatar, src, className = 'pf-avatar', ownerName, alt }: {
  avatar?: string;
  /** A ready URL instead (e.g. a photo picked but not saved yet). */
  src?: string;
  className?: string;
  /** Whose picture it is, for an uploaded photo's alt text. */
  ownerName?: string;
  /** Overrides the description. */
  alt?: string;
}) {
  const describe = useAvatarDescription();
  const wanted = src ?? avatarUrl(avatar ?? '');
  const [url, setUrl] = useState(wanted);
  useEffect(() => { setUrl(wanted); }, [wanted]);
  const text = alt ?? describe(src ? 'custom' : avatar ?? '', ownerName);
  return <img className={className} src={url} alt={text} onError={() => { if (url !== FALLBACK) setUrl(FALLBACK); }} />;
}
