/**
 * Fired after Settings saves something other pages read (the workout rhythm,
 * the library folder). On mobile, Settings opens over the current page rather
 * than replacing it; this tells the shell that page's data may now be stale.
 */
export const SETTINGS_SAVED_EVENT = 'settings:saved';

export const announceSettingsSaved = () => window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
