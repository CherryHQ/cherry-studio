import { defineProvider } from './types'

export default defineProvider({
  id: 'powertokens',
  name: 'PowerTokens',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.powertokens.ai'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://api.powertokens.ai/v1',
      modelsApiUrls: {
        default: 'https://api.powertokens.ai/v1/models'
      }
    },
    'openai-responses': {
      adapterFamily: 'openai',
      baseUrl: 'https://api.powertokens.ai/v1'
    }
  },
  metadata: {
    website: {
      apiKey:
        'https://www.powertokens.ai/en/api-keys?utm_source=github&utm_medium=cherry-studio&utm_campaign=cherry-studio',
      docs: 'https://docs.powertokens.ai?utm_source=github&utm_medium=cherry-studio&utm_campaign=cherry-studio',
      models: 'https://powertokens.ai/models?utm_source=github&utm_medium=cherry-studio&utm_campaign=cherry-studio',
      official: 'https://powertokens.ai?utm_source=github&utm_medium=cherry-studio&utm_campaign=cherry-studio'
    }
  }
})
