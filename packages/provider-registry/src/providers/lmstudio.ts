import { defineProvider } from './types'

export default defineProvider({
  id: 'lmstudio',
  name: 'LM Studio',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:1234'
    },
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'http://localhost:1234'
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
