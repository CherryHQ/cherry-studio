import { defineProvider } from './types'

export default defineProvider({
  id: 'api-route',
  name: 'API Route',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://global.api-route.com/v1',
      modelsApiUrls: {
        default: 'https://global.api-route.com/v1/models'
      }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://www.api-route.com',
      docs: 'https://www.api-route.com',
      models: 'https://global.api-route.com/v1/models',
      official: 'https://www.api-route.com'
    }
  }
})
