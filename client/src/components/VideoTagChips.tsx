import { useState } from 'react';
import type { ReactNode } from 'react';
import { EquipmentIcon } from '../lib/equipment';
import { BodyPartIcon, IntensityIcon, TrainingTypeIcon } from '../lib/metadata';
import { useMetaLabels } from '../lib/labels';

interface Props {
  intensity?: string;
  trainingType?: string[];
  bodyParts?: string[];
  equipment?: string[];
  /** Chips shown before the rest collapse into a "+N" chip. */
  max?: number;
  /** Extra class on the wrapper, for placement (e.g. over a thumbnail). */
  className?: string;
}

/**
 * Compact metadata chips for a single video.
 *
 * Shared by the calendar's day previews and the plan details modal, which
 * receive the same tags under different field names, so the tags are passed in
 * one by one rather than as a whole video object.
 *
 * Ordered by how much it tells you at a glance — intensity, what kind of
 * training, which body parts, what you need — and capped, since a fully tagged
 * video would otherwise bury the card it sits on.
 */
export default function VideoTagChips({
  intensity,
  trainingType,
  bodyParts,
  equipment,
  max = 4,
  className,
}: Props) {
  const labels = useMetaLabels();
  // Collapsed by default: the chips annotate a preview rather than being the
  // point of it, but the overflow has to be reachable — a "+2" you can't open
  // is just a count of things you're not allowed to see.
  const [expanded, setExpanded] = useState(false);

  const chips: { key: string; icon: ReactNode; label: string }[] = [];
  if (intensity) {
    chips.push({
      key: `intensity:${intensity}`,
      icon: <IntensityIcon level={intensity} />,
      label: labels.intensity(intensity),
    });
  }
  for (const type of trainingType || []) {
    chips.push({ key: `type:${type}`, icon: <TrainingTypeIcon type={type} />, label: labels.trainingType(type) });
  }
  for (const part of bodyParts || []) {
    chips.push({ key: `part:${part}`, icon: <BodyPartIcon part={part} />, label: labels.bodyPart(part) });
  }
  for (const eq of equipment || []) {
    chips.push({ key: `equipment:${eq}`, icon: <EquipmentIcon id={eq} size={13} />, label: labels.equipment(eq) });
  }

  if (chips.length === 0) return null;

  const visible = expanded ? chips : chips.slice(0, max);
  const hiddenCount = chips.length - visible.length;

  // These chips sit inside cards that have their own click handlers (a plan card
  // opens its details), so expanding must not also trigger the card.
  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(open => !open);
  };

  return (
    <div className={`video-tag-chips${className ? ` ${className}` : ''}`}>
      {visible.map(chip => (
        <span key={chip.key} className="video-tag-chip" title={chip.label}>
          <span className="video-tag-chip-icon">{chip.icon}</span>
          {chip.label}
        </span>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="video-tag-chip video-tag-chip-more"
          title={chips.slice(max).map(chip => chip.label).join(', ')}
          onClick={toggle}
        >
          +{hiddenCount}
        </button>
      )}
      {expanded && chips.length > max && (
        <button
          type="button"
          className="video-tag-chip video-tag-chip-more"
          onClick={toggle}
        >
          {'\u2212'}
        </button>
      )}
    </div>
  );
}
