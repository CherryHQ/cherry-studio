import { defineProvider } from './types'

const claudeWebSearchModels = [
  'claude-opus-4',
  'claude-sonnet-4',
  'claude-haiku-4',
  'claude-3-5-haiku',
  'claude-3-5-sonnet',
  'claude-3-7-sonnet'
]
const geminiWebToolModels = [
  'gemini-2',
  'gemini-3',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-flash-lite-latest'
]

export default defineProvider({
  id: 'vertexai',
  name: 'VertexAI',
  availableInEditions: ['global'],
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
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebSearchModels, ...geminiWebToolModels],
      imageModelIds: ['gemini-3-pro-image', 'gemini-3-pro-image-preview', 'gemini-3-1-flash-image']
    },
    // Gemini-only: @ai-sdk/google-vertex/anthropic exposes no webFetch tool,
    // so Claude-on-Vertex cannot serve url-context.
    {
      id: 'url-context',
      modelScope: 'model-dependent',
      modelIdPrefixes: geminiWebToolModels,
      vendors: ['gemini']
    }
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
