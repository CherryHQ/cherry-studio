import { defineProvider } from './types'

export default defineProvider({
  id: 'ollama',
  name: 'Ollama',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'http://localhost:11434'
    },
    'ollama-chat': {
      adapterFamily: 'ollama',
      baseUrl: 'http://localhost:11434'
    }
  },
  metadata: {
    website: {
      docs: 'https://github.com/ollama/ollama/tree/main/docs',
      models: 'https://ollama.com/library',
      official: 'https://ollama.com/'
    }
  }
})
