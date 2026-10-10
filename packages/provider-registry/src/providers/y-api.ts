import { openaiCompatible } from './types'

/**
 * Dual-protocol gateway: OpenAI Chat Completions and Anthropic Messages share one host, one key and
 * one model catalog, so a client on either protocol reaches every model.
 *
 * Connection-only on purpose — no `modelsDevProvider`, `fetchModels` or `overrides`: `/v1/models`
 * requires a key, so there is no list to snapshot at generation time. The served models come from
 * the user's own live sync instead.
 *
 * Global only: the service's own documentation states it is not available to users in mainland
 * China, so the CN edition must not advertise it.
 */
export default openaiCompatible({
  id: 'y-api',
  name: 'Y-API',
  availableInEditions: ['global'],
  baseUrl: 'https://api.y-api.bestvirtualgoods.com',
  anthropic: 'https://api.y-api.bestvirtualgoods.com',
  website: {
    apiKey: 'https://y-api.bestvirtualgoods.com/app/keys',
    docs: 'https://y-api.bestvirtualgoods.com/docs',
    models: 'https://y-api.bestvirtualgoods.com/models',
    official: 'https://y-api.bestvirtualgoods.com'
  }
})
