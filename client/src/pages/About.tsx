import { useTranslation } from 'react-i18next';
import '../styles/About.css';

export default function About() {
  const { t } = useTranslation();

  return (
    <div className="about-container">
      <div className="about-card">
        <h1>WorkoutPlanner</h1>
        
        <div className="about-section">
          <h2>{t('about.version')}</h2>
          <p>1.0.0</p>
        </div>

        <div className="about-section">
          <h2>{t('about.created_by')}</h2>
          <p>
            <strong>Klaudia Krzos</strong>
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
          </p>
        </div>

        <div className="about-section">
          <h2>{t('about.company')}</h2>
          <p>Big Deck IT LTD</p>
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
          </p>
          <p className="about-commercial">
            {t('about.commercial_inquiry')} 
            <a href="mailto:hello@bigdeckit.com" className="about-link">
              hello@bigdeckit.com
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

        <div className="about-footer">
          <p>&copy; 2026 Klaudia Krzos, Big Deck IT LTD. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
