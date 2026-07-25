import { defineProvider } from './types'

export default defineProvider({
  id: 'gpustack',
  name: 'GPUStack',
  authOptional: true,
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      reasoningFormat: { type: 'openai-chat' }
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
