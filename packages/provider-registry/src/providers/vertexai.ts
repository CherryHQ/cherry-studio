import { defineProvider } from './types'

export default defineProvider({
  id: 'vertexai',
  name: 'VertexAI',
  defaultChatEndpoint: 'google-generate-content',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'google-vertex-anthropic'
    },
    'google-generate-content': {
      adapterFamily: 'google-vertex'
    }
  },
  serverTools: [
    { id: 'web-search', modelScope: 'model-dependent' },
    // Gemini-only: @ai-sdk/google-vertex/anthropic exposes no webFetch tool,
    // so Claude-on-Vertex cannot serve url-context.
    { id: 'url-context', modelScope: 'model-dependent', vendors: ['gemini'] }
  ],
  metadata: {
    website: {
      apiKey: 'https://console.cloud.google.com/apis/credentials',
      docs: 'https://cloud.google.com/vertex-ai/generative-ai/docs',
      models: 'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models',
      official: 'https://cloud.google.com/vertex-ai'
    }
  },
  modelsDevProvider: 'google-vertex'
})
