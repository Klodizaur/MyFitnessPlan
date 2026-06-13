import React from 'react';

export type EquipmentId =
  | 'dumbbells'
  | 'mat'
  | 'gym_ball'
  | 'resistance_bands'
  | 'pilates_ball'
  | 'pilates_bar'
  | 'kettlebell';

export type EquipmentItem = {
  id: EquipmentId;
  label: string;
  icon: React.ReactNode;
};

const iconProps = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export const EQUIPMENT_ITEMS: EquipmentItem[] = [
  {
    id: 'dumbbells',
    label: 'Dumbbells',
    icon: (
      <svg {...iconProps}>
        <rect x="2" y="9" width="3" height="6" rx="1" />
        <rect x="19" y="9" width="3" height="6" rx="1" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
  },
  {
    id: 'mat',
    label: 'Mat',
    icon: (
      <svg {...iconProps}>
        <rect x="4" y="8" width="16" height="8" rx="2" />
        <path d="M7 11h10M7 13h10" />
      </svg>
    ),
  },
  {
    id: 'gym_ball',
    label: 'Gym Ball',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8" />
        <ellipse cx="12" cy="12" rx="8" ry="3" />
        <path d="M12 4v16" />
      </svg>
    ),
  },
  {
    id: 'resistance_bands',
    label: 'Resistance Bands',
    icon: (
      <svg {...iconProps}>
        <path d="M4 8c4 0 4 8 8 8s4-8 8-8" />
        <path d="M4 16c4 0 4-8 8-8s4 8 8 8" />
      </svg>
    ),
  },
  {
    id: 'pilates_ball',
    label: 'Pilates Ball',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="13" r="5" />
        <path d="M9 8l6-2M15 18l-2 2" />
      </svg>
    ),
  },
  {
    id: 'pilates_bar',
    label: 'Pilates Bar',
    icon: (
      <svg {...iconProps}>
        <line x1="3" y1="12" x2="21" y2="12" />
        <rect x="1" y="10" width="3" height="4" rx="0.5" />
        <rect x="20" y="10" width="3" height="4" rx="0.5" />
      </svg>
    ),
  },
  {
    id: 'kettlebell',
    label: 'Kettlebell',
    icon: (
      <svg {...iconProps}>
        <path d="M12 3a3 3 0 0 1 3 3v1" />
        <path d="M9 7h6" />
        <path d="M8 10c-2 1-3 3-3 5.5a7 7 0 0 0 14 0C19 13 18 11 16 10" />
      </svg>
    ),
  },
];

const equipmentMap = new Map(EQUIPMENT_ITEMS.map(item => [item.id, item]));

export function getEquipmentItem(id: string): EquipmentItem | undefined {
  return equipmentMap.get(id as EquipmentId);
}

export function EquipmentIcon({ id, size = 18 }: { id: string; size?: number }) {
  const item = getEquipmentItem(id);
  if (!item) return null;
  return (
    <span
      title={item.label}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size }}
    >
      {item.icon}
    </span>
  );
}
