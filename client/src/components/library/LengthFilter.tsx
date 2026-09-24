import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EMPTY_LENGTH, LengthRange } from '../../lib/filters';

/** Quick windows, in minutes. Overlap at the edges on purpose: "15" is in both. */
const PRESETS: { key: string; range: LengthRange }[] = [
  { key: 'under15', range: { min: null, max: 15 } },
  { key: '15to30', range: { min: 15, max: 30 } },
  { key: '30to45', range: { min: 30, max: 45 } },
  { key: '45to60', range: { min: 45, max: 60 } },
  { key: 'over60', range: { min: 60, max: null } },
];

const sameRange = (a: LengthRange, b: LengthRange) => a.min === b.min && a.max === b.max;

/** "15–30 min", "Up to 20 min", "From 45 min" — for the active-filter chip. */
export function useLengthLabel() {
  const { t } = useTranslation();
  return (range: LengthRange): string => {
    if (range.min !== null && range.max !== null) return t('library.length_between', { min: range.min, max: range.max });
    if (range.max !== null) return t('library.length_up_to', { max: range.max });
    return t('library.length_from', { min: range.min });
  };
}

const parse = (raw: string): number | null => {
  if (raw.trim() === '') return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 999) : null;
};

/**
 * Length filter body: a from / up-to pair and a few quick windows.
 *
 * The quick windows are chips like the tag filters', but neutral — length isn't
 * a tag category, so it borrows the selected treatment (solid ink and a check)
 * without any category colour.
 */
export default function LengthFilter({ value, onChange }: { value: LengthRange; onChange: (next: LengthRange) => void }) {
  const { t } = useTranslation();

  const setEnd = (end: 'min' | 'max', raw: string) => {
    const next = { ...value, [end]: parse(raw) };
    // A window that ends before it starts can't match anything: drag the other end along.
    if (next.min !== null && next.max !== null && next.min > next.max) {
      if (end === 'min') next.max = next.min;
      else next.min = next.max;
    }
    onChange(next);
  };

  return (
    <div className="len">
      <div className="len-inputs">
        <label className="len-field">
          <span>{t('library.length_from_label')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={value.min ?? ''}
            placeholder={t('library.length_any')}
            onChange={e => setEnd('min', e.target.value)}
          />
          <em>{t('library.length_unit')}</em>
        </label>
        <span className="len-dash" aria-hidden="true">–</span>
        <label className="len-field">
          <span>{t('library.length_up_to_label')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={value.max ?? ''}
            placeholder={t('library.length_any')}
            onChange={e => setEnd('max', e.target.value)}
          />
          <em>{t('library.length_unit')}</em>
        </label>
      </div>
      <div className="lib-chips">
        {PRESETS.map(preset => {
          const on = sameRange(value, preset.range);
          return (
            <button
              key={preset.key}
              type="button"
              className={`len-chip${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(on ? EMPTY_LENGTH : preset.range)}
            >
              {on && <Check size={13} />}
              {t(`library.length_${preset.key}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
