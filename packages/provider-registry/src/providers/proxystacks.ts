import { defineProvider } from './types'

export default defineProvider({
  id: 'proxystacks',
  name: 'ProxyStacks Relay',
  availableInEditions: ['global', 'cn'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://proxystacks.com'
    },
    'openai-responses': {
      adapterFamily: 'open-responses',
      baseUrl: 'https://proxystacks.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://proxystacks.com',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://proxystacks.com/login',
      docs: 'https://proxystacks.com/en/docs',
      models: 'https://proxystacks.com/en/models',
      official: 'https://proxystacks.com'
    }
  }
})
