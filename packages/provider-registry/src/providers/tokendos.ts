import { defineProvider } from './types'

export default defineProvider({
  id: 'tokendos',
  name: 'TokenDos',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.tokendos.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.tokendos.com/v1',
      modelsApiUrls: {
        default: 'https://api.tokendos.com/v1/models'
      }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.tokendos.com/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://www.tokendos.com/tokendos-tokens',
      docs: 'https://www.tokendos.com/claude-code',
      models: 'https://www.tokendos.com/tokendos-pricing',
      official: 'https://www.tokendos.com'
    }
  }
})
