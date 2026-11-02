import { defineProvider } from './types'

export default defineProvider({
  id: 'cheaper-inference',
  name: 'Cheaper Inference',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.cheaperinference.com/v1',
      modelsApiUrls: {
        default: 'https://api.cheaperinference.com/v1/models?type=text&streaming=true'
      }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://www.cheaperinference.com/dashboard',
      docs: 'https://www.cheaperinference.com/docs',
      models: 'https://www.cheaperinference.com/models',
      official: 'https://www.cheaperinference.com'
    }
  }
})
