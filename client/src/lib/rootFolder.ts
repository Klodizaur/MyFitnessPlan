import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SETTINGS_SAVED_EVENT } from './settingsEvents';

/**
 * The name to show for videos sitting directly in your library folder: the
 * folder's own name ("Dzieci"), rather than a generic "Root folder" — which
 * is all the folder is to you if you pointed the app straight at it.
 */
let cached: Promise<string> | null = null;

function libraryFolderName(): Promise<string> {
  if (!cached) {
    cached = fetch('/api/settings')
      .then(r => (r.ok ? r.json() : {}))
      .then((data: { video_directory?: string }) => {
        const parts = (data.video_directory || '').split(/[\\/]+/).filter(Boolean);
        return parts[parts.length - 1] || '';
      })
      .catch(() => '');
  }
  return cached;
}

// A new folder (picked and scanned in Settings) means a new name.
if (typeof window !== 'undefined') {
  window.addEventListener(SETTINGS_SAVED_EVENT, () => { cached = null; });
}

export function useRootFolderName(): string {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  useEffect(() => {
    let alive = true;
    libraryFolderName().then(value => { if (alive) setName(value); });
    return () => { alive = false; };
  }, []);
  return name || t('library.root_folder');
}
