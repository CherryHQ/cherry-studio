import { defineProvider } from './types'

export default defineProvider({
  id: 'together',
  name: 'Together',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'togetherai',
      baseUrl: 'https://api.together.xyz'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://api.together.ai/settings/api-keys',
      docs: 'https://docs.together.ai/docs/introduction',
      models: 'https://docs.together.ai/docs/serverless-models',
      official: 'https://www.together.ai/'
    }
  }
})
