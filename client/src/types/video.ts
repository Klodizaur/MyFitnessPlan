export type Video = {
  id: string;
  filename: string;
  relative_path: string;
  thumbnail_path?: string | null;
  description?: string;
  equipment?: string[];
};
