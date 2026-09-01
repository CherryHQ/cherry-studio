import { defineProvider } from './types'
import { openaiResponsesSummaryWire } from './wires'

/**
 * Login-based provider that drives the ChatGPT Plus/Pro Codex backend via an
 * app-managed OAuth session (`authMethods: ['oauth']`); model list served from
 * this registry (`modelListSource: 'registry'`). OAuth runtime lives in
 * `src/main/services/oauth/`.
 */
export default defineProvider({
  id: 'openai-codex',
  name: 'OpenAI Codex',
  supportedEditions: ['global'],
  defaultChatEndpoint: 'openai-responses',
  modelListSource: 'registry',
  authMethods: ['oauth'],
  fastMode: { transport: 'openai-priority' },
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      reasoningFormat: { type: 'openai-responses', wire: openaiResponsesSummaryWire }
    }
  },
  metadata: {
    website: {
      official: 'https://openai.com/codex',
      docs: 'https://platform.openai.com/docs/codex'
    }
  },
  overrides: [
    // Codex backend serves the gpt-5.6 family with a 372k context window
    // (per upstream `codex-rs/models-manager/models.json`), smaller than the
    // platform-API figure the base catalog carries.
    {
      modelId: 'gpt-5-6-sol',
      apiModelId: 'gpt-5.6-sol',
      supportsFastMode: true,
      limits: { contextWindow: 372000 },
      endpointTypes: ['openai-responses']
    },
    {
      modelId: 'gpt-5-6-terra',
      apiModelId: 'gpt-5.6-terra',
      supportsFastMode: true,
      limits: { contextWindow: 372000 },
      endpointTypes: ['openai-responses']
    },
    {
      modelId: 'gpt-5-6-luna',
      apiModelId: 'gpt-5.6-luna',
      supportsFastMode: true,
      limits: { contextWindow: 372000 },
      endpointTypes: ['openai-responses']
    },
    {
      modelId: 'gpt-5-5',
      apiModelId: 'gpt-5.5',
      supportsFastMode: true,
      endpointTypes: ['openai-responses']
    },
    {
      modelId: 'gpt-5-4',
      apiModelId: 'gpt-5.4',
      supportsFastMode: true,
      endpointTypes: ['openai-responses']
    },
    { modelId: 'gpt-5-4-mini', apiModelId: 'gpt-5.4-mini', endpointTypes: ['openai-responses'] },
    { modelId: 'gpt-5-3-codex-spark', apiModelId: 'gpt-5.3-codex-spark', endpointTypes: ['openai-responses'] }
  ]
})
