import { defineProvider } from './types'

export default defineProvider({
  id: 'steadyrouter',
  name: 'SteadyRouter',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': { adapterFamily: 'anthropic', baseUrl: 'https://api.steadyrouter.com' },
    'google-generate-content': { adapterFamily: 'google', baseUrl: 'https://api.steadyrouter.com' },
    'openai-chat-completions': { adapterFamily: 'openai-compatible', baseUrl: 'https://api.steadyrouter.com/v1' },
    'openai-embeddings': { adapterFamily: 'openai-compatible', baseUrl: 'https://api.steadyrouter.com/v1' },
    'openai-image-generation': { adapterFamily: 'openai-compatible', baseUrl: 'https://api.steadyrouter.com/v1' },
    'openai-responses': { adapterFamily: 'openai', baseUrl: 'https://api.steadyrouter.com/v1' }
  },
  metadata: {
    website: {
      apiKey: 'https://www.steadyrouter.com/dashboard',
      docs: 'https://www.steadyrouter.com/site/docs.html',
      models: 'https://www.steadyrouter.com/pricing',
      official: 'https://www.steadyrouter.com'
    }
  }
})
