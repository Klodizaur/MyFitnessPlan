import { useTranslation } from 'react-i18next';

/**
 * EN / PL, for the screens shown before the app (welcome, "Who's training?"),
 * where the header's own switch isn't there yet. The choice is remembered on
 * this device, like the header's.
 */
export default function LanguageToggle() {
  const { i18n } = useTranslation();
  const isEnglish = i18n.language.startsWith('en');
  return (
    <button
      type="button"
      className="rx-lang pf-lang"
      onClick={() => i18n.changeLanguage(isEnglish ? 'pl' : 'en')}
      title={isEnglish ? 'Zmień na polski' : 'Switch to English'}
    >
      {isEnglish ? 'EN' : 'PL'}
    </button>
  );
}
