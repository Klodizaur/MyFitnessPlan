/**
 * The contract between the app and whatever tool reads a playlist.
 *
 * Nothing in this file knows how playlists are actually fetched. That lives in a
 * single implementation module (currently `ytdlp.ts`) which is registered in
 * `index.ts`. See the removal note there.
 */

/** One video as reported by a provider, before it becomes a `videos` row. */
export interface ExternalVideo {
  /** Provider-side ID, e.g. a YouTube video ID. Stored as `videos.external_id`. */
  externalId: string;
  title: string;
  /** Canonical watch URL. Stored as `videos.external_url`. */
  url: string;
  /** Runtime in whole seconds, or null when the provider didn't report one. */
  durationSeconds: number | null;
  /** Remote image URL. Downloaded at import so the UI keeps using /thumbnails/. */
  thumbnailUrl: string | null;
}

export interface ResolvedPlaylist {
  /**
   * Provider-side playlist ID. Becomes the album's stable grouping key, so it
   * must not change when the user renames the album. Falls back to the video ID
   * when a single video URL was imported rather than a playlist.
   */
  playlistId: string;
  /** Display name, seeded from the provider and editable afterwards. */
  title: string;
  items: ExternalVideo[];
  /** True when the playlist was longer than the import cap and was cut short. */
  truncated: boolean;
}

export interface PlaylistResolver {
  /**
   * Value written to `videos.source` for anything this resolver imports.
   * The client keys playback behaviour off it, so it must stay stable.
   */
  readonly source: string;

  /** Whether the backing tool is present and runnable on this machine. */
  isAvailable(): Promise<boolean>;

  /** Whether this resolver recognises the URL at all. */
  canResolve(url: string): boolean;

  /** Throws {@link PlaylistResolveError} on any failure the user should see. */
  resolve(url: string): Promise<ResolvedPlaylist>;

  /**
   * Descriptions for the given videos, keyed by external ID.
   *
   * Separate from {@link resolve} because listing a playlist is one cheap
   * request while descriptions need a full extraction per video — far too slow
   * to make the user wait on. Callers run this in the background afterwards.
   *
   * Missing entries simply have no description available; this never throws.
   */
  fetchDescriptions(externalIds: string[]): Promise<Map<string, string>>;
}

/**
 * A failure worth showing the user verbatim. `code` lets the client pick a
 * translated message instead of surfacing raw tool output.
 */
export class PlaylistResolveError extends Error {
  constructor(
    public readonly code:
      | 'unavailable'      // the backing tool isn't installed / didn't run
      | 'unsupported_url'  // not a URL this resolver handles
      | 'not_found'        // no such playlist, or it's private
      | 'empty'            // resolved fine but contained nothing importable
      | 'failed',          // anything else
    message: string
  ) {
    super(message);
    this.name = 'PlaylistResolveError';
  }
}
