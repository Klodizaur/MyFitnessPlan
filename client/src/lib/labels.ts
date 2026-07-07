import { useTranslation } from 'react-i18next';
import { getEquipmentItem } from './equipment';
import { prettyLabel } from './metadata';

/**
 * Translated, human-readable labels for the canonical metadata values
 * (equipment ids, training types, body parts, intensities).
 *
 * Values are stored canonically (e.g. 'dumbbells', 'HIIT', 'full_body', 'low').
 * Each label falls back to the existing English rendering when a translation
 * key is missing, so only the non-English locales need `metadata.*` entries.
 *
 * Uses useTranslation() so labels re-render when the language changes.
 */
export function useMetaLabels() {
  const { t } = useTranslation();
  return {
    equipment: (id: string) =>
      t(`metadata.equipment.${id}`, { defaultValue: getEquipmentItem(id)?.label ?? id }),
    trainingType: (value: string) =>
      t(`metadata.training_type.${value}`, { defaultValue: value }),
    bodyPart: (value: string) =>
      t(`metadata.body_part.${value}`, { defaultValue: prettyLabel(value) }),
    intensity: (value: string) =>
      t(`metadata.intensity.${value}`, { defaultValue: prettyLabel(value) }),
    // Section headings shown above the metadata groups (e.g. in the player).
    sections: {
      equipment: t('metadata.sections.equipment', { defaultValue: 'Equipment' }),
      trainingType: t('metadata.sections.training_type', { defaultValue: 'Training Type' }),
      bodyParts: t('metadata.sections.body_parts', { defaultValue: 'Body Parts' }),
      intensity: t('metadata.sections.intensity', { defaultValue: 'Intensity' }),
    },
    noDescription: t('metadata.no_description', { defaultValue: 'No description.' }),
  };
}
