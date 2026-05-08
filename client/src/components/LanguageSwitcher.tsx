import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const nextLang = i18n.language.startsWith('en') ? 'pl' : 'en';
    i18n.changeLanguage(nextLang);
  };

  const currentLang = i18n.language.startsWith('en') ? 'EN' : 'PL';
  const flag = i18n.language.startsWith('en') ? '🇬🇧' : '🇵🇱';

  return (
    <button 
      onClick={toggleLanguage}
      className="language-switcher glass-card"
      title={i18n.language.startsWith('en') ? 'Zmień na polski' : 'Switch to English'}
    >
      <span className="flag">{flag}</span>
      <span className="lang-code">{currentLang}</span>
    </button>
  );
};

export default LanguageSwitcher;
