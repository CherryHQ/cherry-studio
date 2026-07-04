import { defineProvider } from './types'

/**
 * Login-based provider that drives the ChatGPT Plus/Pro Codex backend via an
 * app-managed OAuth session (`authMethods: ['oauth']`); model list served from
 * this registry (`modelListSource: 'registry'`). OAuth runtime lives in
 * `src/main/services/oauth/`.
 */
export default defineProvider({
  id: 'openai-codex',
  name: 'OpenAI Codex',
  defaultChatEndpoint: 'openai-responses',
  modelListSource: 'registry',
  authMethods: ['oauth'],
  apiFeatures: { serviceTier: true },
  endpointConfigs: {
    'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://chatgpt.com/backend-api/codex' }
  },
  metadata: {
    website: {
      official: 'https://openai.com/codex',
      docs: 'https://platform.openai.com/docs/codex'
    }
  },
  overrides: [
    { modelId: 'gpt-5-5', apiModelId: 'gpt-5.5', endpointTypes: ['openai-responses'] },
    { modelId: 'gpt-5-4', apiModelId: 'gpt-5.4', endpointTypes: ['openai-responses'] },
    { modelId: 'gpt-5-4-mini', apiModelId: 'gpt-5.4-mini', endpointTypes: ['openai-responses'] },
    { modelId: 'gpt-5-3-codex-spark', apiModelId: 'gpt-5.3-codex-spark', endpointTypes: ['openai-responses'] }
  ]
})
