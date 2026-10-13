import { defineProvider } from './types'

const webToolModels = [
  'gemini-2',
  'gemini-3',
  'gemini-4-argon',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-flash-lite-latest'
]
const webSearchImageModels = ['gemini-3-pro-image', 'gemini-3-pro-image-preview']

export default defineProvider({
  id: 'gemini',
  name: 'Gemini',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'google-generate-content',
  endpointConfigs: {
    'google-generate-content': {
      adapterFamily: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com'
    },
    'google-interactions': {
      adapterFamily: 'google-interactions',
      baseUrl: 'https://generativelanguage.googleapis.com'
    }
  },
  overrides: [
    {
      modelId: 'gemini-omni-1-1-flash',
      apiModelId: 'gemini-omni-1.1-flash',
      endpointTypes: ['google-interactions']
    },
    {
      modelId: 'gemini-omni-flash-preview',
      apiModelId: 'gemini-omni-flash-preview',
      endpointTypes: ['google-interactions']
    }
  ],
  serverTools: [
    {
      id: 'web-search',
      modelScope: 'model-dependent',
      modelIdPrefixes: webToolModels,
      imageModelIds: webSearchImageModels
    },
    { id: 'url-context', modelScope: 'model-dependent', modelIdPrefixes: webToolModels }
  ],
  metadata: {
    website: {
      apiKey: 'https://aistudio.google.com/app/apikey',
      docs: 'https://ai.google.dev/gemini-api/docs',
      models: 'https://ai.google.dev/gemini-api/docs/models/gemini',
      official: 'https://gemini.google.com/'
    }
  }
})
