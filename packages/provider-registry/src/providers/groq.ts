import { defineProvider } from './types'

export default defineProvider({
  id: 'groq',
  name: 'Groq',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'groq',
      baseUrl: 'https://api.groq.com/openai'
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
  modelsDevProvider: 'groq'
})
