/**
 * Settings panel for the optional AI integration.
 *
 * Self-contained: it owns its own load/save against /api/ai/settings rather
 * than joining the Settings page's state, so the page needs one import and one
 * line to host it — and loses one line if the feature is removed.
 *
 * The stored key is never sent back to the client. The field shows whether one
 * exists; typing a new value replaces it, and leaving it blank keeps it.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../styles/AiPlan.css';

type Provider = 'anthropic' | 'openai';

interface AiConfig {
  provider: Provider;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  isLocal: boolean;
  available: boolean;
}

export default function AiSettingsSection() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState(true);
  const [testing, setTesting] = useState(false);

  const load = () => {
    fetch('/api/ai/settings')
      .then(r => r.json())
      .then((data: AiConfig) => {
        setConfig(data);
        setProvider(data.provider);
        setBaseUrl(data.baseUrl);
        setModel(data.model);
      })
      .catch(() => setConfig(null));
  };

  useEffect(load, []);

  /**
   * Switching provider swaps in that provider's defaults, but only when the
   * fields are untouched — retyping a custom base URL after a mis-click would
   * be worse than a stale default.
   */
  const handleProvider = (next: Provider) => {
    setProvider(next);
    if (!config || config.provider === next) return;
    if (baseUrl === config.baseUrl) {
      setBaseUrl(next === 'anthropic' ? 'https://api.anthropic.com' : '');
    }
    if (model === config.model) {
      setModel(next === 'anthropic' ? 'claude-opus-5' : '');
    }
  };

  const save = async (patch: Record<string, unknown> = {}) => {
    setStatus('');
    const res = await fetch('/api/ai/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        baseUrl,
        model,
        // Omitted rather than sent empty, so saving a model change doesn't
        // wipe a key the user never retyped.
        ...(apiKey ? { apiKey } : {}),
        ...patch,
      }),
    });
    const data = await res.json();
    setApiKey('');
    setConfig(prev => (prev ? { ...prev, ...data } : prev));
    setStatusOk(true);
    setStatus(t('ai.settings_saved'));
    return data;
  };

  const clearKey = async () => {
    await save({ apiKey: null });
    setStatusOk(true);
    setStatus(t('ai.key_cleared'));
  };

  const test = async () => {
    setTesting(true);
    setStatus('');
    await save();
    try {
      const res = await fetch('/api/ai/test', { method: 'POST' });
      const data = await res.json();
      setStatusOk(res.ok);
      setStatus(res.ok ? t('ai.test_ok') : data?.error || t('ai.error_generic'));
    } catch {
      setStatusOk(false);
      setStatus(t('ai.error_unreachable'));
    }
    setTesting(false);
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2>{t('ai.settings_title')}</h2>
      <p style={{ marginBottom: '1rem' }}>{t('ai.settings_msg')}</p>

      <div className="ai-settings-row" style={{ marginBottom: '1rem' }}>
        <button
          className={`btn ${provider === 'anthropic' ? '' : 'btn-secondary'}`}
          onClick={() => handleProvider('anthropic')}
        >
          {t('ai.provider_anthropic')}
        </button>
        <button
          className={`btn ${provider === 'openai' ? '' : 'btn-secondary'}`}
          onClick={() => handleProvider('openai')}
        >
          {t('ai.provider_openai')}
        </button>
      </div>

      <div className="ai-settings-grid">
        <div>
          <label className="wb-label">{t('ai.base_url_label')}</label>
          <input
            className="wb-input"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://api.anthropic.com"
            spellCheck={false}
          />
          <p className="ai-hint" style={{ marginTop: 6 }}>{t('ai.base_url_hint')}</p>
        </div>

        <div>
          <label className="wb-label">{t('ai.model_label')}</label>
          <input
            className="wb-input"
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="claude-opus-5"
            spellCheck={false}
          />
        </div>

        <div>
          <label className="wb-label">{t('ai.key_label')}</label>
          <input
            className="wb-input"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={config?.hasKey ? t('ai.key_stored') : t('ai.key_placeholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="ai-hint" style={{ marginTop: 6 }}>{t('ai.key_hint')}</p>
        </div>
      </div>

      <div className="ai-settings-row">
        <button className="btn" onClick={() => save()}>{t('ai.save')}</button>
        <button className="btn btn-secondary" onClick={test} disabled={testing}>
          {testing ? t('ai.testing') : t('ai.test')}
        </button>
        {config?.hasKey && (
          <button className="btn btn-secondary" onClick={clearKey}>{t('ai.clear_key')}</button>
        )}
        <span className="ai-key-state">
          {config?.available ? t('ai.state_ready') : t('ai.state_not_configured')}
        </span>
      </div>

      {status && (
        <p className={`ai-key-state ${statusOk ? 'ai-status-ok' : 'ai-status-bad'}`} style={{ marginTop: 12 }}>
          {status}
        </p>
      )}

      <p className="ai-hint" style={{ marginTop: 12 }}>{t('ai.privacy_note')}</p>
    </div>
  );
}
