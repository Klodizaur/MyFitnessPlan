import React from 'react';
import {
  BoltIcon,
  HeartIcon,
  FireIcon,
  SparklesIcon,
  ArrowsRightLeftIcon,
  UserIcon,
  TrophyIcon,
  SunIcon,
  MoonIcon,
  ArrowsPointingOutIcon,
  ArrowUpIcon,
  NoSymbolIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

export const TRAINING_TYPES = [
  'HIIT',
  'Cardio',
  'Strength',
  'Mobility',
  'Yoga',
  'Pilates',
  'Functional Strength Training',
  'Warmup',
  'Cooldown',
  'Stretching',
  'Standing',
  'No Jumping',
  'Period-Friendly',
] as const;
export const BODY_PARTS = ['full_body','upper_body','lower_body','core','back','legs','arms','shoulders','glutes','chest'] as const;
export const INTENSITIES = ['low','medium','high'] as const;

export function TrainingTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'HIIT':
      return <BoltIcon style={{ width: 18, height: 18 }} />;
    case 'Cardio':
      return <HeartIcon style={{ width: 18, height: 18 }} />;
    case 'Strength':
      return <SparklesIcon style={{ width: 18, height: 18 }} />;
    case 'Mobility':
      return <ArrowsRightLeftIcon style={{ width: 18, height: 18 }} />;
    case 'Yoga':
      return <UserIcon style={{ width: 18, height: 18 }} />;
    case 'Pilates':
      return <FireIcon style={{ width: 18, height: 18 }} />;
    case 'Functional Strength Training':
      return <TrophyIcon style={{ width: 18, height: 18 }} />;
    case 'Warmup':
      return <SunIcon style={{ width: 18, height: 18 }} />;
    case 'Cooldown':
      return <MoonIcon style={{ width: 18, height: 18 }} />;
    case 'Stretching':
      return <ArrowsPointingOutIcon style={{ width: 18, height: 18 }} />;
    case 'Standing':
      return <ArrowUpIcon style={{ width: 18, height: 18 }} />;
    case 'No Jumping':
      return <NoSymbolIcon style={{ width: 18, height: 18 }} />;
    case 'Period-Friendly':
      return <ShieldCheckIcon style={{ width: 18, height: 18 }} />;
    default:
      return null;
  }
}

/**
 * Body-part icons, drawn as one system rather than ten unrelated pictures.
 *
 * Every icon is the same figure: the whole body as a faint outline, with the
 * part the tag names drawn solid on top. That makes the set read as a family,
 * keeps "back" tellable from "chest" (which no pile of borrowed glyphs
 * manages), and makes a new body part a highlight to draw rather than an icon
 * to go hunting for.
 *
 * Everything here is sized for how small these actually render — 18px in the
 * filter chips, 13px on a tag. That rules out a delicate stick figure: the
 * body fills the box corner to corner, strokes are heavy, and highlights are
 * **filled** rather than stroked, because a 1.5px-wide band is a smudge at
 * this size while a solid block still reads. The outline is faint enough to
 * stay background but not so faint it disappears against a chip.
 */
const FIGURE_STROKE = 2;
const GHOST_OPACITY = 0.42;

const BODY_FIGURE = (
  <g
    fill="none"
    stroke="currentColor"
    strokeWidth={FIGURE_STROKE}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="4.4" r="2.6" />
    <path d="M8.4 9.4h7.2" />
    <path d="M8.4 9.4 5.6 15.4M15.6 9.4 18.4 15.4" />
    <path d="M8.4 9.4v6.2h7.2V9.4" />
    <path d="M10.1 15.6 9.2 22M13.9 15.6 14.8 22" />
  </g>
);

/** Heavy stroke for limbs, which have no area to fill. */
const limb = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** The highlighted region for each body part, drawn over the faint figure. */
const BODY_HIGHLIGHTS: Record<string, React.ReactNode> = {
  upper_body: (
    <>
      <circle cx="12" cy="4.4" r="2.6" fill="currentColor" />
      <rect x="8.4" y="9.4" width="7.2" height="6.2" rx="1.6" fill="currentColor" />
      <path d="M8.4 9.4 5.6 15.4M15.6 9.4 18.4 15.4" {...limb} />
    </>
  ),
  lower_body: (
    <>
      <rect x="8.4" y="13" width="7.2" height="2.6" rx="1.2" fill="currentColor" />
      <path d="M10.1 15.6 9.2 22M13.9 15.6 14.8 22" {...limb} />
    </>
  ),
  chest: <rect x="8.4" y="9.4" width="7.2" height="3.2" rx="1.4" fill="currentColor" />,
  core: <rect x="8.4" y="12.2" width="7.2" height="3.4" rx="1.4" fill="currentColor" />,
  glutes: <path d="M8.4 13.4h7.2v0.6a2 2 0 0 1-2 2h-3.2a2 2 0 0 1-2-2z" fill="currentColor" />,
  // A spine with ribs, so it reads as the back rather than as the chest.
  back: (
    <>
      <rect x="11" y="9.4" width="2" height="6.2" rx="1" fill="currentColor" />
      <rect x="8.8" y="10.8" width="6.4" height="1.4" rx="0.7" fill="currentColor" />
      <rect x="8.8" y="13.2" width="6.4" height="1.4" rx="0.7" fill="currentColor" />
    </>
  ),
  legs: <path d="M10.1 15.6 9.2 22M13.9 15.6 14.8 22" {...limb} />,
  arms: <path d="M8.4 9.4 5.6 15.4M15.6 9.4 18.4 15.4" {...limb} />,
  shoulders: (
    <>
      <path d="M8.4 9.4h7.2" {...limb} />
      <circle cx="8.4" cy="9.4" r="2" fill="currentColor" />
      <circle cx="15.6" cy="9.4" r="2" fill="currentColor" />
    </>
  ),
};

export function BodyPartIcon({ part, size = 18 }: { part: string; size?: number }) {
  const highlight = BODY_HIGHLIGHTS[part];

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      {/* 'full_body' — and any value without a highlight — is the whole figure
          at full strength, since there is no one region to pick out. */}
      {highlight ? (
        <>
          <g opacity={GHOST_OPACITY}>{BODY_FIGURE}</g>
          {highlight}
        </>
      ) : (
        BODY_FIGURE
      )}
    </svg>
  );
}

export function IntensityIcon({ level }: { level: string }) {
  // Render 3 vertical bars; fill count depends on level (low=1, medium=2, high=3)
  const count = level === 'high' ? 3 : level === 'medium' ? 2 : level === 'low' ? 1 : 0;
  const bars = [4, 8, 12]; // heights offsets
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {bars.map((h, idx) => {
        const barHeight = 4 + idx * 4; // 4,8,12
        const x = 3 + idx * 6;
        const y = 18 - barHeight;
        const filled = idx < count;
        return (
          <rect key={idx} x={x} y={y} width={4} height={barHeight} rx={1} fill={filled ? 'currentColor' : 'rgba(0,0,0,0.12)'} />
        );
      })}
    </svg>
  );
}

export function prettyLabel(s: string) {
  return s.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}
