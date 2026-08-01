export type Video = {
  id: string;
  filename: string;
  relative_path: string;
  thumbnail_path?: string | null;
  description?: string;
  equipment?: string[];
  training_type?: string[];
  body_parts?: string[];
  intensity?: string;
  /** Runtime in seconds, filled in by the library scan. Null when not probed. */
  duration_seconds?: number | null;
  /**
   * Where the video comes from. 'local' is a file under the scanned library
   * directory; 'youtube' is an imported playlist entry with no file on disk,
   * played through YouTube's embed. Absent on responses that predate imports.
   */
  source?: 'local' | 'youtube' | string;
  /** Provider-side ID (YouTube video ID). Null for local videos. */
  external_id?: string | null;
  /** Canonical watch URL. Null for local videos. */
  external_url?: string | null;
  /** Playlist this was imported from. Stable album key; survives renames. */
  external_playlist_id?: string | null;
  /** Album display name, seeded from the playlist and user-editable. */
  external_playlist_title?: string | null;
};
