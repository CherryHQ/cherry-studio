import { defineProvider } from './types'

export default defineProvider({
  id: 'gateway',
  name: 'Vercel AI Gateway',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'gateway',
      baseUrl: 'https://ai-gateway.vercel.sh/v1/ai'
    },
    'openai-image-generation': {
      adapterFamily: 'gateway'
    }
  },
  // NO serverTools: unlike cherryin/new-api/aihubmix, this gateway has no reachable native tool.
  // `@ai-sdk/gateway` hardcodes `provider: 'gateway'` on every language model, so
  // `resolveToolCapability`'s aggregator fallback has no vendor segment to walk, and
  // `GatewayExtension` owns no toolFactories — a declaration here would route to the server side,
  // inject nothing, and withhold the client tools. Wiring it needs the underlying vendor to reach
  // the factory (a model-aware ToolFactory in ai-core); see the PR discussion.
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
