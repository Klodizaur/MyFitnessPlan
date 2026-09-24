/**
 * Fullscreen, across the three APIs that actually exist in the wild.
 *
 * - Standard `requestFullscreen`: desktop browsers, Android.
 * - `webkitRequestFullscreen`: Safari on iPadOS and macOS, which never
 *   unprefixed the element API.
 * - `webkitEnterFullscreen` on the <video> itself: iPhone, which has no element
 *   fullscreen at all — the only thing that can fill the screen there is the
 *   system video player.
 *
 * The first two are preferred because they fullscreen the whole theater, which
 * keeps the app's own overlays (the loop counter, the rest countdown) on screen.
 * The iPhone fallback hands playback to the system player, so those overlays are
 * gone until it is dismissed; that is a platform limit, not a choice.
 */

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/** The element currently filling the screen, under either spelling. */
export function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement || doc.webkitFullscreenElement || null;
}

/** True when this browser can fullscreen something for us. */
export function canFullscreen(
  container: HTMLElement | null,
  video: HTMLVideoElement | null
): boolean {
  const el = container as FullscreenElement | null;
  const vid = video as FullscreenVideo | null;
  return Boolean(
    el?.requestFullscreen ||
    el?.webkitRequestFullscreen ||
    vid?.webkitEnterFullscreen
  );
}

export function exitFullscreen(): void {
  const doc = document as FullscreenDocument;
  if (doc.exitFullscreen) void doc.exitFullscreen();
  else if (doc.webkitExitFullscreen) void doc.webkitExitFullscreen();
}

/** Hand playback to the system video player. iPhone's only option; iPad's backup. */
function enterVideoFullscreen(video: HTMLVideoElement | null): boolean {
  const vid = video as FullscreenVideo | null;
  if (!vid?.webkitEnterFullscreen) return false;
  vid.webkitEnterFullscreen();
  return true;
}

/**
 * Fill the screen with `container`, falling back to the video's own player when
 * that is all the device offers. Returns false when nothing could be done.
 *
 * A browser can advertise `requestFullscreen` and still refuse the request —
 * an embedded webview with nothing to go fullscreen into, or Safari declining
 * for a container it doesn't like. Rejection is treated as "this route didn't
 * work" and drops through to the video player, so the button does something
 * everywhere rather than silently doing nothing on the devices that matter.
 */
export function enterFullscreen(
  container: HTMLElement | null,
  video: HTMLVideoElement | null
): boolean {
  const el = container as FullscreenElement | null;
  const request = el?.requestFullscreen
    ? () => el.requestFullscreen()
    : el?.webkitRequestFullscreen
      ? () => el.webkitRequestFullscreen!()
      : null;

  if (request) {
    try {
      void Promise.resolve(request()).catch(() => enterVideoFullscreen(video));
      return true;
    } catch {
      // Older Safari throws synchronously instead of rejecting.
      return enterVideoFullscreen(video);
    }
  }
  return enterVideoFullscreen(video);
}

/**
 * Subscribe to fullscreen changes, including the iPhone video player's own
 * begin/end events — which do not fire `fullscreenchange`.
 */
export function onFullscreenChange(
  video: HTMLVideoElement | null,
  handler: () => void
): () => void {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);
  video?.addEventListener('webkitbeginfullscreen', handler);
  video?.addEventListener('webkitendfullscreen', handler);
  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
    video?.removeEventListener('webkitbeginfullscreen', handler);
    video?.removeEventListener('webkitendfullscreen', handler);
  };
}
