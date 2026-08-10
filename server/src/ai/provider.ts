/**
 * One request to whichever model provider the user configured.
 *
 * Deliberately raw HTTP rather than a vendor SDK: this app is self-hosted and
 * the user brings their own endpoint, which may be Anthropic, an
 * OpenAI-compatible service, or a local Ollama/LM Studio install. A single
 * fetch keeps all of those on one code path and adds no dependencies.
 */
import { AiSettings, getAiSettings, isAiConfigured, isLocalBaseUrl } from './settings.js';

/** An error with a message that is safe and useful to show the user. */
export class AiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/**
 * Generous: a plan for a large library is a big reply, and reasoning models
 * spend part of the same budget thinking before they answer.
 */
const MAX_COMPLETION_TOKENS = 16000;

/** Long enough for a slow local model, short enough to fail rather than hang. */
const TIMEOUT_MS = 180_000;

/** Listing models is a cheap call; don't make the settings screen wait on it. */
const LIST_TIMEOUT_MS = 15_000;

export interface ModelChoice {
  id: string;
  label: string;
}

/**
 * Ask the configured endpoint which models it serves.
 *
 * Model ids are exact and case-sensitive, so letting the user type one is a
 * typo trap — and a hardcoded list would be wrong the week after the next
 * release. Anthropic, OpenAI, OpenRouter and Ollama all answer `GET /v1/models`
 * in near enough the same shape, so the list comes from whatever the user
 * actually pointed at.
 *
 * Returns an empty list rather than throwing when the endpoint doesn't offer
 * one: some gateways don't implement it, and that should degrade to typing the
 * name by hand rather than blocking the feature.
 */
export async function listModels(): Promise<ModelChoice[]> {
  const settings = getAiSettings();
  if (!settings.apiKey && !isLocalBaseUrl(settings.baseUrl)) {
    throw new AiError('Add an API key first.', 'not_configured');
  }

  const headers: Record<string, string> = {};
  if (settings.provider === 'anthropic') {
    headers['x-api-key'] = settings.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (settings.apiKey) {
    headers.authorization = `Bearer ${settings.apiKey}`;
  }

  let res: Response;
  try {
    res = await fetch(`${settings.baseUrl}/v1/models`, {
      headers,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch {
    throw new AiError(`Could not reach ${settings.baseUrl}.`, 'unreachable');
  }

  // 401/403 is worth reporting — the key is wrong, and the user needs to know
  // that now rather than at generate time. Anything else just means this
  // endpoint has no model list, which is not an error worth surfacing.
  if (res.status === 401 || res.status === 403) {
    throw new AiError(await describeHttpError(res), 'auth');
  }
  if (!res.ok) return [];

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    return [];
  }

  const entries = Array.isArray(payload?.data) ? payload.data : [];
  return entries
    .map((entry: any) => ({
      id: typeof entry?.id === 'string' ? entry.id : '',
      // Anthropic returns a human-readable name; elsewhere the id is the name.
      label: typeof entry?.display_name === 'string' ? entry.display_name : '',
    }))
    .filter((choice: ModelChoice) => choice.id.length > 0)
    .map((choice: ModelChoice) => ({ id: choice.id, label: choice.label || choice.id }));
}

export interface ModelRequest {
  system: string;
  user: string;
}

export async function callModel({ system, user }: ModelRequest): Promise<string> {
  const settings = getAiSettings();
  if (!isAiConfigured(settings)) {
    throw new AiError('AI is not configured.', 'not_configured');
  }

  const { url, headers, body } =
    settings.provider === 'anthropic'
      ? anthropicRequest(settings, system, user)
      : openAiRequest(settings, system, user);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? `The model did not respond within ${Math.round(TIMEOUT_MS / 1000)}s.`
      : `Could not reach ${url}.`;
    throw new AiError(reason, 'unreachable');
  }

  if (!res.ok) {
    throw new AiError(await describeHttpError(res), httpErrorCode(res.status));
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    throw new AiError('The provider returned a response that was not JSON.', 'bad_response');
  }

  const text = settings.provider === 'anthropic'
    ? extractAnthropicText(payload)
    : extractOpenAiText(payload);

  if (!text) {
    throw new AiError('The model returned an empty response.', 'empty_response');
  }
  return text;
}

/** Claude Messages API. */
function anthropicRequest(settings: AiSettings, system: string, user: string) {
  return {
    url: `${settings.baseUrl}/v1/messages`,
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    } as Record<string, string>,
    // Kept to the fields every Claude model accepts. Sampling parameters and
    // thinking budgets are rejected outright by the current models, and
    // `effort` errors on older ones — since the model name is whatever the
    // user typed, the portable request is the minimal one.
    body: {
      model: settings.model,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      system,
      messages: [{ role: 'user', content: user }],
    },
  };
}

/** OpenAI-compatible /v1/chat/completions — also Ollama, LM Studio, OpenRouter. */
function openAiRequest(settings: AiSettings, system: string, user: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Local runtimes accept (and ignore) a missing key; sending an empty Bearer
  // header upsets some of them, so omit it entirely.
  if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;

  return {
    url: `${settings.baseUrl}/v1/chat/completions`,
    headers,
    body: {
      model: settings.model,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
  };
}

function extractAnthropicText(payload: any): string {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  return blocks
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('')
    .trim();
}

function extractOpenAiText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  // Some gateways return the multi-part content array shape.
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit';
  return status >= 500 ? 'provider_error' : 'bad_request';
}

/**
 * Turn a failed response into something actionable. The provider's own message
 * is usually the most useful part ("model not found", "credit balance too
 * low"), so it is surfaced rather than swallowed.
 */
async function describeHttpError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body: any = await res.json();
    detail = body?.error?.message || body?.message || body?.error || '';
  } catch {
    // Non-JSON error body; the status alone will have to do.
  }
  if (typeof detail !== 'string') detail = '';

  switch (res.status) {
    case 401:
    case 403:
      return detail || 'The API key was rejected.';
    case 404:
      return detail || 'The endpoint or model was not found. Check the base URL and model name.';
    case 429:
      return detail || 'Rate limited by the provider. Try again shortly.';
    default:
      return detail || `The provider returned HTTP ${res.status}.`;
  }
}
