/**
 * The optional AI integration's HTTP surface.
 *
 * Entirely additive: nothing else in the server calls into it, and every
 * response it produces is a draft the client hands to the existing workout
 * builder. Deleting this file plus server/src/ai/ and the one `register` line
 * in index.ts removes the feature without touching a plan, a video, or the
 * schema.
 */
import { FastifyInstance } from 'fastify';
import { AiError, callModel, listModels } from '../ai/provider.js';
import { generatePlan } from '../ai/planBuilder.js';
import {
  AiProvider,
  getAiSettings,
  isAiConfigured,
  isLocalBaseUrl,
  saveAiSettings,
} from '../ai/settings.js';
import {
  VALID_BODY_PARTS,
  VALID_EQUIPMENT,
  VALID_INTENSITIES,
  VALID_TRAINING_TYPES,
} from './library.js';

/** Keep list inputs to values the library actually uses. */
function whitelist(value: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && allowed.includes(item));
}

function strings(value: unknown, limit = 200): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, limit);
}

export default async function (fastify: FastifyInstance) {
  /**
   * Whether the AI entry points should appear at all. The client checks this
   * before rendering anything, so an install with no key configured looks
   * exactly like an install without the feature.
   */
  fastify.get('/status', async (_request, reply) => {
    return reply.send({ available: isAiConfigured() });
  });

  /**
   * Current configuration for the settings screen. The key itself is never
   * returned — only whether one is stored.
   */
  fastify.get('/settings', async (_request, reply) => {
    const settings = getAiSettings();
    return reply.send({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      hasKey: Boolean(settings.apiKey),
      isLocal: isLocalBaseUrl(settings.baseUrl),
      available: isAiConfigured(settings),
    });
  });

  fastify.post('/settings', async (request, reply) => {
    const body = request.body as any;
    const provider: AiProvider | undefined =
      body?.provider === 'anthropic' || body?.provider === 'openai' ? body.provider : undefined;

    // Three states for the key: a string sets it, null clears it, and an
    // absent field leaves the stored one alone — so saving the model name
    // doesn't require the user to retype their key.
    let apiKey: string | null | undefined;
    if (body?.apiKey === null) apiKey = null;
    else if (typeof body?.apiKey === 'string') apiKey = body.apiKey;

    saveAiSettings({
      provider,
      apiKey,
      baseUrl: typeof body?.baseUrl === 'string' ? body.baseUrl : undefined,
      model: typeof body?.model === 'string' ? body.model : undefined,
    });

    const settings = getAiSettings();
    return reply.send({
      success: true,
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      hasKey: Boolean(settings.apiKey),
      available: isAiConfigured(settings),
    });
  });

  /**
   * Models the configured endpoint serves, so the user picks one instead of
   * typing an exact, case-sensitive id from memory. An empty list is a valid
   * answer — it means this endpoint has no model listing, and the settings
   * screen falls back to a text field.
   */
  fastify.get('/models', async (_request, reply) => {
    try {
      return reply.send({ models: await listModels() });
    } catch (err) {
      return sendAiError(reply, err);
    }
  });

  /** One cheap round trip, so a bad key or model surfaces here and not mid-plan. */
  fastify.post('/test', async (_request, reply) => {
    try {
      const text = await callModel({
        system: 'Reply with the single word OK.',
        user: 'Reply with the single word OK.',
      });
      return reply.send({ success: true, reply: text.slice(0, 200) });
    } catch (err) {
      return sendAiError(reply, err);
    }
  });

  /**
   * Draft a plan. Returns weeks of video ids for the client to load into the
   * workout builder; nothing is saved until the user saves it there.
   */
  fastify.post('/generate-plan', async (request, reply) => {
    const body = request.body as any;

    try {
      const plan = await generatePlan({
        description: typeof body?.description === 'string' ? body.description : '',
        weeks: Number(body?.weeks) || 1,
        daysPerWeek: Number(body?.daysPerWeek) || 3,
        maxMinutes: Number(body?.maxMinutes) || 0,
        equipment: whitelist(body?.equipment, VALID_EQUIPMENT),
        trainingTypes: whitelist(body?.trainingTypes, VALID_TRAINING_TYPES),
        bodyParts: whitelist(body?.bodyParts, VALID_BODY_PARTS),
        intensity:
          typeof body?.intensity === 'string' &&
          (VALID_INTENSITIES as readonly string[]).includes(body.intensity)
            ? body.intensity
            : '',
        includeAlbums: strings(body?.includeAlbums),
        excludeAlbums: strings(body?.excludeAlbums),
      });
      return reply.send(plan);
    } catch (err) {
      return sendAiError(reply, err);
    }
  });
}

function sendAiError(reply: any, err: unknown) {
  if (err instanceof AiError) {
    const status = err.code === 'auth' ? 401 : err.code === 'rate_limit' ? 429 : 502;
    return reply.code(status).send({ error: err.message, code: err.code });
  }
  reply.log.error(err);
  return reply.code(500).send({ error: 'Unexpected error while contacting the model.', code: 'unknown' });
}
