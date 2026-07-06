import { defineProvider } from './types'

export default defineProvider({
  id: 'copilot',
  name: 'Github Copilot',
  defaultChatEndpoint: 'openai-chat-completions',
  endpointConfigs: {
    'openai-chat-completions': {
      adapterFamily: 'github-copilot-openai-compatible',
      baseUrl: 'https://api.githubcopilot.com/'
    }
  },
  metadata: {
    website: {
      official: 'https://github.com/features/copilot'
    }
  },
  modelsDevProvider: 'github-copilot'
})
