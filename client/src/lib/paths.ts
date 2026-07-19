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
