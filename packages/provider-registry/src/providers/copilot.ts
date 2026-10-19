import { defineProvider } from './types'

export default defineProvider({
  id: 'copilot',
  name: 'Github Copilot',
  availableInEditions: ['global'],
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'github-copilot-openai-compatible',
      baseUrl: 'https://api.githubcopilot.com/'
    },
    'openai-responses': {
      adapterFamily: 'github-copilot-openai-compatible',
      baseUrl: 'https://api.githubcopilot.com/'
    },
    'anthropic-messages': {
      adapterFamily: 'anthropic',
      baseUrl: 'https://api.githubcopilot.com/v1'
    }
  },
  metadata: {
    website: {
      official: 'https://github.com/features/copilot'
    }
  },
  modelsDevProvider: 'github-copilot'
})
