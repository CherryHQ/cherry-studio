import { defineProvider } from './types'

/**
 * HopBase is an enterprise AI gateway: one API key serves Claude, GPT, Gemini, DeepSeek, Qwen, GLM, Kimi,
 * Doubao Seed and Grok. The models a key may call depend on that key, so `/v1/models` fills the list at
 * runtime and no static overrides are declared.
 */
export default defineProvider({
  id: 'hopbase',
  name: 'HopBase',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.hop-base.com'
    },
    'google-generate-content': {
      adapterFamily: 'google',
      baseUrl: 'https://api.hop-base.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.hop-base.com/v1',
      modelsApiUrls: { default: 'https://api.hop-base.com/v1/models' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://api.hop-base.com/login',
      docs: 'https://hop-base.com/en/docs/tools/third-party-clients?utm_source=cherrystudio&utm_medium=listing',
      models: 'https://hop-base.com/models?utm_source=cherrystudio&utm_medium=listing',
      official: 'https://hop-base.com/?utm_source=cherrystudio&utm_medium=listing'
    }
  }
})
