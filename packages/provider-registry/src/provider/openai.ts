import { defineProvider } from './types'

export default defineProvider({
  id: 'openai',
  name: 'OpenAI',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.openai.com'
    }
  },
  apiFeatures: {
    serviceTier: true
  },
  metadata: {
    website: {
      apiKey: 'https://platform.openai.com/api-keys',
      docs: 'https://platform.openai.com/docs',
      models: 'https://platform.openai.com/docs/models',
      official: 'https://openai.com/'
    }
  }
})
