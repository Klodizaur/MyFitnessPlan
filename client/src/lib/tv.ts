/**
 * TV mode: the web interface as shown by the Android TV app (tv/ at the repo root).
 *
 * The TV app's WebView adds `MyFitnessPlanTV/<version>` to its user agent, and
 * that marker is the only thing that turns TV mode on. Every browser on a
 * computer, phone or tablet sees `isTv === false`, and the TV-only code and
 * styles (src/tv/) are never even downloaded there.
 */
export const isTv = typeof navigator !== 'undefined' && /\bMyFitnessPlanTV\//.test(navigator.userAgent);

/**
 * A screen can claim a key before remote navigation moves focus — the player
 * uses it so the first press on hidden controls only brings them back.
 * Return true to swallow the key.
 */
type KeyInterceptor = (e: KeyboardEvent) => boolean;
const interceptors = new Set<KeyInterceptor>();

export function addTvKeyInterceptor(fn: KeyInterceptor): () => void {
  interceptors.add(fn);
  return () => { interceptors.delete(fn); };
}

export function runTvKeyInterceptors(e: KeyboardEvent): boolean {
  for (const fn of interceptors) if (fn(e)) return true;
  return false;
}

/** What the Android shell exposes to the page (MainActivity.addJavascriptInterface). */
type TvShell = { setKeepScreenOn?: (on: boolean) => void; setVideoOpen?: (open: boolean) => void };

/**
 * Fire TV plays video on a surface behind the app window; the page cuts a hole
 * for it, and the TV app clears what sits behind the page while the player is
 * open so the picture shows through that hole.
 */
export function tvVideoOpen(open: boolean): void {
  if (!isTv) return;
  try {
    (window as unknown as { MfpTvShell?: TvShell }).MfpTvShell?.setVideoOpen?.(open);
  } catch {
    // An older TV app without the bridge.
  }
}

/** Stop the TV's screensaver while a workout is running; let it back when not. */
export function tvKeepScreenOn(on: boolean): void {
  if (!isTv) return;
  try {
    (window as unknown as { MfpTvShell?: TvShell }).MfpTvShell?.setKeepScreenOn?.(on);
  } catch {
    // An older TV app without the bridge: the screensaver just behaves as usual.
  }
}

/**
 * The router's navigate, handed over by <TvRouteSync> so the remote's Back can
 * move between screens without a reference to React.
 */
type Navigate = (to: string | number) => void;
let routerNavigate: Navigate | null = null;
export function setTvNavigate(fn: Navigate | null): void { routerNavigate = fn; }
export function tvNavigate(to: string | number): void { routerNavigate?.(to); }

type TvShellYouTube = { canOpenYouTube?: () => boolean; openYouTube?: (id: string) => void };
const shell = () => (window as unknown as { MfpTvShell?: TvShellYouTube }).MfpTvShell;

/** True when the TV has an app that plays YouTube links (asked of the TV app). */
export function canOpenYouTubeApp(): boolean {
  if (!isTv) return false;
  try { return shell()?.canOpenYouTube?.() === true; } catch { return false; }
}

/** Hand a video the uploader won't let us embed to the TV's YouTube app. */
export function openYouTubeApp(videoId: string): void {
  try { shell()?.openYouTube?.(videoId); } catch { /* nothing to open it with */ }
}

/**
 * A screen can take the remote's Back before it leaves the screen — the player
 * uses it to step out of full screen first. The newest handler asks first;
 * return true when Back was used.
 */
type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];

export function addTvBackHandler(fn: BackHandler): () => void {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i !== -1) backHandlers.splice(i, 1);
  };
}

export function runTvBackHandlers(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
  return false;
}
