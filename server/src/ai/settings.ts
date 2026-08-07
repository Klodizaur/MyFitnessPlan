/**
 * Storage for the optional AI integration's configuration.
 *
 * Everything lives in the existing `settings` key/value table under an `ai_`
 * prefix, so enabling the feature adds no schema and removing the feature is a
 * matter of deleting these rows. The generic `/api/settings` endpoint filters
 * the prefix out (see server/src/index.ts) so the key can never reach the
 * client through it.
 */
import db from '../db.js';

/** Every settings key this module owns. Used to hide them from /api/settings. */
export const AI_SETTINGS_PREFIX = 'ai_';

/**
 * Which wire format to speak.
 *
 * 'anthropic' is the Claude Messages API. 'openai' is the OpenAI-compatible
 * `/v1/chat/completions` shape, which covers OpenAI itself, OpenRouter, and —
 * the reason it's here — local runtimes like Ollama and LM Studio, where
 * nothing leaves the machine and the app's privacy promise stays intact.
 */
export type AiProvider = 'anthropic' | 'openai';

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
};

/**
 * Only Anthropic gets a default model: it's the provider this was written
 * against. For OpenAI-compatible endpoints the model name depends entirely on
 * who is serving them (`gpt-…`, `llama3.1`, an OpenRouter slug), so the user
 * types it rather than having a wrong guess pre-filled.
 */
const DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-opus-5',
  openai: '',
};

const readStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const writeStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function read(key: string): string {
  const row = readStmt.get(`${AI_SETTINGS_PREFIX}${key}`) as { value?: string } | undefined;
  return (row?.value ?? '').trim();
}

/** Named so the (key, value) order can't be flipped at the call site. */
function write(key: string, value: string): void {
  writeStmt.run(`${AI_SETTINGS_PREFIX}${key}`, value);
}

export function getAiSettings(): AiSettings {
  const provider: AiProvider = read('provider') === 'openai' ? 'openai' : 'anthropic';
  return {
    provider,
    apiKey: read('api_key'),
    baseUrl: read('base_url') || DEFAULT_BASE_URL[provider],
    model: read('model') || DEFAULT_MODEL[provider],
  };
}

export function saveAiSettings(patch: {
  provider?: AiProvider;
  /** `null` clears the stored key; `undefined` leaves it untouched. */
  apiKey?: string | null;
  baseUrl?: string;
  model?: string;
}): void {
  if (patch.provider !== undefined) {
    write('provider', patch.provider === 'openai' ? 'openai' : 'anthropic');
  }
  if (patch.apiKey !== undefined) {
    write('api_key', patch.apiKey === null ? '' : patch.apiKey.trim());
  }
  if (patch.baseUrl !== undefined) {
    write('base_url', patch.baseUrl.trim().replace(/\/+$/, ''));
  }
  if (patch.model !== undefined) {
    write('model', patch.model.trim());
  }
}

/** A base URL pointing at this machine — Ollama, LM Studio, and friends. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  } catch {
    return false;
  }
}

/**
 * Whether the feature should show up in the UI at all.
 *
 * A key is the normal gate, but local runtimes don't use one — requiring a
 * dummy key there would be a papercut for exactly the users most likely to
 * want this.
 */
export function isAiConfigured(settings: AiSettings = getAiSettings()): boolean {
  if (!settings.model) return false;
  return Boolean(settings.apiKey) || isLocalBaseUrl(settings.baseUrl);
}
