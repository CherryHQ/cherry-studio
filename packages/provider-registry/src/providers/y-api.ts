import { openaiCompatible } from './types'

/**
 * Y-API is a dual-protocol gateway: OpenAI Chat Completions and Anthropic
 * Messages both live on the same host behind the same key, serving one shared
 * model catalog, so a client on either protocol reaches every model.
 *
 * Connection-only on purpose — no `modelsDevProvider`, `fetchModels`, or
 * `overrides`. `/v1/models` requires a key (a keyless generation-time fetch
 * 401s), so the served list follows the user's own live sync instead of a
 * snapshot that would rot as the catalog grows. Cherry Studio's
 * `normalizeModelId` folds the wire ids this host returns (`deepseek/deepseek-v4-flash`,
 * `z-ai/glm-5.2`, `openai/gpt-5.6-luna`) onto the creators that already own
 * those models, so names, icons, capabilities and pricing resolve from the
 * shared catalog without a per-model row.
 */
export default openaiCompatible({
  id: 'y-api',
  name: 'Y-API',
  availableInEditions: ['global', 'cn'],
  baseUrl: 'https://api.y-api.bestvirtualgoods.com',
  anthropic: 'https://api.y-api.bestvirtualgoods.com',
  website: {
    apiKey: 'https://y-api.bestvirtualgoods.com/app/keys',
    docs: 'https://y-api.bestvirtualgoods.com/docs',
    models: 'https://y-api.bestvirtualgoods.com/models',
    official: 'https://y-api.bestvirtualgoods.com'
  }
})
