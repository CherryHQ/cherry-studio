import { defineProvider } from './types'

export default defineProvider({
  id: 'mistral',
  name: 'Mistral',
  supportedEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'mistral',
      baseUrl: 'https://api.mistral.ai',
      dialect: { streamOptions: false }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.mistral.ai/api-keys/',
      docs: 'https://docs.mistral.ai',
      models: 'https://docs.mistral.ai/getting-started/models/models_overview',
      official: 'https://mistral.ai'
    }
  }
})
