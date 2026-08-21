import { defineProvider } from './types'

export default defineProvider({
  id: 'copilot',
  name: 'Github Copilot',
  // The app owns the GitHub device-flow token; DSH must therefore reach
  // Copilot through Cherry's Gateway instead of expecting an API key.
  authMethods: ['oauth'],
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
