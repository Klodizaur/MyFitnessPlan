import { useTranslation } from 'react-i18next';
import '../styles/About.css';

export default function About() {
  const { t } = useTranslation();

  return (
    <div className="about-container">
      <div className="about-card">
        <h1>MyFitnessPlan</h1>
        
        <div className="about-section">
          <h2>{t('about.version')}</h2>
          <p>1.0.0</p>
        </div>

        <div className="about-section">
          <h2>{t('about.created_by')}</h2>
          <p>
            <strong>Klaudia</strong>
            <br />
            <a 
              href="https://www.linkedin.com/in/klaudiacreativestuff/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="about-link"
            >
              {t('about.linkedin')}
            </a>
            <br />
            <a 
              href="https://github.com/Klodizaur" 
              target="_blank" 
              rel="noopener noreferrer"
              className="about-link"
            >
              {t('about.github')}
            </a>
            <br />
            <em>{t('about.role')}</em>
            <br />
            <strong>Big Deck IT LTD</strong>
          </p>
        </div>

        <div className="about-section">
          <h2>{t('about.description')}</h2>
          <p>
            {t('about.description_text')}
          </p>
        </div>

        <div className="about-section">
          <h2>{t('about.license')}</h2>
          <p>{t('about.license_text')}</p>
          <p className="about-highlight">
            {t('about.non_commercial')}
            <a
              href="https://github.com/Klodizaur/MyFitnessPlan"
              target="_blank"
              rel="noopener noreferrer"
              className="about-link"
            >
            {t('about.contribute')}            
            </a>
          </p>


        </div>

        <div className="about-section">
          <h2>{t('about.features')}</h2>
          <ul className="about-features">
            <li>{t('about.feature_custom_patterns')}</li>
            <li>{t('about.feature_local_videos')}</li>
            <li>{t('about.feature_csv_import')}</li>
            <li>{t('about.feature_themes')}</li>
            <li>{t('about.feature_privacy')}</li>
          </ul>
        </div>

      </div>
    </div>
  );
}
