import { defineProvider } from './types'

export default defineProvider({
  id: 'cerebras',
  name: 'Cerebras AI',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'cerebras',
      baseUrl: 'https://api.cerebras.ai/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://cloud.cerebras.ai',
      docs: 'https://inference-docs.cerebras.ai/introduction',
      models: 'https://inference-docs.cerebras.ai/models/overview',
      official: 'https://www.cerebras.ai'
    }
  },
  modelsDevProvider: 'cerebras'
})
