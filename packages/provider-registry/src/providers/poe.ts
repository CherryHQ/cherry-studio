import { defineProvider } from './types'

export default defineProvider({
  id: 'poe',
  name: 'Poe',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.poe.com/v1/'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://poe.com/api/keys',
      docs: 'https://creator.poe.com/docs',
      models: 'https://poe.com/api/models',
      official: 'https://poe.com/'
    }
  },
  apiFeatures: {
    arrayContent: false,
    developerRole: false
  }
})
