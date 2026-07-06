import { defineProvider } from './types'

export default defineProvider({
  id: 'gemini',
  name: 'Gemini',
  defaultChatEndpoint: 'google-generate-content',
  endpointConfigs: {
    'google-generate-content': {
      adapterFamily: 'google',
      baseUrl: 'https://generativelanguage.googleapis.com'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://aistudio.google.com/app/apikey',
      docs: 'https://ai.google.dev/gemini-api/docs',
      models: 'https://ai.google.dev/gemini-api/docs/models/gemini',
      official: 'https://gemini.google.com/'
    }
  }
})
