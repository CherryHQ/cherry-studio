import { defineProvider } from './types'

export default defineProvider({
  id: 'tokendance',
  name: 'TokenDance',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://tokendance.space/gateway'
    },
    'google-generate-content': {
      adapterFamily: 'google',
      baseUrl: 'https://tokendance.space/gateway'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://tokendance.space/gateway',
      modelsApiUrls: { default: 'https://tokendance.space/gateway/v1/models' }
    },
    'openai-embeddings': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://tokendance.space/gateway'
    },
    'openai-image-generation': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://tokendance.space/gateway'
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://tokendance.space/gateway'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://tokendance.space/keys',
      docs: 'https://tokendance.space/docs/cherry-studio',
      models: 'https://tokendance.space/models',
      official: 'https://tokendance.space'
    }
  }
})
