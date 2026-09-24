import { useMetaLabels } from './labels';
import { Video } from '../types/video';

/**
 * A video's metadata as the read-only tags the redesign shows on every card.
 *
 * The design gives each kind of tag its own colour — that pairing is what lets
 * you read a row of tags at a glance rather than reading every word — so the
 * category travels with the label instead of being guessed at the call site.
 *
 * Order matters and is fixed: intensity, then training type, then body parts,
 * then equipment. Cards cap the row with max-height rather than slicing, so
 * the most useful tags are the ones that survive.
 */
export type TagCategory = 'intensity' | 'type' | 'body' | 'gear';

export interface VideoTag {
  key: string;
  label: string;
  category: TagCategory;
}

export function useVideoTags() {
  const labels = useMetaLabels();

  return (video: Video): VideoTag[] => {
    const tags: VideoTag[] = [];

    if (video.intensity) {
      tags.push({
        key: `int:${video.intensity}`,
        label: labels.intensity(video.intensity),
        category: 'intensity',
      });
    }
    for (const value of video.training_type || []) {
      tags.push({ key: `type:${value}`, label: labels.trainingType(value), category: 'type' });
    }
    for (const value of video.body_parts || []) {
      tags.push({ key: `body:${value}`, label: labels.bodyPart(value), category: 'body' });
    }
    for (const value of video.equipment || []) {
      tags.push({ key: `eq:${value}`, label: labels.equipment(value), category: 'gear' });
    }

    return tags;
  };
}

/** Seconds to the m:ss shown on a thumbnail's duration badge. */
export function formatDuration(seconds?: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** Filenames are shown without their extension everywhere in the redesign. */
export function stripVideoExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '');
}
