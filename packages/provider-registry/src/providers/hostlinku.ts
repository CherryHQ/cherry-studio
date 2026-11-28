import { defineProvider } from './types'

export default defineProvider({
  id: 'hostlinku',
  name: 'Hostlinku',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.hostlinku.com'
    },
    'google-generate-content': {
      adapterFamily: 'google',
      baseUrl: 'https://api.hostlinku.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.hostlinku.com',
      modelsApiUrls: { default: 'https://api.hostlinku.com/v1/models' },
      reasoningFormat: { type: 'openai-chat' }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.hostlinku.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.hostlinku.com',
      docs: 'https://docs.hostlinku.com',
      models: 'https://hostlinku.com/models',
      official: 'https://hostlinku.com'
    }
  }
})
