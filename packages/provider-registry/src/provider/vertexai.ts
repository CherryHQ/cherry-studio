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
