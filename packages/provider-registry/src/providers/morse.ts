import { defineProvider } from './types'

export default defineProvider({
  id: 'morse',
  name: 'Morse',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://inference.trymorse.ai',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.trymorse.ai',
      docs: 'https://trymorse.ai/inference/docs',
      models: 'https://trymorse.ai/inference/models',
      official: 'https://trymorse.ai/inference'
    }
  }
})
