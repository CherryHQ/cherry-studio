import { defineProvider } from './types'

export default defineProvider({
  id: 'aihubmix',
  name: 'AiHubMix',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'anthropic-messages': {
      adapterFamily: 'aihubmix',
      baseUrl: 'https://aihubmix.com'
    },
    'openai-chat-completions': {
      adapterFamily: 'aihubmix',
      baseUrl: 'https://aihubmix.com/v1'
    }
  },
  metadata: {
    website: {
      apiKey: 'https://aihubmix.com',
      docs: 'https://doc.aihubmix.com/',
      models: 'https://aihubmix.com/models',
      official: 'https://aihubmix.com'
    }
  }
})
