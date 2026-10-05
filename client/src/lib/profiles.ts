/**
 * Profiles: several people sharing one install, each with their own plans,
 * progress, log, favourites, settings and library folder.
 *
 * Each device remembers who it is in a cookie the server sets, so nothing here
 * stores the current profile — the server always knows. A device that hasn't
 * picked one (or was signed out by a PIN change) gets a 401 marked
 * `X-Profile-Required` from any API call, and the app answers it by showing
 * the profile picker.
 */

export interface ProfileInfo {
  id: string;
  name: string;
  avatar: string;
  hasPin: boolean;
  setupDone: boolean;
}

export interface ProfilesState {
  profiles: ProfileInfo[];
  currentId: string | null;
  /** True on the computer running the app — the only place a forgotten PIN can be reset. */
  isLocal: boolean;
}

export const AVATARS = ['avatar-1', 'avatar-2', 'avatar-3', 'avatar-4', 'avatar-5', 'avatar-6'];

/** A built-in picture, or a profile's own uploaded photo (`custom:<file>`). */
export const avatarUrl = (avatar: string) =>
  avatar.startsWith('custom:')
    ? `/api/profiles/pictures/${encodeURIComponent(avatar.slice('custom:'.length))}`
    : `/avatars/${AVATARS.includes(avatar) ? avatar : AVATARS[0]}.png`;

/** Fired when the server says this device has to pick a profile. */
export const PROFILE_REQUIRED_EVENT = 'mfp:profile-required';

let guardInstalled = false;

/**
 * Watch every API response for "pick a profile". Installed once, before the
 * app renders, so no page has to handle it.
 */
export function installProfileGuard() {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    if (response.status === 401 && response.headers.get('X-Profile-Required')) {
      window.dispatchEvent(new Event(PROFILE_REQUIRED_EVENT));
    }
    return response;
  };
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || 'failed'), { code: data?.error, status: res.status });
  return data as T;
}

export const fetchProfiles = () => call<ProfilesState>('/api/profiles');

export const selectProfile = (id: string, pin?: string) =>
  call<{ profile: ProfileInfo }>(`/api/profiles/${encodeURIComponent(id)}/select`, 'POST', { pin });

export const setupProfile = (body: { name: string; avatar: string; pin?: string }) =>
  call<{ profile: ProfileInfo }>('/api/profiles/setup', 'POST', body);

export interface NewProfile {
  name: string;
  avatar: string;
  pin?: string;
  mode: 'copy' | 'fresh';
  sourceId?: string;
  planIds: string[];
}

export const createProfile = (body: NewProfile) => call<{ profile: ProfileInfo }>('/api/profiles', 'POST', body);

export const updateMyProfile = (body: { name?: string; avatar?: string }) =>
  call<{ profile: ProfileInfo }>('/api/profiles/me', 'PATCH', body);

export const setMyPin = (pin: string | null) => call<{ profile: ProfileInfo }>('/api/profiles/me/pin', 'PUT', { pin });

/** Upload your own photo (already squared and shrunk — see imageResize). */
export async function uploadMyPicture(picture: Blob): Promise<{ profile: ProfileInfo }> {
  const form = new FormData();
  form.append('file', picture, 'picture.jpg');
  const res = await fetch('/api/profiles/me/picture', { method: 'POST', body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || 'failed'), { code: data?.error });
  return data;
}

export const resetPin = (id: string) => call<{ profile: ProfileInfo }>(`/api/profiles/${encodeURIComponent(id)}/reset-pin`, 'POST');

export const deleteProfile = (id: string) => call<{ success: boolean }>(`/api/profiles/${encodeURIComponent(id)}`, 'DELETE');

export interface ProfilePlan { id: string; name: string; category: string | null; workout_count: number }

export const profilePlans = (id: string) =>
  call<{ plans: ProfilePlan[] }>(`/api/profiles/${encodeURIComponent(id)}/plans`);

/**
 * Start over as whoever is now selected. Every page loads its data on mount,
 * so a full reload onto the dashboard is the one way to be sure nothing from
 * the previous profile lingers (a plan page's URL wouldn't even exist for them).
 */
export function reloadAsProfile(path = '/') {
  window.location.assign(path);
}

// --- Backups ---------------------------------------------------------------

export interface BackupPrefs {
  /** 0 = off. */
  everyDays: number;
  keep: number;
  /** Chosen folder; '' = the app's own data folder. */
  dir: string;
}

export interface BackupInfo extends BackupPrefs {
  folder: string;
  defaultFolder: string;
  lastAt: string | null;
  canChooseFolder: boolean;
  /** This profile's backups in the folder right now. */
  files: number;
  totalBytes: number;
  folderExists: boolean;
  /** On a schedule, and well past when the next backup was due. */
  overdue: boolean;
}

/** "3.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface BackupSummary {
  profileId: string;
  profileName: string;
  createdAt: string;
  plans: number;
  logEntries: number;
  profileExistsHere: boolean;
}

export const getMyBackup = () => call<BackupInfo>('/api/profiles/me/backup');

export const saveMyBackup = (prefs: Partial<BackupPrefs>) => call<{ success: boolean }>('/api/profiles/me/backup', 'PUT', prefs);

export const backupNow = () => call<{ file: string }>('/api/profiles/me/backup/now', 'POST', {});

/** A backup file's contents, read and parsed — or null if it isn't JSON at all. */
export async function readBackupFile(file: File): Promise<unknown | null> {
  try { return JSON.parse(await file.text()); } catch { return null; }
}

export const inspectBackup = (file: unknown) => call<BackupSummary>('/api/profiles/backup/inspect', 'POST', { file });

export const restoreMyBackup = (file: unknown) =>
  call<{ plans: number; logEntries: number; videos: number }>('/api/profiles/me/backup/restore', 'POST', { file });

export const restoreAsProfile = (file: unknown) =>
  call<{ profile: ProfileInfo; plans: number; logEntries: number }>('/api/profiles/restore', 'POST', { file });
