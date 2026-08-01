/** Normalize path separators to POSIX `/` (safe no-op on already-POSIX paths). */
export function toPosixPath(rel: string): string {
  return (rel || '').replace(/\\/g, '/');
}

/** Non-empty path segments after POSIX normalization. */
export function pathSegments(rel: string): string[] {
  return toPosixPath(rel).split('/').filter(Boolean);
}

/**
 * Top-level library album key.
 * Videos in a subfolder → first folder name.
 * Videos at library root → `'.'` (display/storage key; use {@link toAlbumRouteParam} for URLs).
 */
export function topLevelAlbumKey(rel: string): string {
  const parts = pathSegments(rel);
  return parts.length > 1 ? parts[0] : '.';
}

/**
 * Namespace for album keys belonging to imported playlists.
 *
 * Each playlist becomes its own album, keyed by the provider's playlist ID
 * rather than its name — so renaming an album never re-buckets its videos. The
 * prefix keeps those keys from ever colliding with a real folder name, and
 * keeps external videos (whose `relative_path` is empty) out of the library
 * root album where path-based grouping would otherwise put them.
 */
export const EXTERNAL_ALBUM_PREFIX = 'yt:';

/** True for videos played through a provider embed rather than a local file. */
export function isExternalVideo(video: { source?: string }): boolean {
  return (video.source || 'local') !== 'local';
}

/** True for an album key produced by {@link albumKeyForVideo} for an import. */
export function isExternalAlbumKey(key: string): boolean {
  return key.startsWith(EXTERNAL_ALBUM_PREFIX);
}

/** The playlist ID inside an external album key. */
export function playlistIdFromAlbumKey(key: string): string {
  return key.slice(EXTERNAL_ALBUM_PREFIX.length);
}

/** Album a video belongs to: its playlist when imported, else its folder. */
export function albumKeyForVideo(video: {
  source?: string;
  relative_path?: string;
  external_playlist_id?: string | null;
}): string {
  if (!isExternalVideo(video)) return topLevelAlbumKey(video.relative_path || '');
  // Imports made before playlists were tracked have no ID; they share one
  // fallback album rather than vanishing from the library.
  return `${EXTERNAL_ALBUM_PREFIX}${video.external_playlist_id || 'unknown'}`;
}

/** URL-safe album param: browsers collapse `/library/.` to `/library/`. */
export function toAlbumRouteParam(key: string): string {
  return key === '.' ? '_root' : key;
}

/** Decode album route param back to the internal album key. */
export function fromAlbumRouteParam(param: string | undefined): string {
  if (!param) return '';
  const key = decodeURIComponent(param);
  return key === '_root' ? '.' : key;
}

/** Build a `/videos/...` stream URL from a relative library path. */
export function videoStreamUrl(rel: string): string {
  return `/videos/${pathSegments(rel).map(encodeURIComponent).join('/')}`;
}
