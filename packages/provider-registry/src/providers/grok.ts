import { defineProvider } from './types'

export default defineProvider({
  id: 'grok',
  name: 'Grok',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'xai',
      baseUrl: 'https://api.x.ai'
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
  serverTools: [{ id: 'web-search', modelScope: 'model-dependent' }],
  metadata: {
    website: {
      docs: 'https://docs.x.ai/',
      models: 'https://docs.x.ai/docs/models',
      official: 'https://x.ai/'
    }
  }
})
