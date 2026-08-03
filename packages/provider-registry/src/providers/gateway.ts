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
  // Gateway-mapped delivery: the native tool comes from the underlying vendor's
  // extension, so only vendors with a web-search toolFactory are servable. A
  // deepseek/glm/kimi model here would route to the server side and inject
  // nothing (mapVertexAIGatewayModelToProviderId returns undefined).
  serverTools: [
    { id: 'web-search', modelScope: 'model-dependent', vendors: ['anthropic', 'gemini', 'openai', 'grok'] }
  ],
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
