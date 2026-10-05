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
  /** Starred by the user; gathered into the Favourites album. */
  is_favorite?: boolean;
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
  /**
   * When the video arrived, as ISO text: a local file's creation date on disk,
   * or when an imported video was added to the app.
   */
  added_at?: string | null;
  /**
   * False for a video that's only here because one of your plans uses it (a
   * plan copied from someone whose folder isn't yours): the plan plays it, but
   * it isn't part of the library you browse.
   */
  in_library?: boolean;
    /** Times this video has been completed, from the workout log. */
  completed_count?: number;
};

/** Whether a video is part of the library you browse (see `in_library`). */
export const inLibrary = (video: { in_library?: boolean }) => video.in_library !== false;
