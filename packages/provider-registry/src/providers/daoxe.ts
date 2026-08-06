import { defineProvider } from './types'

export default defineProvider({
  id: 'daoxe',
  name: 'DaoXE',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi',
      baseUrl: 'https://daoxe.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'https://daoxe.com/v1'
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://daoxe.com/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://daoxe.com/dashboard',
      docs: 'https://github.com/seven7763/DaoXE-AI',
      models: 'https://daoxe.com/pricing',
      official: 'https://daoxe.com/'
    }
  }
})
