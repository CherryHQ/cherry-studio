import { defineProvider } from './types'

export default defineProvider({
  id: 'huggingface',
  name: 'Hugging Face',
  defaultChatEndpoint: 'openai-responses',
  endpointConfigs: {
    'openai-responses': {
      adapterFamily: 'huggingface',
      baseUrl: 'https://router.huggingface.co/v1/'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://huggingface.co/settings/tokens',
      docs: 'https://huggingface.co/docs',
      models: 'https://huggingface.co/models',
      official: 'https://huggingface.co/'
    }
  },
  modelsDevProvider: 'huggingface'
})
