import { defineProvider } from './types'

export default defineProvider({
  id: 'voyageai',
  name: 'VoyageAI',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'voyage',
      baseUrl: 'https://api.voyageai.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://dashboard.voyageai.com/organization/api-keys',
      docs: 'https://docs.voyageai.com/docs',
      models: 'https://docs.voyageai.com/docs',
      official: 'https://www.voyageai.com/'
    }
  }
})
