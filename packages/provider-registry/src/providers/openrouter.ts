import { defineProvider } from './types'

export default defineProvider({
  id: 'openrouter',
  name: 'OpenRouter',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api'
    },
    'openai-chat-completions': {
      adapterFamily: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://openrouter.ai/settings/keys',
      docs: 'https://openrouter.ai/docs/quick-start',
      models: 'https://openrouter.ai/models',
      official: 'https://openrouter.ai/'
    }
  },
  modelsDevProvider: 'openrouter'
})
