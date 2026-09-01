import { defineProvider } from './types'

export default defineProvider({
  id: 'llmman',
  name: 'llmman',
  authOptional: true,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:17434'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:17434',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      docs: 'https://github.com/llmmanorg/llmman',
      models: 'https://hub.docker.com/catalogs/models',
      official: 'https://github.com/llmmanorg/llmman'
    }
  }
})
