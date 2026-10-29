import { defineProvider } from './types'

export default defineProvider({
  id: 'grok',
  name: 'Grok',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'xai',
      baseUrl: 'https://api.x.ai'
    },
    'openai-image-generation': {
      adapterFamily: 'xai',
      baseUrl: 'https://api.x.ai/v1'
    },
    'openai-responses': {
      adapterFamily: 'xai-responses',
      baseUrl: 'https://api.x.ai/v1',
      reasoningFormat: {
        type: 'openai-responses',
        wire: {
          off: {
            operations: [{ target: 'reasoningEffort', value: { source: 'literal', value: 'none' } }]
          },
          auto: {
            operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }],
            effortMap: { auto: 'medium' }
          },
          effort: {
            operations: [{ target: 'reasoningEffort', value: { source: 'effort' } }]
          }
        }
      }
    }
  },
  overrides: [
    { modelId: 'grok-imagine-image', endpointTypes: ['openai-image-generation'] },
    {
      apiModelId: 'grok-imagine-image-2.0',
      modelId: 'grok-imagine-image-2-0',
      endpointTypes: ['openai-image-generation']
    },
    { modelId: 'grok-imagine-image-quality', endpointTypes: ['openai-image-generation'] }
  ],
  serverTools: [{ id: 'web-search', modelScope: 'model-dependent', modelIdPrefixes: ['grok-4'] }],
  metadata: {
    website: {
      docs: 'https://docs.x.ai/',
      models: 'https://docs.x.ai/docs/models',
      official: 'https://x.ai/'
    }
  }
})
