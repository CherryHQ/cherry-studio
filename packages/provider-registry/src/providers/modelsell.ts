import { defineProvider } from './types'

export default defineProvider({
  id: 'modelsell',
  name: 'Modelsell',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://modelsell.com/v1',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://modelsell.com/console/token',
      docs: 'https://modelsell.com/docs/api-reference',
      models: 'https://modelsell.com/v1/models',
      official: 'https://modelsell.com'
    }
  }
})
