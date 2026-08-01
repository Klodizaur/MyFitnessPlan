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
};
