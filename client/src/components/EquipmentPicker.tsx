import { EQUIPMENT_ITEMS, EquipmentId } from '../lib/equipment';
import { useMetaLabels } from '../lib/labels';

type Props = {
  selected: string[];
  onChange: (selected: string[]) => void;
};

export default function EquipmentPicker({ selected, onChange }: Props) {
  const labels = useMetaLabels();

  const toggle = (id: EquipmentId) => {
    if (selected.includes(id)) {
      onChange(selected.filter(item => item !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {EQUIPMENT_ITEMS.map(item => {
        const isSelected = selected.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            title={labels.equipment(item.id)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '10px 12px',
              minWidth: 72,
              borderRadius: 10,
              border: isSelected ? '2px solid var(--accent-color)' : '1px solid var(--glass-border)',
              background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--surface-hover)',
              color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
              cursor: 'pointer',
              transition: 'border-color 140ms, background 140ms',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.icon}
            </span>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>
              {labels.equipment(item.id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
