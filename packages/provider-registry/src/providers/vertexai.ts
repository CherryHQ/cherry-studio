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
  defaultChatEndpoint: 'google-generate-content',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'google-vertex'
    },
    'google-generate-content': {
      adapterFamily: 'google-vertex'
    }
  },
  // Vertex fronts two vendors' protocols and picks by model id: Claude SKUs are served over
  // anthropic-messages, everything else over Gemini's generateContent. Declaring it here (instead of
  // a `startsWith('claude')` in the config builder) is what lets the reasoning projection see the
  // same endpoint the request uses — otherwise Claude-on-Vertex gets Gemini's thinking wire.
  modelRouting: [{ pattern: '^claude', endpointType: 'anthropic-messages' }],
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: [...claudeWebSearchModels, ...geminiWebToolModels],
      imageModelIds: ['gemini-3-pro-image', 'gemini-3-pro-image-preview']
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
