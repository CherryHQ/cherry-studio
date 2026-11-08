import { defineProvider } from './types'

export default defineProvider({
  id: 'teapot-router',
  name: 'Teapot Router',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.teapotrouter.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.teapotrouter.com/v1',
      modelsApiUrls: { default: 'https://api.teapotrouter.com/v1/models' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://teapotrouter.com/en/dashboard/keys',
      docs: 'https://teapotrouter.com/en/docs',
      models: 'https://teapotrouter.com/pricing',
      official: 'https://teapotrouter.com'
    }
  }
})
