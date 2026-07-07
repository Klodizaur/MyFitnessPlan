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

export function BodyPartIcon({ part }: { part: string }) {
  // Use generic user icon for body-related tags; heroicons doesn't have detailed anatomy icons
  return <UserIcon style={{ width: 18, height: 18 }} />;
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
