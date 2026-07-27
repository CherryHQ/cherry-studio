import { defineProvider } from './types'

export default defineProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  // OpenRouter's usage response carries the actual billed amount, so the cost
  // engine trusts it over locally computed pricing.
  apiFeatures: {
    reportsActualCost: true
  },
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api'
    },
    'openai-chat-completions': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      reasoningFormat: {
        type: 'openai-chat',
        wire: {
          off: { operations: [{ target: 'reasoning.effort', value: { source: 'literal', value: 'none' } }] },
          auto: { operations: [{ target: 'reasoning.effort', value: { source: 'literal', value: 'medium' } }] },
          effort: { operations: [{ target: 'reasoning.effort', value: { source: 'effort' } }] }
        }
      },
      modelsApiUrls: {
        default: 'https://openrouter.ai/api/v1/models',
        embedding: 'https://openrouter.ai/api/v1/embeddings/models',
        image: 'https://openrouter.ai/api/v1/images/models'
      }
    },
    'openai-image-generation': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs/quick-start',
      models: 'https://openrouter.ai/models',
      official: 'https://openrouter.ai/'
    }
  },
  modelsDevProvider: 'openrouter'
})
