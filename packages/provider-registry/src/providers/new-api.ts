import { defineProvider } from './types'

export default defineProvider({
  id: 'new-api',
  name: 'New API',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000'
    },
    'openai-chat-completions': {
      adapterFamily: 'newapi',
      baseUrl: 'http://localhost:3000'
    },
    'openai-responses': {
      baseUrl: 'http://localhost:3000'
    },
    'google-generate-content': {
      baseUrl: 'http://localhost:3000'
    }
  },
  metadata: {
    website: {
      docs: 'https://docs.newapi.pro',
      official: 'https://docs.newapi.pro/'
    }
  }
})
