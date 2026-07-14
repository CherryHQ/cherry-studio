import { defineProvider } from './types'

export default defineProvider({
  id: 'gpustack',
  name: 'GPUStack',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      reasoningFormat: { type: 'self-hosted' }
    }
  },
  metadata: {
    website: {
      docs: 'https://docs.gpustack.ai/latest/',
      models: 'https://docs.gpustack.ai/latest/overview/#supported-models',
      official: 'https://gpustack.ai/'
    }
  }
})
