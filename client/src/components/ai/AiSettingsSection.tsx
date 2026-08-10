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

/** '' keeps whatever language each description was already written in. */
type DescriptionLanguage = '' | 'en' | 'pl';

interface AiConfig {
  provider: Provider;
  baseUrl: string;
  model: string;
  descriptionLanguage: DescriptionLanguage;
  hasKey: boolean;
  isLocal: boolean;
  available: boolean;
}

interface ModelChoice {
  id: string;
  label: string;
}

/** Sentinel option that reveals the free-text field. */
const CUSTOM_MODEL = '__custom__';

/**
 * Where an OpenAI-compatible endpoint usually lives.
 *
 * Each is the origin only — the request path (`/v1/chat/completions`) is added
 * server-side — which is the part people most often get wrong when typing it
 * by hand, along with the local port numbers.
 */
const OPENAI_PRESETS = [
  { name: 'OpenAI', url: 'https://api.openai.com' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api' },
  { name: 'Ollama', url: 'http://localhost:11434' },
  { name: 'LM Studio', url: 'http://localhost:1234' },
];

export default function AiSettingsSection() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState<DescriptionLanguage>('');
  const [status, setStatus] = useState('');
  const [statusOk, setStatusOk] = useState(true);
  const [testing, setTesting] = useState(false);

  // Models the configured endpoint reports. Empty means either no key yet or an
  // endpoint that doesn't list them, and the model becomes a text field.
  const [models, setModels] = useState<ModelChoice[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [typingModel, setTypingModel] = useState(false);
  // The Anthropic base URL only matters behind a proxy, so it stays out of the
  // way until asked for.
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = () => {
    fetch('/api/ai/settings')
      .then(r => r.json())
      .then((data: AiConfig) => {
        setConfig(data);
        setProvider(data.provider);
        setBaseUrl(data.baseUrl);
        setModel(data.model);
        setLanguage(data.descriptionLanguage || '');
        if (data.hasKey || data.isLocal) loadModels();
      })
      .catch(() => setConfig(null));
  };

  useEffect(load, []);

  /**
   * Ask the endpoint what it serves. Failures are silent — an endpoint with no
   * model listing is normal, and the text field covers it.
   */
  const loadModels = () => {
    setLoadingModels(true);
    fetch('/api/ai/models')
      .then(r => (r.ok ? r.json() : { models: [] }))
      .then(data => setModels(Array.isArray(data?.models) ? data.models : []))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  };

  /**
   * Options to show in the picker.
   *
   * A model the user already saved is kept even when the endpoint doesn't list
   * it — switching away from a working setting just because a listing is
   * incomplete would be worse than dropping it silently. It is flagged so a
   * name that came from a typo is recognisable rather than looking official,
   * and selecting the empty option clears it.
   */
  const modelOptions: (ModelChoice & { unlisted?: boolean })[] =
    !model || models.some(m => m.id === model)
      ? models
      : [{ id: model, label: model, unlisted: true }, ...models];

  /**
   * Switching provider swaps in that provider's defaults, but only when the
   * fields are untouched — retyping a custom base URL after a mis-click would
   * be worse than a stale default.
   */
  const handleProvider = (next: Provider) => {
    setProvider(next);
    if (!config || config.provider === next) return;
    // The list belongs to the old endpoint; it is reloaded after the next save.
    setModels([]);
    setTypingModel(false);
    if (baseUrl === config.baseUrl || !baseUrl.trim()) {
      // OpenAI-compatible needs an explicit endpoint — default to OpenAI so a
      // preset is selected and model listing has somewhere to call.
      setBaseUrl(next === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com');
    }
    if (model === config.model) {
      setModel(next === 'anthropic' ? 'claude-opus-5' : '');
    }
  };

  const save = async (patch: Record<string, unknown> = {}) => {
    setStatus('');
    // Without a base URL the OpenAI-compatible path can't list models or send
    // requests to the right host — treat it as required, not optional.
    if (provider === 'openai' && !baseUrl.trim()) {
      setStatusOk(false);
      setStatus(t('ai.base_url_required'));
      return null;
    }
    const res = await fetch('/api/ai/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        baseUrl,
        model,
        descriptionLanguage: language,
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
    // A new key or endpoint means a different set of models.
    if (data?.hasKey || data?.available) loadModels();
    return data;
  };

  const clearKey = async () => {
    const data = await save({ apiKey: null });
    if (!data) return;
    setStatusOk(true);
    setStatus(t('ai.key_cleared'));
  };

  const test = async () => {
    setTesting(true);
    setStatus('');
    const saved = await save();
    if (!saved) {
      setTesting(false);
      return;
    }
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
    <div className="ai-settings" style={{ marginBottom: '2rem' }}>
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
        {/* Only worth showing where it means something. On Anthropic the URL
            is always the same and the field is just a way to break things, so
            it hides behind a disclosure for the proxy case. On an
            OpenAI-compatible endpoint the URL *is* the choice of service, so it
            leads, with the common ones one click away. */}
        {provider === 'anthropic' ? (
          <div>
            {showAdvanced ? (
              <>
                <label className="wb-label">{t('ai.base_url_label')}</label>
                <input
                  className="wb-input"
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  placeholder="https://api.anthropic.com"
                  spellCheck={false}
                />
                <p className="ai-hint" style={{ marginTop: 6 }}>{t('ai.base_url_proxy_hint')}</p>
              </>
            ) : (
              <button type="button" className="ai-link-btn" onClick={() => setShowAdvanced(true)}>
                {t('ai.base_url_advanced')}
              </button>
            )}
          </div>
        ) : (
          <div>
            <label className="wb-label">
              {t('ai.base_url_label')}
              <span className="ai-required" aria-hidden="true"> *</span>
            </label>
            <div className="wb-chip-row" style={{ marginBottom: 8 }}>
              {OPENAI_PRESETS.map(preset => (
                <button
                  type="button"
                  key={preset.url}
                  className={`wb-chip${baseUrl === preset.url ? ' selected' : ''}`}
                  onClick={() => setBaseUrl(preset.url)}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            <input
              className="wb-input"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
              spellCheck={false}
              required
              aria-required="true"
            />
            <p className="ai-hint" style={{ marginTop: 6 }}>{t('ai.base_url_openai_hint')}</p>
          </div>
        )}

        {/* The key comes before the model on purpose: the model list is fetched
            using it, so asking for a model first is asking for something that
            cannot be answered yet. */}
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

        <div>
          <label className="wb-label">{t('ai.model_label')}</label>

          {/* Model ids are exact and case-sensitive, so pick from the list the
              endpoint reports rather than typing one. The text field stays
              available for endpoints that don't publish a list. */}
          {modelOptions.length > 0 && !typingModel ? (
            <>
              <select
                className="wb-input"
                value={model}
                onChange={e => {
                  if (e.target.value === CUSTOM_MODEL) {
                    setTypingModel(true);
                    return;
                  }
                  setModel(e.target.value);
                }}
              >
                {/* Always selectable, so picking it is how a model — including
                    a stale hand-typed one — gets cleared. */}
                <option value="">{t('ai.model_choose')}</option>
                {modelOptions.map(choice => (
                  <option key={choice.id} value={choice.id}>
                    {choice.unlisted
                      ? `${choice.id} — ${t('ai.model_unlisted')}`
                      : choice.label === choice.id
                        ? choice.id
                        : `${choice.label} (${choice.id})`}
                  </option>
                ))}
                <option value={CUSTOM_MODEL}>{t('ai.model_custom')}</option>
              </select>
              <p className="ai-hint" style={{ marginTop: 6 }}>
                {loadingModels ? t('ai.model_loading') : t('ai.model_from_provider')}
              </p>
            </>
          ) : (
            <>
              <input
                className="wb-input"
                value={model}
                onChange={e => setModel(e.target.value)}
                // Provider-specific: showing a Claude model name to someone on
                // OpenAI reads as a hardcoded value they can't change, not as
                // an example of what to type.
                placeholder={provider === 'anthropic' ? 'claude-opus-5' : t('ai.model_placeholder')}
                spellCheck={false}
              />
              <p className="ai-hint" style={{ marginTop: 6 }}>
                {loadingModels
                  ? t('ai.model_loading')
                  : modelOptions.length > 0
                    ? t('ai.model_typing')
                    : t('ai.model_hint')}
              </p>
              {/* Without this the hint asks for a save that lives in another
                  part of the panel, so the list never appears for someone who
                  has just pasted a key. */}
              {modelOptions.length === 0 && !loadingModels && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => save()}
                  disabled={
                    (provider === 'openai' && !baseUrl.trim()) ||
                    (!apiKey && !config?.hasKey && !(provider === 'openai' && isLikelyLocalUrl(baseUrl)))
                  }
                >
                  {t('ai.model_load')}
                </button>
              )}
              {modelOptions.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 8 }}
                  onClick={() => setTypingModel(false)}
                >
                  {t('ai.model_back_to_list')}
                </button>
              )}
            </>
          )}
        </div>

        <div>
          <label className="wb-label">{t('ai.language_label')}</label>
          <select
            className="wb-input"
            value={language}
            onChange={e => setLanguage(e.target.value as DescriptionLanguage)}
          >
            <option value="">{t('ai.language_original')}</option>
            <option value="en">English</option>
            <option value="pl">Polski</option>
          </select>
          <p className="ai-hint" style={{ marginTop: 6 }}>
            {language ? t('ai.language_translate_warning') : t('ai.language_hint')}
          </p>
        </div>
      </div>

      <div className="ai-settings-row">
        <button
          className="btn"
          onClick={() => save()}
          disabled={provider === 'openai' && !baseUrl.trim()}
        >
          {t('ai.save')}
        </button>
        <button
          className="btn btn-secondary"
          onClick={test}
          disabled={testing || (provider === 'openai' && !baseUrl.trim())}
        >
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

/** Same idea as the server's local-URL check — used only to enable model load. */
function isLikelyLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
