import { runTvBackHandlers, tvNavigate } from '../lib/tv';
import { focusScope, installSpatialNav } from './spatialNav';
import '../styles/tv.css';

/**
 * TV mode's entry point, loaded only inside the Android TV app (see lib/tv.ts).
 *
 * The app shell (tv/app/.../MainActivity.kt) calls `window.mfpTv` for the keys a
 * page can't normally see: Back, and the remote's media buttons.
 */

/** Screens reached from the nav bar: Back from these goes Home, not through history. */
const SECTIONS = ['/plans', '/calendar', '/library', '/profile', '/settings'];

/** Backdrops and close buttons, for the overlays that don't listen for Escape. */
const CLOSERS = '.md-close, .pl-sheet-close, .lib-sheet-close, [data-tv-close]';
const BACKDROPS = '.pl-backdrop, .lib-sheet-backdrop, .cal-backdrop, .pv-loop-scrim, .pb-sheet-backdrop';

function pressEscape(): void {
  const target = (document.activeElement as HTMLElement | null) || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}

function closeTopOverlay(scope: HTMLElement): void {
  pressEscape();
  // Most overlays close on Escape. Give it a moment; if this one is still up,
  // use its own close button or its backdrop, the way a click would.
  window.setTimeout(() => {
    if (scope === document.body || !scope.isConnected) return;
    const closer = scope.querySelector<HTMLElement>(CLOSERS);
    if (closer) { closer.click(); return; }
    const backdrop = scope.parentElement?.querySelector<HTMLElement>(BACKDROPS);
    backdrop?.click();
  }, 60);
}

/** Returns false only on Home with nothing open: the app then offers to exit. */
function back(): boolean {
  const scope = focusScope();
  if (scope !== document.body || document.querySelector('[aria-expanded="true"]')) {
    closeTopOverlay(scope);
    return true;
  }
  // The screen's own use of Back (the player leaving full screen).
  if (runTvBackHandlers()) return true;

  const path = window.location.pathname;
  if (path === '/') return false;
  if (SECTIONS.includes(path)) {
    tvNavigate('/');
    return true;
  }
  // Somewhere inside a section (the player, an album): step back out of it.
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  tvNavigate(idx > 0 ? -1 : '/');
  return true;
}

/** Media buttons arrive as the key names a keyboard's media keys would have. */
function key(name: string): void {
  const target = (document.activeElement as HTMLElement | null) || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

export function startTvMode(): void {
  document.documentElement.setAttribute('data-tv', '');
  installSpatialNav();
  (window as unknown as { mfpTv: object }).mfpTv = { back, key };
}
