import { defineProvider } from './types'

export default defineProvider({
  id: 'gateway',
  name: 'Vercel AI Gateway',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'gateway',
      baseUrl: 'https://ai-gateway.vercel.sh/v1/ai'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://vercel.com/',
      docs: 'https://vercel.com/docs/ai-gateway',
      models: 'https://vercel.com/ai-gateway/models',
      official: 'https://vercel.com/ai-gateway'
    }
  },
  modelsDevProvider: 'vercel'
})
