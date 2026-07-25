import { defineProvider } from './types'

export default defineProvider({
  id: 'lmstudio',
  name: 'LM Studio',
  authOptional: true,
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:1234'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:1234',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      docs: 'https://lmstudio.ai/docs',
      models: 'https://lmstudio.ai/models',
      official: 'https://lmstudio.ai/'
    }
  }
})
