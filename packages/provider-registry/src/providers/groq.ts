import { defineProvider } from './types'

export default defineProvider({
  id: 'groq',
  name: 'Groq',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'groq',
      baseUrl: 'https://api.groq.com/openai',
      reasoningFormat: { type: 'none' },
      requestControls: {
        serviceTier: {
          default: 'standard',
          options: ['standard', 'auto', 'flex'],
          wire: {
            delivery: { type: 'provider-option', key: 'serviceTier' },
            values: { standard: 'on_demand', auto: 'auto', fast: 'performance', flex: 'flex' }
          }
        }
      }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.groq.com/keys',
      docs: 'https://console.groq.com/docs/quickstart',
      models: 'https://console.groq.com/docs/models',
      official: 'https://groq.com/'
    }
  },
  modelsDevProvider: 'groq',
  overrides: ['gpt-oss-120b', 'gpt-oss-20b', 'llama-3-3-70b-versatile'].map((modelId) => ({
    modelId,
    requestControls: { serviceTier: { options: ['standard', 'auto', 'fast', 'flex'] } }
  }))
})
