import { defineProvider } from './types'

export default defineProvider({
  id: 'morse',
  name: 'Morse',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'openai-compatible',
      baseUrl: 'https://inference.trymorse.ai',
      reasoningFormat: { type: 'openai-chat' }
    }
  },
  metadata: {
    website: {
      apiKey: 'https://console.trymorse.ai',
      docs: 'https://trymorse.ai/inference/docs',
      models: 'https://trymorse.ai/inference/models',
      official: 'https://trymorse.ai/inference'
    }
  },
  overrides: [
    {
      modelId: 'mistral-nemo',
      apiModelId: 'mistralai/mistral-nemo',
      capabilities: { remove: ['function-call', 'image-recognition'] },
      inputModalities: ['text']
    },
    {
      modelId: 'gpt-oss-120b',
      apiModelId: 'openai/gpt-oss-120b',
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.05 },
        output: { currency: 'USD', perMillionTokens: 0.21 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.05 }
      }
    }
  ]
})
